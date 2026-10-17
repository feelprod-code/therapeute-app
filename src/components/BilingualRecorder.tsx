"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Square, Loader2, Volume2, VolumeX, Globe2, Sparkles, Check, Send, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/db";

interface BilingualRecorderProps {
    onRecordingComplete?: (audioBlob: Blob, result: Record<string, string>) => Promise<void> | void;
    onConversationComplete?: (transcriptText: string) => Promise<void> | void;
    attachedFiles?: File[];
    isProcessing?: boolean;
}

interface Message {
    id: string;
    speaker: 'therapeut' | 'patient';
    originalText: string;
    translatedText: string;
    timestamp: Date;
}

export const SUPPORTED_LANGUAGES = [
    { code: 'en-US', name: 'Anglais', flag: '🇬🇧', label: 'EN' },
    { code: 'es-ES', name: 'Espagnol', flag: '🇪🇸', label: 'ES' },
    { code: 'de-DE', name: 'Allemand', flag: '🇩🇪', label: 'DE' },
    { code: 'it-IT', name: 'Italien', flag: '🇮🇹', label: 'IT' },
    { code: 'pt-PT', name: 'Portugais', flag: '🇵🇹', label: 'PT' },
    { code: 'ru-RU', name: 'Russe', flag: '🇷🇺', label: 'RU' },
    { code: 'zh-CN', name: 'Chinois (Mandarin)', flag: '🇨🇳', label: 'ZH' },
    { code: 'ja-JP', name: 'Japonais', flag: '🇯🇵', label: 'JA' },
    { code: 'ko-KR', name: 'Coréen', flag: '🇰🇷', label: 'KO' },
    { code: 'ar-SA', name: 'Arabe', flag: '🇸🇦', label: 'AR' },
];

export const WARM_VOICE_PRESETS = [
    { id: 'duo_warm', label: '✨ Duo Studio Paris & Londres (Victoria 🇫🇷 & George 🇬🇧)' },
    { id: 'victoria', label: '🇫🇷 Victoria (Parisienne Studio Pure & Douce)' },
    { id: 'lucie', label: '🇫🇷 Lucie (Française Studio Chaleureuse)' },
    { id: 'nicolas', label: '🇫🇷 Nicolas (Parisien Studio Calme & Posé)' },
    { id: 'jeanne', label: '🇫🇷 Jeanne (Parisienne Naturelle & Fluide)' },
    { id: 'leo', label: '🇫🇷 Léo (Parisien Rassurant)' },
    { id: 'claire', label: '🇫🇷 Claire (Française Douce)' },
    { id: 'guillaume', label: '🎙️ Guillaume (Ma Voix Clonée)' },
    { id: 'lily', label: '🇬🇧 Lily (Veloutée Britannique)' },
    { id: 'george', label: '🇬🇧 George (Chaleureux Britannique)' },
];

type TranslationMode = 'conversation' | 'realtime';
type TTSMode = 'all' | 'patient_only' | 'mute';

// Sas anti-écho court (350ms) après la fin du haut-parleur avant de ré-ouvrir le micro
const POST_TTS_COOLDOWN_MS = 350;

export function BilingualRecorder({ onRecordingComplete, onConversationComplete, attachedFiles = [], isProcessing = false }: BilingualRecorderProps) {
    const [targetLanguage, setTargetLanguage] = useState<string>('en-US');
    const [translationMode, setTranslationMode] = useState<TranslationMode>('conversation');
    const [ttsMode, setTtsMode] = useState<TTSMode>('all');
    const [voicePreset, setVoicePreset] = useState<string>('duo_warm');
    const [speechRate, setSpeechRate] = useState<number>(1.0);

    const [activeSpeaker, setActiveSpeaker] = useState<'therapeut' | 'patient' | null>(null);
    const [isHandsFreeActive, setIsHandsFreeActive] = useState(false);
    const [handsFreeStatus, setHandsFreeStatus] = useState<'idle' | 'listening' | 'speaking_detected' | 'translating' | 'tts_playing'>('idle');
    const [vadLevel, setVadLevel] = useState<number>(0);

    const [isTranslating, setIsTranslating] = useState(false);
    const [isGeneratingSynthesis, setIsGeneratingSynthesis] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [draftExists, setDraftExists] = useState(false);
    const [isPlayingAudio, setIsPlayingAudio] = useState(false);

    const { toast } = useToast();

    // Refs for Manual Push-to-Talk recording
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Refs for Hands-Free Automatic VAD mode
    const handsFreeActiveRef = useRef<boolean>(false);
    const handsFreeStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const vadRafRef = useRef<number | null>(null);
    const segmentRecorderRef = useRef<MediaRecorder | null>(null);
    const segmentChunksRef = useRef<Blob[]>([]);
    const hasSpeechInSegmentRef = useRef<boolean>(false);
    const speechFramesCountRef = useRef<number>(0);
    const speechStartMsRef = useRef<number>(0);
    const lastSpeechMsRef = useRef<number>(0);
    const segmentStartMsRef = useRef<number>(0);
    const isProcessingSegmentRef = useRef<boolean>(false);
    const isPlayingTTSRef = useRef<boolean>(false);
    const cooldownUntilMsRef = useRef<number>(0);
    const lastSpokenTtsRef = useRef<string>('');
    const mimeTypeRef = useRef<string>('audio/webm');
    const acquireHandsFreeMicRef = useRef<(() => Promise<void>) | null>(null);

    // Lecteur Audio HTML5 partagé (déverrouillé au clic pour iOS/Safari/Chrome)
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const currentAudioUrlRef = useRef<string | null>(null);

    // Keep latest state in refs for async callbacks
    const targetLanguageRef = useRef(targetLanguage);
    useEffect(() => { targetLanguageRef.current = targetLanguage; }, [targetLanguage]);

    const ttsModeRef = useRef(ttsMode);
    useEffect(() => { ttsModeRef.current = ttsMode; }, [ttsMode]);

    const voicePresetRef = useRef(voicePreset);
    useEffect(() => { voicePresetRef.current = voicePreset; }, [voicePreset]);

    const speechRateRef = useRef(speechRate);
    useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);

    const selectedLang = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage) || SUPPORTED_LANGUAGES[0];

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTranslating]);

    useEffect(() => {
        const checkDraft = async () => {
            const draft = await db.drafts.get('bilingual');
            if (draft && draft.messages && draft.messages.length > 0) {
                setDraftExists(true);
            }
        };
        checkDraft();

        return () => {
            stopHandsFreeSession();
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const recoverDraft = async () => {
        const draft = await db.drafts.get('bilingual');
        if (draft && draft.messages) {
            setMessages(draft.messages);
            setDraftExists(false);
            toast({
                title: "Conversation récupérée",
                description: `${draft.messages.length} échanges ont été restaurés.`,
            });
        }
    };

    const discardDraft = async () => {
        await db.drafts.delete('bilingual');
        setDraftExists(false);
        toast({
            title: "Brouillon supprimé",
            description: "La conversation inachevée a été effacée.",
        });
    };

    // Coupe totalement le matériel micro et bascule iOS hors du mode PlayAndRecord (VoiceProcessingIO)
    // pour éliminer 100% des grésillements de rééchantillonnage 48kHz/44.1kHz sur iPhone Safari
    const teardownMicAndSwitchToPlayback = useCallback(async () => {
        if (vadRafRef.current) {
            cancelAnimationFrame(vadRafRef.current);
            vadRafRef.current = null;
        }
        setVadLevel(0);

        if (segmentRecorderRef.current && segmentRecorderRef.current.state !== 'inactive') {
            hasSpeechInSegmentRef.current = false;
            speechFramesCountRef.current = 0;
            try { segmentRecorderRef.current.stop(); } catch { /* ignore */ }
        }
        segmentRecorderRef.current = null;

        if (handsFreeStreamRef.current) {
            handsFreeStreamRef.current.getTracks().forEach((t) => {
                try { t.stop(); } catch { /* ignore */ }
            });
            handsFreeStreamRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => {
                try { t.stop(); } catch { /* ignore */ }
            });
            streamRef.current = null;
        }

        analyserRef.current = null;
        if (audioContextRef.current) {
            const ctx = audioContextRef.current;
            audioContextRef.current = null;
            try {
                await ctx.close();
            } catch {
                // ignore
            }
        }

        // Force iOS 16.4+ / 17 / 18 Safari à quitter PlayAndRecord et utiliser le haut-parleur média Hi-Fi pur
        if (typeof navigator !== 'undefined') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nav = navigator as any;
            if (nav.audioSession) {
                try {
                    nav.audioSession.type = 'playback';
                } catch {
                    // ignore
                }
            }
        }
    }, []);

    // Préparation propre de l'élément Audio HTML5 pour iOS / Safari lors du clic utilisateur
    const unlockAudioPlayback = () => {
        if (typeof window === 'undefined') return;
        try {
            if (!audioPlayerRef.current) {
                const audio = new Audio();
                audio.setAttribute('playsinline', 'true');
                audio.preload = 'auto';
                audioPlayerRef.current = audio;
            }
        } catch {
            // ignore
        }
    };

    const stopSpeaking = useCallback(() => {
        if (audioPlayerRef.current) {
            try {
                audioPlayerRef.current.pause();
                audioPlayerRef.current.currentTime = 0;
            } catch {
                // ignore
            }
        }
        if (currentAudioUrlRef.current) {
            URL.revokeObjectURL(currentAudioUrlRef.current);
            currentAudioUrlRef.current = null;
        }
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        isPlayingTTSRef.current = false;
        setIsPlayingAudio(false);
        cooldownUntilMsRef.current = Date.now() + POST_TTS_COOLDOWN_MS;
    }, []);

    // Lecture instantanée d'un flux audio en mode Playback Hi-Fi pur (zéro grésillement iPhone iOS)
    const playAudioUrlOrDataUri = useCallback(async (srcUrl: string, spokenText: string): Promise<void> => {
        stopSpeaking();
        isPlayingTTSRef.current = true;
        setIsPlayingAudio(true);
        lastSpokenTtsRef.current = spokenText;

        // S'assurer que tout micro et AudioContext sont fermés avant de jouer le MP3
        await teardownMicAndSwitchToPlayback();

        let objectUrlToRevoke: string | null = null;

        try {
            let finalPlayUrl = srcUrl;
            if (srcUrl.startsWith('data:')) {
                const commaIdx = srcUrl.indexOf(',');
                const meta = srcUrl.substring(5, commaIdx);
                const mime = meta.split(';')[0] || 'audio/mpeg';
                const base64Data = srcUrl.substring(commaIdx + 1);
                const binaryStr = window.atob(base64Data);
                const len = binaryStr.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: mime });
                finalPlayUrl = URL.createObjectURL(blob);
                objectUrlToRevoke = finalPlayUrl;
                currentAudioUrlRef.current = finalPlayUrl;
            }

            await new Promise<void>((resolve) => {
                const audio = audioPlayerRef.current || new Audio();
                audio.setAttribute('playsinline', 'true');
                audioPlayerRef.current = audio;

                // Purge du pipeline WebKit iOS (évite que l'élément <audio> reste calé sur l'horloge 48kHz PlayAndRecord)
                audio.pause();
                audio.src = '';
                audio.load();

                audio.src = finalPlayUrl;
                if (Math.abs(speechRateRef.current - 1.0) > 0.01) {
                    audio.playbackRate = speechRateRef.current;
                }
                audio.load();

                const safetyTimeout = setTimeout(() => {
                    resolve();
                }, 40000);

                audio.onended = () => {
                    clearTimeout(safetyTimeout);
                    resolve();
                };
                audio.onerror = () => {
                    clearTimeout(safetyTimeout);
                    resolve();
                };

                const playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.catch((err) => {
                        console.warn("Audio play warning:", err);
                        clearTimeout(safetyTimeout);
                        resolve();
                    });
                }
            });
        } finally {
            if (objectUrlToRevoke) {
                URL.revokeObjectURL(objectUrlToRevoke);
                if (currentAudioUrlRef.current === objectUrlToRevoke) {
                    currentAudioUrlRef.current = null;
                }
            }
            cooldownUntilMsRef.current = Date.now() + POST_TTS_COOLDOWN_MS;
            await new Promise((r) => setTimeout(r, POST_TTS_COOLDOWN_MS));
            isPlayingTTSRef.current = false;
            setIsPlayingAudio(false);

            // Si on n'est pas au milieu de processAudioSegment (ex: clic sur bouton "Écouter"), réactiver le micro Mains Libres
            if (handsFreeActiveRef.current && !isProcessingSegmentRef.current && acquireHandsFreeMicRef.current) {
                await acquireHandsFreeMicRef.current();
            }
        }
    }, [stopSpeaking, teardownMicAndSwitchToPlayback]);

    // Synthèse vocale à la demande (pour les boutons "Écouter" / "Orig." de l'historique)
    const speakText = useCallback(async (text: string, langCode: string, speakerRole: 'therapeut' | 'patient' = 'patient'): Promise<void> => {
        const cleanText = text
            .replace(/[*#_~`]/g, '')
            .replace(/\[.*?\]/g, '')
            .trim();

        if (!cleanText || typeof window === 'undefined') return;

        stopSpeaking();
        isPlayingTTSRef.current = true;
        setIsPlayingAudio(true);
        lastSpokenTtsRef.current = cleanText;

        await teardownMicAndSwitchToPlayback();

        try {
            const response = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: cleanText,
                    langCode,
                    speaker: speakerRole,
                    voicePreset: voicePresetRef.current,
                }),
            });

            if (!response.ok) {
                throw new Error("TTS API non disponible");
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            currentAudioUrlRef.current = audioUrl;

            await playAudioUrlOrDataUri(audioUrl, cleanText);
        } catch (err) {
            console.warn("Erreur TTS:", err);
            isPlayingTTSRef.current = false;
            setIsPlayingAudio(false);
            if (handsFreeActiveRef.current && !isProcessingSegmentRef.current && acquireHandsFreeMicRef.current) {
                await acquireHandsFreeMicRef.current();
            }
        } finally {
            if (currentAudioUrlRef.current) {
                URL.revokeObjectURL(currentAudioUrlRef.current);
                currentAudioUrlRef.current = null;
            }
        }
    }, [playAudioUrlOrDataUri, stopSpeaking, teardownMicAndSwitchToPlayback]);

    const getBestMimeType = (): string => {
        if (typeof MediaRecorder === 'undefined') return 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
        if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
        return '';
    };

    // Envoi d'un segment audio à /api/translate (Groq Whisper Turbo + GPT-OSS-120B + Audio TTS Studio intégré en un seul appel !)
    const processAudioSegment = useCallback(async (audioBlob: Blob, speakerRole: 'therapeut' | 'patient' | 'bidirectional') => {
        if (audioBlob.size < 800) return;

        setIsTranslating(true);
        if (handsFreeActiveRef.current) {
            setHandsFreeStatus('translating');
        }

        // Coupe immédiatement le micro matériel pendant l'appel réseau (~550ms)
        // pour laisser à iOS le temps de basculer proprement en mode Playback Hi-Fi avant que le MP3 n'arrive
        await teardownMicAndSwitchToPlayback();

        const currentLangObj = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguageRef.current) || SUPPORTED_LANGUAGES[0];
        const tempId = Date.now().toString() + "_" + Math.random().toString(36).substring(2, 6);

        try {
            const formData = new FormData();
            formData.append("audio", audioBlob);
            formData.append("speaker", speakerRole);
            formData.append("targetLanguage", currentLangObj.name);
            formData.append("targetLangCode", targetLanguageRef.current);
            formData.append("ttsMode", ttsModeRef.current);
            formData.append("voicePreset", voicePresetRef.current);
            if (lastSpokenTtsRef.current) {
                formData.append("lastSpokenTts", lastSpokenTtsRef.current);
            }

            const response = await fetch("/api/translate", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || "Erreur lors de la traduction");
            }

            const fullText = await response.text();

            if (!fullText || fullText.includes("[SILENCE]")) {
                return;
            }

            // Extraction robuste de [SPEAKER]
            let resolvedSpeaker: 'therapeut' | 'patient' =
                speakerRole === 'patient' ? 'patient' : speakerRole === 'therapeut' ? 'therapeut' : 'patient';

            const speakerMatch = fullText.match(/\[SPEAKER\][\s:*"'*-]*(therapeut|patient)/i);
            if (speakerMatch) {
                resolvedSpeaker = speakerMatch[1].toLowerCase() === 'therapeut' ? 'therapeut' : 'patient';
            }

            const finalTransIndex = fullText.indexOf("[TRANSCRIPTION]");
            const finalTranslIndex = fullText.indexOf("[TRANSLATION]");
            const audioUriIndex = fullText.indexOf("[AUDIO_URI]");

            let finalTranscription = "";
            let finalTranslation = "";
            let inlineAudioUri = "";

            if (finalTransIndex !== -1 && finalTranslIndex !== -1) {
                finalTranscription = fullText.substring(finalTransIndex + "[TRANSCRIPTION]".length, finalTranslIndex).trim();
                if (audioUriIndex !== -1) {
                    finalTranslation = fullText.substring(finalTranslIndex + "[TRANSLATION]".length, audioUriIndex).trim();
                    inlineAudioUri = fullText.substring(audioUriIndex + "[AUDIO_URI]".length).trim();
                } else {
                    finalTranslation = fullText.substring(finalTranslIndex + "[TRANSLATION]".length).trim();
                }
            }

            if (!finalTranscription || !finalTranslation) {
                return;
            }

            const newMessage: Message = {
                id: tempId,
                speaker: resolvedSpeaker,
                originalText: finalTranscription,
                translatedText: finalTranslation,
                timestamp: new Date(),
            };

            setMessages(prev => {
                const updated = [...prev, newMessage];
                db.drafts.put({
                    id: 'bilingual',
                    mode: 'bilingual',
                    audioChunks: [],
                    mimeType: 'text/plain',
                    messages: updated,
                    startedAt: updated[0]?.timestamp || new Date(),
                    lastUpdatedAt: new Date()
                }).catch(console.error);
                return updated;
            });

            setIsTranslating(false);

            // Lecture immédiate de l'audio déjà joint par le serveur (zéro attente réseau !)
            const currentTtsMode = ttsModeRef.current;
            const shouldSpeak =
                currentTtsMode === 'all' ||
                (currentTtsMode === 'patient_only' && resolvedSpeaker === 'therapeut');

            if (shouldSpeak && finalTranslation) {
                if (handsFreeActiveRef.current) {
                    setHandsFreeStatus('tts_playing');
                }
                if (inlineAudioUri) {
                    await playAudioUrlOrDataUri(inlineAudioUri, finalTranslation);
                } else {
                    const targetLangCode = resolvedSpeaker === 'therapeut' ? targetLanguageRef.current : 'fr-FR';
                    await speakText(finalTranslation, targetLangCode, resolvedSpeaker);
                }
            }

        } catch (error: unknown) {
            console.error("Translation error:", error);
            setMessages(prev => prev.filter(msg => msg.id !== tempId));
            toast({
                title: "Erreur de traduction",
                description: error instanceof Error ? error.message : "Impossible de traduire l'audio.",
                variant: "destructive",
            });
        } finally {
            setIsTranslating(false);
        }
    }, [playAudioUrlOrDataUri, speakText, teardownMicAndSwitchToPlayback, toast]);

    // ============================================================================
    // MODE 1 : MAINS LIBRES ULTRA-RÉACTIF (Cadence ChatGPT ~0.8s + Zéro Grésillement iOS)
    // ============================================================================
    const startNewHandsFreeSegment = useCallback(() => {
        if (!handsFreeActiveRef.current || !handsFreeStreamRef.current) return;
        if (isProcessingSegmentRef.current || isPlayingTTSRef.current) return;
        if (segmentRecorderRef.current && segmentRecorderRef.current.state !== 'inactive') {
            return;
        }

        try {
            const mime = mimeTypeRef.current;
            const options: MediaRecorderOptions = mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : {};
            const recorder = new MediaRecorder(handsFreeStreamRef.current, options);
            segmentChunksRef.current = [];
            hasSpeechInSegmentRef.current = false;
            speechFramesCountRef.current = 0;
            segmentStartMsRef.current = Date.now();

            recorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) {
                    segmentChunksRef.current.push(ev.data);
                }
            };

            recorder.onstop = async () => {
                const hadSpeech = hasSpeechInSegmentRef.current;
                const framesCount = speechFramesCountRef.current;
                const chunks = [...segmentChunksRef.current];
                segmentChunksRef.current = [];
                hasSpeechInSegmentRef.current = false;
                speechFramesCountRef.current = 0;

                if (hadSpeech && framesCount >= 8 && chunks.length > 0 && handsFreeActiveRef.current) {
                    const blob = new Blob(chunks, { type: mime || 'audio/webm' });
                    if (blob.size >= 1000) {
                        isProcessingSegmentRef.current = true;
                        await processAudioSegment(blob, 'bidirectional');
                        isProcessingSegmentRef.current = false;

                        // Ré-ouvre le micro matériel une fois que la traduction et la voix TTS sont terminées
                        if (handsFreeActiveRef.current && !isPlayingTTSRef.current && acquireHandsFreeMicRef.current) {
                            await acquireHandsFreeMicRef.current();
                        }
                        return;
                    }
                }

                // Si c'était un simple reset de silence (9s sans parole), le flux micro est toujours actif
                if (handsFreeActiveRef.current && !isProcessingSegmentRef.current && !isPlayingTTSRef.current && handsFreeStreamRef.current) {
                    startNewHandsFreeSegment();
                }
            };

            segmentRecorderRef.current = recorder;
            recorder.start(200);
            setHandsFreeStatus('listening');
        } catch (err) {
            console.error("Failed to start hands-free segment recorder:", err);
        }
    }, [processAudioSegment]);

    const acquireHandsFreeMicAndListen = useCallback(async () => {
        if (!handsFreeActiveRef.current || isProcessingSegmentRef.current || isPlayingTTSRef.current) return;
        if (handsFreeStreamRef.current) return;

        try {
            if (typeof navigator !== 'undefined') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const nav = navigator as any;
                if (nav.audioSession) {
                    try { nav.audioSession.type = 'auto'; } catch { /* ignore */ }
                }
            }

            // echoCancellation: false car le micro est physiquement coupé pendant le TTS :
            // évite le filtre téléphonique iOS VoiceProcessingIO qui étouffe et fait grésiller le son !
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });

            if (!handsFreeActiveRef.current) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            if (typeof navigator !== 'undefined') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const nav = navigator as any;
                if (nav.audioSession) {
                    try { nav.audioSession.type = 'play-and-record'; } catch { /* ignore */ }
                }
            }

            handsFreeStreamRef.current = stream;
            mimeTypeRef.current = getBestMimeType();

            // Instancier AudioContext APRÈS getUserMedia pour qu'il adopte la fréquence matérielle exacte du micro
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass();
            audioContextRef.current = audioCtx;
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume().catch(() => {});
            }

            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.5;
            source.connect(analyser);
            analyserRef.current = analyser;

            setHandsFreeStatus('listening');
            startNewHandsFreeSegment();

            const freqData = new Uint8Array(analyser.frequencyBinCount);
            const SPEECH_THRESHOLD = 32;
            const MIN_SPEECH_DURATION_MS = 400;
            const SILENCE_DURATION_MS = 900;
            const MAX_SEGMENT_SPEECH_MS = 24000;
            const IDLE_RESET_MS = 9000;

            const monitorVad = () => {
                if (!handsFreeActiveRef.current || !analyserRef.current) return;
                vadRafRef.current = requestAnimationFrame(monitorVad);

                const now = Date.now();

                if (
                    isPlayingTTSRef.current ||
                    isProcessingSegmentRef.current ||
                    now < cooldownUntilMsRef.current
                ) {
                    setVadLevel(0);
                    return;
                }

                analyserRef.current.getByteFrequencyData(freqData);

                let sum = 0;
                const startBin = 3;
                const endBin = Math.min(70, freqData.length);
                for (let i = startBin; i < endBin; i++) {
                    sum += freqData[i];
                }
                const avgEnergy = sum / (endBin - startBin);
                const normalizedLevel = Math.min(100, Math.round((avgEnergy / 85) * 100));
                setVadLevel(normalizedLevel);

                const recorder = segmentRecorderRef.current;

                if (avgEnergy > SPEECH_THRESHOLD) {
                    speechFramesCountRef.current += 1;
                    if (!hasSpeechInSegmentRef.current) {
                        hasSpeechInSegmentRef.current = true;
                        speechStartMsRef.current = now;
                    }
                    if (speechFramesCountRef.current >= 5) {
                        setHandsFreeStatus('speaking_detected');
                    }
                    lastSpeechMsRef.current = now;

                    if (now - speechStartMsRef.current > MAX_SEGMENT_SPEECH_MS && recorder && recorder.state === 'recording') {
                        recorder.stop();
                    }
                } else {
                    if (hasSpeechInSegmentRef.current) {
                        const speechDuration = lastSpeechMsRef.current - speechStartMsRef.current;
                        if (now - lastSpeechMsRef.current > SILENCE_DURATION_MS) {
                            if (speechDuration >= MIN_SPEECH_DURATION_MS && speechFramesCountRef.current >= 8 && recorder && recorder.state === 'recording') {
                                recorder.stop();
                            } else {
                                hasSpeechInSegmentRef.current = false;
                                speechFramesCountRef.current = 0;
                                setHandsFreeStatus('listening');
                            }
                        }
                    } else {
                        if (now - segmentStartMsRef.current > IDLE_RESET_MS && recorder && recorder.state === 'recording') {
                            recorder.stop();
                        }
                    }
                }
            };

            vadRafRef.current = requestAnimationFrame(monitorVad);
        } catch (err) {
            console.error("Erreur acquisition micro Mains Libres:", err);
            toast({
                title: "Erreur Microphone",
                description: "Impossible d'accéder au microphone. Vérifiez les autorisations du navigateur.",
                variant: "destructive",
            });
            stopHandsFreeSession();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startNewHandsFreeSegment, toast]);

    useEffect(() => {
        acquireHandsFreeMicRef.current = acquireHandsFreeMicAndListen;
    }, [acquireHandsFreeMicAndListen]);

    const startHandsFreeSession = async () => {
        unlockAudioPlayback();
        handsFreeActiveRef.current = true;
        setIsHandsFreeActive(true);
        setHandsFreeStatus('listening');

        await acquireHandsFreeMicAndListen();

        if (handsFreeActiveRef.current) {
            toast({
                title: "⚡ Mode Mains Libres Studio activé",
                description: `Traduction instantanée (< 0.8s) • Voix Studio Françaises de France (Victoria, Lucie, Nicolas) & Britanniques.`,
            });
        }
    };

    const flushCurrentHandsFreeSegment = () => {
        if (segmentRecorderRef.current && segmentRecorderRef.current.state === 'recording') {
            hasSpeechInSegmentRef.current = true;
            speechFramesCountRef.current = Math.max(speechFramesCountRef.current, 15);
            segmentRecorderRef.current.stop();
        }
    };

    const stopHandsFreeSession = useCallback(() => {
        handsFreeActiveRef.current = false;
        setIsHandsFreeActive(false);
        setHandsFreeStatus('idle');
        setVadLevel(0);
        teardownMicAndSwitchToPlayback();
        stopSpeaking();
    }, [stopSpeaking, teardownMicAndSwitchToPlayback]);

    // ============================================================================
    // MODE 2 : MANUEL PUSH-TO-TALK (Guillaume FR / Patient Étranger)
    // ============================================================================
    const startManualRecording = async (speaker: 'therapeut' | 'patient') => {
        try {
            stopSpeaking();
            unlockAudioPlayback();
            await teardownMicAndSwitchToPlayback();

            if (typeof navigator !== 'undefined') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const nav = navigator as any;
                if (nav.audioSession) {
                    try { nav.audioSession.type = 'auto'; } catch { /* ignore */ }
                }
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });
            streamRef.current = stream;

            const mime = getBestMimeType();
            const options: MediaRecorderOptions = mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : {};

            const mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const finalMimeType = mime || 'audio/webm';
                const audioBlob = new Blob(audioChunksRef.current, { type: finalMimeType });
                await teardownMicAndSwitchToPlayback();
                await processAudioSegment(audioBlob, speaker);
            };

            mediaRecorder.start(200);
            setActiveSpeaker(speaker);
        } catch (error) {
            console.error("Error accessing microphone:", error);
            toast({
                title: "Erreur Microphone",
                description: "Impossible d'accéder au microphone.",
                variant: "destructive",
            });
        }
    };

    const stopManualRecording = () => {
        unlockAudioPlayback();
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
            setActiveSpeaker(null);
        }
    };

    // ============================================================================
    // CLÔTURE & GÉNÉRATION DU BILAN CLINIQUE
    // ============================================================================
    const finishSession = async () => {
        if (messages.length === 0) return;

        if (isHandsFreeActive) {
            stopHandsFreeSession();
        }
        if (activeSpeaker !== null) {
            stopManualRecording();
        }

        setIsGeneratingSynthesis(true);
        try {
            const fullTranscript = messages.map(m => {
                const role = m.speaker === 'therapeut' ? 'Guillaume Philippe (FR)' : `Patient (${selectedLang.name})`;
                const frText = m.speaker === 'therapeut' ? m.originalText : m.translatedText;
                const foreignText = m.speaker === 'therapeut' ? m.translatedText : m.originalText;
                return `**${role}** : ${frText}\n*(${selectedLang.label}: ${foreignText})*`;
            }).join("\n\n");

            if (onConversationComplete) {
                await onConversationComplete(fullTranscript);
            } else {
                const formData = new FormData();
                formData.append("transcript", fullTranscript);
                formData.append("targetLanguage", selectedLang.name);

                if (attachedFiles && attachedFiles.length > 0) {
                    attachedFiles.forEach((file) => {
                        formData.append("files", file);
                    });
                }

                const response = await fetch("/api/analyze-transcript", {
                    method: "POST",
                    body: formData,
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || "Erreur lors de la génération de la synthèse");
                }

                const result = await response.json();
                const textBlob = new Blob([fullTranscript], { type: 'text/plain; charset=utf-8' });

                if (onRecordingComplete) {
                    await onRecordingComplete(textBlob, result);
                }
            }

            await db.drafts.delete('bilingual');
            setDraftExists(false);
            setMessages([]);

        } catch (error: unknown) {
            console.error("Synthesis error:", error);
            toast({
                title: "Erreur Synthèse",
                description: error instanceof Error ? error.message : "Impossible de générer le bilan final.",
                variant: "destructive",
            });
        } finally {
            setIsGeneratingSynthesis(false);
        }
    };

    const isBusy = isTranslating || isGeneratingSynthesis || isProcessing;

    return (
        <Card className="w-full max-w-4xl mx-auto border-[#bd613c]/30 shadow-sm bg-white overflow-hidden flex flex-col min-h-[520px]">
            <CardHeader className="bg-[#ebd9c8]/30 border-b border-[#bd613c]/10 pb-3 px-3 sm:px-6">
                <div className="flex flex-col gap-3">
                    {/* Ligne 1 : Titre + Sélecteur de Langue */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Globe2 className="w-5 h-5 text-[#bd613c]" />
                            <CardTitle className="font-bebas tracking-wide text-xl sm:text-2xl text-[#bd613c] uppercase">
                                Traducteur Bilingue Vocal Turbo
                            </CardTitle>
                        </div>

                        <div className="flex items-center gap-1.5 bg-white px-3 py-1 rounded-full border border-[#bd613c]/30 shadow-2xs">
                            <span className="text-sm">{selectedLang.flag}</span>
                            <select
                                value={targetLanguage}
                                onChange={(e) => setTargetLanguage(e.target.value)}
                                disabled={isHandsFreeActive || activeSpeaker !== null || isBusy}
                                className="text-xs sm:text-sm bg-transparent border-none text-[#4a3f35] font-semibold focus:outline-none cursor-pointer pr-1"
                            >
                                {SUPPORTED_LANGUAGES.map(lang => (
                                    <option key={lang.code} value={lang.code}>
                                        {lang.flag} {lang.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Ligne 2 : Mode de capture (Mains Libres vs Push-to-Talk) + Voix Françaises de France & Britanniques */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#bd613c]/10">
                        {/* Sélecteur de mode */}
                        <div className="flex bg-[#ebd9c8]/50 p-0.5 rounded-full border border-[#bd613c]/20">
                            <button
                                type="button"
                                onClick={() => {
                                    if (activeSpeaker !== null) stopManualRecording();
                                    setTranslationMode('conversation');
                                }}
                                disabled={isBusy}
                                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                                    translationMode === 'conversation'
                                        ? 'bg-[#bd613c] text-white shadow-xs'
                                        : 'text-[#4a3f35]/70 hover:text-[#4a3f35]'
                                }`}
                            >
                                🎙️ Mains Libres (Auto)
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (isHandsFreeActive) stopHandsFreeSession();
                                    setTranslationMode('realtime');
                                }}
                                disabled={isBusy}
                                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                                    translationMode === 'realtime'
                                        ? 'bg-[#bd613c] text-white shadow-xs'
                                        : 'text-[#4a3f35]/70 hover:text-[#4a3f35]'
                                }`}
                            >
                                ⚡ Manuel (Push-to-Talk)
                            </button>
                        </div>

                        {/* Options Vocales (Mode TTS + Choix Voix Française de France + Vitesse) */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            <div className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-full border border-[#bd613c]/20 text-xs">
                                {ttsMode === 'mute' ? (
                                    <VolumeX className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                ) : (
                                    <Volume2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                )}
                                <select
                                    value={ttsMode}
                                    onChange={(e) => {
                                        const val = e.target.value as TTSMode;
                                        setTtsMode(val);
                                        if (val === 'mute') stopSpeaking();
                                    }}
                                    className="bg-transparent border-none text-[#4a3f35] font-medium focus:outline-none cursor-pointer text-[11px] sm:text-xs"
                                    title="Mode de lecture vocale automatique"
                                >
                                    <option value="all">🔊 Lire tout (FR ⇄ {selectedLang.label})</option>
                                    <option value="patient_only">🗣️ Lire au patient ({selectedLang.label})</option>
                                    <option value="mute">🔇 Muet (Texte seul)</option>
                                </select>
                            </div>

                            {ttsMode !== 'mute' && (
                                <>
                                    {/* Sélecteur de Voix Humaine Chaleureuse (Français de France Paris) */}
                                    <div className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-full border border-[#bd613c]/20 text-[11px] sm:text-xs">
                                        <HeartHandshake className="w-3.5 h-3.5 text-[#bd613c] shrink-0" />
                                        <select
                                            value={voicePreset}
                                            onChange={(e) => setVoicePreset(e.target.value)}
                                            className="bg-transparent border-none text-[#4a3f35] font-semibold focus:outline-none cursor-pointer"
                                            title="Choisir le timbre de voix humaine (Français de France)"
                                        >
                                            {WARM_VOICE_PRESETS.map(v => (
                                                <option key={v.id} value={v.id}>
                                                    {v.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex items-center bg-white px-2 py-1 rounded-full border border-[#bd613c]/20 text-[11px]">
                                        <select
                                            value={speechRate}
                                            onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                                            className="bg-transparent border-none text-[#4a3f35] font-medium focus:outline-none cursor-pointer"
                                            title="Cadence de la voix"
                                        >
                                            <option value={0.9}>0.9x (Apaisé)</option>
                                            <option value={1.0}>1.0x (Naturel)</option>
                                            <option value={1.1}>1.1x (Dynamique)</option>
                                        </select>
                                    </div>
                                </>
                            )}

                            {isPlayingAudio && (
                                <button
                                    type="button"
                                    onClick={stopSpeaking}
                                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors cursor-pointer"
                                >
                                    ⏹️ Stop Voix
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </CardHeader>

            {/* Fil de discussion Bilingue */}
            <div className="flex-1 p-3 sm:p-5 overflow-y-auto space-y-3 bg-[#FAF7F2]/50 max-h-[340px] min-h-[220px]">
                {draftExists && messages.length === 0 && !isHandsFreeActive && activeSpeaker === null && (
                    <div className="w-full p-3.5 mb-3 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
                        <div className="flex items-center gap-2.5">
                            <span className="text-xl">⚠️</span>
                            <div className="text-left">
                                <h4 className="font-semibold text-amber-900 text-xs sm:text-sm">Conversation bilingue non terminée</h4>
                                <p className="text-[11px] text-amber-700">Voulez-vous restaurer les échanges précédents ?</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button variant="outline" size="sm" onClick={discardDraft} className="text-xs border-amber-300 text-amber-800 hover:bg-amber-100 h-8">
                                Ignorer
                            </Button>
                            <Button size="sm" onClick={recoverDraft} className="text-xs bg-amber-600 hover:bg-amber-700 text-white h-8">
                                Restaurer
                            </Button>
                        </div>
                    </div>
                )}

                {messages.length === 0 && !isTranslating && (
                    <div className="h-44 flex flex-col items-center justify-center text-slate-400 text-center px-4">
                        <Sparkles className="w-8 h-8 mb-2 opacity-50 text-[#bd613c]" />
                        <p className="text-sm font-medium text-[#4a3f35]/80">
                            {translationMode === 'conversation'
                                ? `Mode Mains Libres Turbo : Cliquez sur « Démarrer » puis parlez librement en Français ou en ${selectedLang.name}.`
                                : `Mode Manuel : Cliquez sur « Guillaume (FR) » ou « Patient (${selectedLang.label}) » pour enregistrer et traduire.`}
                        </p>
                        <p className="text-xs text-[#8c7b6d] mt-1">
                            Réponse instantanée (&lt; 0.8s) • Voix Studio Françaises de France (Victoria, Lucie, Nicolas) &amp; Britanniques.
                        </p>
                    </div>
                )}

                {messages.map((msg) => {
                    const isTherapeut = msg.speaker === 'therapeut';
                    const originalLangCode = isTherapeut ? 'fr-FR' : targetLanguage;
                    const translatedLangCode = isTherapeut ? targetLanguage : 'fr-FR';

                    return (
                        <div
                            key={msg.id}
                            className={`flex flex-col max-w-[88%] rounded-2xl p-3.5 shadow-2xs ${
                                isTherapeut
                                    ? 'bg-[#ebd9c8]/40 text-[#4a3f35] self-start mr-auto rounded-tl-none border border-[#bd613c]/15'
                                    : 'bg-[#bd613c] text-white self-end ml-auto rounded-tr-none'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-3 mb-1 opacity-85 text-[11px] font-bold uppercase tracking-wider">
                                <span>
                                    {isTherapeut ? '🇫🇷 Guillaume (FR → ' + selectedLang.label + ')' : `${selectedLang.flag} Patient (${selectedLang.label} → FR)`}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => speakText(msg.translatedText, translatedLangCode, msg.speaker)}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors cursor-pointer ${
                                            isTherapeut
                                                ? 'bg-white/80 text-[#bd613c] hover:bg-white border border-[#bd613c]/20'
                                                : 'bg-white/20 text-white hover:bg-white/30'
                                        }`}
                                        title="Réécouter la traduction avec voix chaleureuse"
                                    >
                                        <Volume2 className="w-3 h-3" /> Écouter
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => speakText(msg.originalText, originalLangCode, msg.speaker)}
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] opacity-75 hover:opacity-100 transition-opacity cursor-pointer ${
                                            isTherapeut ? 'text-[#5a4e44]' : 'text-white/90'
                                        }`}
                                        title="Écouter la phrase originale"
                                    >
                                        Orig.
                                    </button>
                                </div>
                            </div>

                            {/* Texte original */}
                            <p className={`text-xs mb-1.5 italic ${isTherapeut ? 'text-[#4a3f35]/75' : 'text-white/80'}`}>
                                &ldquo;{msg.originalText}&rdquo;
                            </p>

                            {/* Traduction mise en avant */}
                            <p className={`text-sm sm:text-base font-semibold leading-snug pt-1.5 border-t ${
                                isTherapeut ? 'border-[#bd613c]/15 text-[#bd613c]' : 'border-white/20 text-white'
                            }`}>
                                {msg.translatedText}
                            </p>
                        </div>
                    );
                })}

                {isTranslating && (
                    <div className="flex items-center gap-2 text-[#bd613c] text-xs font-medium p-2.5 bg-white/80 rounded-xl w-fit shadow-2xs border border-[#ebd9c8] animate-pulse">
                        <Loader2 className="w-4 h-4 animate-spin" /> Traduction instantanée...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Contrôles d'enregistrement en bas */}
            <CardContent className="p-3 sm:p-5 bg-white border-t border-[#bd613c]/10 flex flex-col gap-3">
                {translationMode === 'conversation' ? (
                    <div className="w-full flex flex-col items-center gap-2.5">
                        {isHandsFreeActive && (
                            <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-[#FAF7F2] border border-[#ebd9c8]">
                                <div className="flex items-center gap-2.5">
                                    <span className={`w-2.5 h-2.5 rounded-full ${
                                        handsFreeStatus === 'speaking_detected'
                                            ? 'bg-emerald-500 animate-ping'
                                            : handsFreeStatus === 'translating'
                                            ? 'bg-amber-500 animate-pulse'
                                            : handsFreeStatus === 'tts_playing'
                                            ? 'bg-blue-500 animate-pulse'
                                            : 'bg-emerald-500'
                                    }`} />
                                    <span className="text-xs font-semibold text-[#4a3f35]">
                                        {handsFreeStatus === 'speaking_detected' && "🗣️ Parole détectée (traduction dès la fin de phrase)..."}
                                        {handsFreeStatus === 'translating' && "⚡ Traduction Turbo en cours (< 0.8s)..."}
                                        {handsFreeStatus === 'tts_playing' && "🔊 Lecture vocale chaleureuse (micro coupé anti-écho)..."}
                                        {handsFreeStatus === 'listening' && `👂 En écoute automatique (Français ⇄ ${selectedLang.name})...`}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                    {/* Jauge visuelle de niveau vocal */}
                                    <div className="w-20 h-2 bg-stone-200 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-emerald-500 transition-all duration-75"
                                            style={{ width: `${vadLevel}%` }}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={flushCurrentHandsFreeSegment}
                                        disabled={isTranslating || isPlayingAudio}
                                        className="h-7 px-2.5 text-[11px] border-[#bd613c]/30 text-[#bd613c] hover:bg-[#ebd9c8]/30"
                                        title="Forcer la traduction immédiate de la phrase en cours"
                                    >
                                        <Send className="w-3 h-3 mr-1" /> Traduire maintenant
                                    </Button>
                                </div>
                            </div>
                        )}

                        <Button
                            type="button"
                            onClick={() => {
                                if (isHandsFreeActive) {
                                    stopHandsFreeSession();
                                } else {
                                    startHandsFreeSession();
                                }
                            }}
                            disabled={isGeneratingSynthesis}
                            className={`w-full h-14 sm:h-16 rounded-2xl flex items-center justify-center gap-3 transition-all text-white shadow-md cursor-pointer ${
                                isHandsFreeActive
                                    ? 'bg-red-500 hover:bg-red-600'
                                    : 'bg-emerald-600 hover:bg-emerald-700'
                            }`}
                        >
                            {isHandsFreeActive ? (
                                <>
                                    <Square className="w-5 h-5 fill-current" />
                                    <div className="flex flex-col items-start text-left">
                                        <span className="font-bold text-sm sm:text-base tracking-wide">ARRÊTER L&apos;ÉCOUTE MAINS LIBRES</span>
                                        <span className="text-[11px] opacity-90 font-normal">Cliquez pour mettre en pause la traduction automatique</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <Mic className="w-6 h-6" />
                                    <div className="flex flex-col items-start text-left">
                                        <span className="font-bold text-sm sm:text-base tracking-wide">DÉMARRER LA SÉANCE MAINS LIBRES</span>
                                        <span className="text-[11px] opacity-90 font-normal">Détection vocale automatique Français ⇄ {selectedLang.name}</span>
                                    </div>
                                </>
                            )}
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3 w-full">
                        {/* Bouton Praticien (FR -> Langue étrangère) */}
                        <Button
                            type="button"
                            onClick={() => activeSpeaker === 'therapeut' ? stopManualRecording() : startManualRecording('therapeut')}
                            disabled={(activeSpeaker !== null && activeSpeaker !== 'therapeut') || isBusy}
                            className={`h-16 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                activeSpeaker === 'therapeut'
                                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-inner'
                                    : 'bg-[#ebd9c8]/60 hover:bg-[#ebd9c8] text-[#4a3f35] border border-[#bd613c]/20'
                            }`}
                        >
                            {activeSpeaker === 'therapeut' ? (
                                <>
                                    <Square className="w-5 h-5 fill-current" />
                                    <span className="text-xs font-bold">Arrêter & Traduire ({selectedLang.label})</span>
                                </>
                            ) : (
                                <>
                                    <Mic className="w-5 h-5 text-[#bd613c]" />
                                    <span className="text-xs sm:text-sm font-bold">🇫🇷 Guillaume (FR)</span>
                                    <span className="text-[10px] opacity-75">Traduit vers {selectedLang.name}</span>
                                </>
                            )}
                        </Button>

                        {/* Bouton Patient (Langue étrangère -> FR) */}
                        <Button
                            type="button"
                            onClick={() => activeSpeaker === 'patient' ? stopManualRecording() : startManualRecording('patient')}
                            disabled={(activeSpeaker !== null && activeSpeaker !== 'patient') || isBusy}
                            className={`h-16 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                activeSpeaker === 'patient'
                                    ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-inner'
                                    : 'bg-[#bd613c] hover:bg-[#a65332] text-white shadow-sm'
                            }`}
                        >
                            {activeSpeaker === 'patient' ? (
                                <>
                                    <Square className="w-5 h-5 fill-current" />
                                    <span className="text-xs font-bold">Arrêter & Traduire (FR)</span>
                                </>
                            ) : (
                                <>
                                    <Mic className="w-5 h-5" />
                                    <span className="text-xs sm:text-sm font-bold">{selectedLang.flag} Patient ({selectedLang.label})</span>
                                    <span className="text-[10px] opacity-85">Traduit vers Français</span>
                                </>
                            )}
                        </Button>
                    </div>
                )}

                {/* Bouton de clôture et génération du Bilan */}
                {messages.length > 0 && (
                    <Button
                        type="button"
                        onClick={finishSession}
                        disabled={isBusy}
                        className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm transition-all cursor-pointer"
                    >
                        {isGeneratingSynthesis ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Génération du Bilan en Français...
                            </>
                        ) : (
                            <>
                                <Check className="w-4 h-4 mr-2" /> Terminer et créer le Bilan ({messages.length} échange{messages.length > 1 ? 's' : ''})
                            </>
                        )}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

export default BilingualRecorder;
