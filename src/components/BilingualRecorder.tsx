"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Square, Loader2, Volume2, VolumeX, Globe2, Sparkles, Check, Send } from "lucide-react";
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

type TranslationMode = 'conversation' | 'realtime';
type TTSMode = 'all' | 'patient_only' | 'mute';

export function BilingualRecorder({ onRecordingComplete, onConversationComplete, attachedFiles = [], isProcessing = false }: BilingualRecorderProps) {
    const [targetLanguage, setTargetLanguage] = useState<string>('en-US');
    const [translationMode, setTranslationMode] = useState<TranslationMode>('conversation');
    const [ttsMode, setTtsMode] = useState<TTSMode>('all');
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
    const speechStartMsRef = useRef<number>(0);
    const lastSpeechMsRef = useRef<number>(0);
    const segmentStartMsRef = useRef<number>(0);
    const isProcessingSegmentRef = useRef<boolean>(false);
    const isPlayingTTSRef = useRef<boolean>(false);
    const mimeTypeRef = useRef<string>('audio/webm');

    // Keep latest state in refs for async callbacks
    const targetLanguageRef = useRef(targetLanguage);
    useEffect(() => { targetLanguageRef.current = targetLanguage; }, [targetLanguage]);

    const ttsModeRef = useRef(ttsMode);
    useEffect(() => { ttsModeRef.current = ttsMode; }, [ttsMode]);

    const speechRateRef = useRef(speechRate);
    useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);

    const selectedLang = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage) || SUPPORTED_LANGUAGES[0];

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTranslating]);

    // Preload browser TTS voices (Chrome/Safari populate voices asynchronously)
    useEffect(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => {
                window.speechSynthesis.getVoices();
            };
        }
    }, []);

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
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
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

    // Déverrouillage synchrone de la synthèse vocale pour iOS / Safari
    const unlockSpeechSynthesis = () => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            try {
                const unlockUtterance = new SpeechSynthesisUtterance('');
                unlockUtterance.volume = 0;
                window.speechSynthesis.speak(unlockUtterance);
                if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                }
            } catch (e) {
                console.warn("SpeechSynthesis unlock warning:", e);
            }
        }
    };

    const stopSpeaking = useCallback(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        isPlayingTTSRef.current = false;
        setIsPlayingAudio(false);
    }, []);

    const speakText = useCallback((text: string, langCode: string): Promise<void> => {
        return new Promise((resolve) => {
            if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) {
                resolve();
                return;
            }

            try {
                window.speechSynthesis.cancel();
                if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                }

                const cleanText = text
                    .replace(/[*#_~`]/g, '')
                    .replace(/\[.*?\]/g, '')
                    .trim();

                if (!cleanText) {
                    resolve();
                    return;
                }

                const utterance = new SpeechSynthesisUtterance(cleanText);
                utterance.lang = langCode;
                utterance.rate = speechRateRef.current;

                const voices = window.speechSynthesis.getVoices();
                const langPrefix = langCode.split('-')[0].toLowerCase();
                const matchingVoices = voices.filter(v => v.lang.toLowerCase().startsWith(langPrefix));

                if (matchingVoices.length > 0) {
                    const premiumVoice =
                        matchingVoices.find(v =>
                            v.name.includes('Premium') ||
                            v.name.includes('Enhanced') ||
                            v.name.includes('Natural') ||
                            v.name.includes('Google') ||
                            v.name.includes('Thomas') ||
                            v.name.includes('Amélie') ||
                            v.name.includes('Audrey') ||
                            v.name.includes('Samantha') ||
                            v.name.includes('Daniel') ||
                            v.name.includes('Kyoko') ||
                            v.name.includes('Yuna') ||
                            v.name.includes('Tingting') ||
                            v.name.includes('Milena') ||
                            v.name.includes(' Monica') ||
                            v.name.includes('Paulina')
                        ) || matchingVoices[0];

                    utterance.voice = premiumVoice;
                }

                // Safety timeout in case onend doesn't fire on some mobile browsers
                const maxDurationMs = Math.max(4000, Math.min(30000, cleanText.length * 120));
                const safetyTimer = setTimeout(() => {
                    isPlayingTTSRef.current = false;
                    setIsPlayingAudio(false);
                    resolve();
                }, maxDurationMs);

                utterance.onstart = () => {
                    isPlayingTTSRef.current = true;
                    setIsPlayingAudio(true);
                };
                utterance.onend = () => {
                    clearTimeout(safetyTimer);
                    isPlayingTTSRef.current = false;
                    setIsPlayingAudio(false);
                    resolve();
                };
                utterance.onerror = () => {
                    clearTimeout(safetyTimer);
                    isPlayingTTSRef.current = false;
                    setIsPlayingAudio(false);
                    resolve();
                };

                window.speechSynthesis.speak(utterance);
            } catch (e) {
                console.error("TTS error:", e);
                isPlayingTTSRef.current = false;
                setIsPlayingAudio(false);
                resolve();
            }
        });
    }, []);

    const getBestMimeType = (): string => {
        if (typeof MediaRecorder === 'undefined') return 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
        if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
        return '';
    };

    // Envoi d'un segment audio à /api/translate (supporte 'therapeut', 'patient', et 'bidirectional')
    const processAudioSegment = useCallback(async (audioBlob: Blob, speakerRole: 'therapeut' | 'patient' | 'bidirectional') => {
        if (audioBlob.size < 600) return;

        setIsTranslating(true);
        if (handsFreeActiveRef.current) {
            setHandsFreeStatus('translating');
        }

        const currentLangObj = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguageRef.current) || SUPPORTED_LANGUAGES[0];
        const tempId = Date.now().toString() + "_" + Math.random().toString(36).substring(2, 6);

        try {
            const formData = new FormData();
            formData.append("audio", audioBlob);
            formData.append("speaker", speakerRole);
            formData.append("targetLanguage", currentLangObj.name);

            const response = await fetch("/api/translate", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || "Erreur lors de la traduction");
            }

            if (!response.body) throw new Error("Aucun flux de données reçu");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let done = false;
            let fullText = "";
            let messageCreated = false;
            let resolvedSpeaker: 'therapeut' | 'patient' = speakerRole === 'patient' ? 'patient' : 'therapeut';

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    fullText += decoder.decode(value, { stream: true });

                    if (fullText.includes("[SILENCE]")) {
                        break;
                    }

                    // Extract [SPEAKER] if present
                    const speakerMatch = fullText.match(/\[SPEAKER\]\s*(therapeut|patient)/i);
                    if (speakerMatch) {
                        resolvedSpeaker = speakerMatch[1].toLowerCase() === 'patient' ? 'patient' : 'therapeut';
                    }

                    const transIndex = fullText.indexOf("[TRANSCRIPTION]");
                    const translIndex = fullText.indexOf("[TRANSLATION]");

                    let currentTranscription = "";
                    let currentTranslation = "";

                    if (transIndex !== -1 && translIndex !== -1) {
                        currentTranscription = fullText.substring(transIndex + "[TRANSCRIPTION]".length, translIndex).trim();
                        currentTranslation = fullText.substring(translIndex + "[TRANSLATION]".length).trim();
                    } else if (transIndex !== -1) {
                        currentTranscription = fullText.substring(transIndex + "[TRANSCRIPTION]".length).trim();
                    }

                    if (currentTranscription || currentTranslation) {
                        if (!messageCreated) {
                            messageCreated = true;
                            setMessages(prev => [
                                ...prev,
                                {
                                    id: tempId,
                                    speaker: resolvedSpeaker,
                                    originalText: currentTranscription || "...",
                                    translatedText: currentTranslation || "...",
                                    timestamp: new Date()
                                }
                            ]);
                        } else {
                            setMessages(prev => prev.map(msg =>
                                msg.id === tempId
                                    ? {
                                        ...msg,
                                        speaker: resolvedSpeaker,
                                        originalText: currentTranscription || "...",
                                        translatedText: currentTranslation || "..."
                                    }
                                    : msg
                            ));
                        }
                    }
                }
            }

            // Si l'extrait était du silence pur, ne rien afficher
            if (fullText.includes("[SILENCE]")) {
                if (messageCreated) {
                    setMessages(prev => prev.filter(m => m.id !== tempId));
                }
                return;
            }

            const finalTransIndex = fullText.indexOf("[TRANSCRIPTION]");
            const finalTranslIndex = fullText.indexOf("[TRANSLATION]");
            let finalTranscription = "";
            let finalTranslation = "";

            if (finalTransIndex !== -1 && finalTranslIndex !== -1) {
                finalTranscription = fullText.substring(finalTransIndex + "[TRANSCRIPTION]".length, finalTranslIndex).trim();
                finalTranslation = fullText.substring(finalTranslIndex + "[TRANSLATION]".length).trim();
            }

            if (!finalTranscription && !finalTranslation) {
                if (messageCreated) {
                    setMessages(prev => prev.filter(m => m.id !== tempId));
                }
                return;
            }

            // Sauvegarder dans IndexedDB
            setMessages(prev => {
                const updated = prev.map(msg =>
                    msg.id === tempId
                        ? { ...msg, speaker: resolvedSpeaker, originalText: finalTranscription, translatedText: finalTranslation }
                        : msg
                );
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

            // Lecture vocale automatique selon ttsMode
            const currentTtsMode = ttsModeRef.current;
            const shouldSpeak =
                currentTtsMode === 'all' ||
                (currentTtsMode === 'patient_only' && resolvedSpeaker === 'therapeut');

            if (shouldSpeak && finalTranslation) {
                const targetLangCode = resolvedSpeaker === 'therapeut' ? targetLanguageRef.current : 'fr-FR';
                if (handsFreeActiveRef.current) {
                    setHandsFreeStatus('tts_playing');
                }
                await speakText(finalTranslation, targetLangCode);
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
            if (handsFreeActiveRef.current) {
                setHandsFreeStatus('listening');
            }
        }
    }, [speakText, toast]);

    // ============================================================================
    // MODE 1 : MAINS LIBRES AUTOMATIQUE (VAD + Détection Automatique de Langue)
    // ============================================================================
    const startNewHandsFreeSegment = useCallback(() => {
        if (!handsFreeActiveRef.current || !handsFreeStreamRef.current) return;
        if (segmentRecorderRef.current && segmentRecorderRef.current.state !== 'inactive') {
            return;
        }

        try {
            const mime = mimeTypeRef.current;
            const options: MediaRecorderOptions = mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : {};
            const recorder = new MediaRecorder(handsFreeStreamRef.current, options);
            segmentChunksRef.current = [];
            hasSpeechInSegmentRef.current = false;
            segmentStartMsRef.current = Date.now();

            recorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) {
                    segmentChunksRef.current.push(ev.data);
                }
            };

            recorder.onstop = async () => {
                const hadSpeech = hasSpeechInSegmentRef.current;
                const chunks = [...segmentChunksRef.current];
                segmentChunksRef.current = [];
                hasSpeechInSegmentRef.current = false;

                if (hadSpeech && chunks.length > 0 && handsFreeActiveRef.current) {
                    const blob = new Blob(chunks, { type: mime || 'audio/webm' });
                    if (blob.size >= 800) {
                        isProcessingSegmentRef.current = true;
                        await processAudioSegment(blob, 'bidirectional');
                        isProcessingSegmentRef.current = false;
                    }
                }

                // Relancer immédiatement l'écoute du segment suivant si le mode Mains Libres est toujours actif
                if (handsFreeActiveRef.current) {
                    startNewHandsFreeSegment();
                }
            };

            segmentRecorderRef.current = recorder;
            recorder.start(250);
            setHandsFreeStatus('listening');
        } catch (err) {
            console.error("Failed to start hands-free segment recorder:", err);
        }
    }, [processAudioSegment]);

    const startHandsFreeSession = async () => {
        try {
            unlockSpeechSynthesis();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass();
            audioContextRef.current = audioCtx;
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume().catch(console.error);
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });
            handsFreeStreamRef.current = stream;
            mimeTypeRef.current = getBestMimeType();

            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.5;
            source.connect(analyser);
            analyserRef.current = analyser;

            handsFreeActiveRef.current = true;
            setIsHandsFreeActive(true);
            setHandsFreeStatus('listening');

            startNewHandsFreeSegment();

            const freqData = new Uint8Array(analyser.frequencyBinCount);
            const SPEECH_THRESHOLD = 22; // Sensibilité vocale calibrée
            const SILENCE_DURATION_MS = 1350; // 1.35s de silence déclenche la traduction
            const MAX_SEGMENT_SPEECH_MS = 24000; // Sécurité 24s max par phrase
            const IDLE_RESET_MS = 9000; // Nettoyage du buffer toutes les 9s de silence

            const monitorVad = () => {
                if (!handsFreeActiveRef.current || !analyserRef.current) return;
                vadRafRef.current = requestAnimationFrame(monitorVad);

                // Ne pas écouter pendant que le haut-parleur lit la traduction ou qu'une traduction est en cours
                if (isPlayingTTSRef.current || isProcessingSegmentRef.current) {
                    setVadLevel(0);
                    return;
                }

                analyserRef.current.getByteFrequencyData(freqData);

                // Moyenne d'énergie sur la bande fréquentielle de la voix humaine
                let sum = 0;
                const voiceBins = Math.min(80, freqData.length);
                for (let i = 2; i < voiceBins; i++) {
                    sum += freqData[i];
                }
                const avgEnergy = sum / (voiceBins - 2);
                const normalizedLevel = Math.min(100, Math.round((avgEnergy / 80) * 100));
                setVadLevel(normalizedLevel);

                const now = Date.now();
                const recorder = segmentRecorderRef.current;

                if (avgEnergy > SPEECH_THRESHOLD) {
                    if (!hasSpeechInSegmentRef.current) {
                        hasSpeechInSegmentRef.current = true;
                        speechStartMsRef.current = now;
                        setHandsFreeStatus('speaking_detected');
                    }
                    lastSpeechMsRef.current = now;

                    // Si la personne parle sans pause depuis > 24s, envoyer le segment
                    if (now - speechStartMsRef.current > MAX_SEGMENT_SPEECH_MS && recorder && recorder.state === 'recording') {
                        recorder.stop();
                    }
                } else {
                    if (hasSpeechInSegmentRef.current) {
                        // Une prise de parole est en cours : vérifier si le silence dépasse 1.35s
                        const speechDuration = lastSpeechMsRef.current - speechStartMsRef.current;
                        if (now - lastSpeechMsRef.current > SILENCE_DURATION_MS) {
                            if (speechDuration >= 350 && recorder && recorder.state === 'recording') {
                                recorder.stop();
                            } else {
                                // Bruit trop bref (< 350ms), ignorer
                                hasSpeechInSegmentRef.current = false;
                                setHandsFreeStatus('listening');
                            }
                        }
                    } else {
                        // Aucun son détecté depuis 9 secondes : purger le buffer silencieux
                        if (now - segmentStartMsRef.current > IDLE_RESET_MS && recorder && recorder.state === 'recording') {
                            recorder.stop();
                        }
                    }
                }
            };

            vadRafRef.current = requestAnimationFrame(monitorVad);

            toast({
                title: "🎙️ Mode Mains Libres activé",
                description: `Parlez en Français ou en ${selectedLang.name} : la détection et la traduction sont automatiques.`,
            });
        } catch (err) {
            console.error("Erreur démarrage Mains Libres:", err);
            toast({
                title: "Erreur Microphone",
                description: "Impossible d'accéder au microphone. Vérifiez les autorisations du navigateur.",
                variant: "destructive",
            });
            stopHandsFreeSession();
        }
    };

    const flushCurrentHandsFreeSegment = () => {
        if (segmentRecorderRef.current && segmentRecorderRef.current.state === 'recording') {
            hasSpeechInSegmentRef.current = true;
            segmentRecorderRef.current.stop();
        }
    };

    const stopHandsFreeSession = useCallback(() => {
        handsFreeActiveRef.current = false;
        setIsHandsFreeActive(false);
        setHandsFreeStatus('idle');
        setVadLevel(0);

        if (vadRafRef.current) {
            cancelAnimationFrame(vadRafRef.current);
            vadRafRef.current = null;
        }
        if (segmentRecorderRef.current && segmentRecorderRef.current.state !== 'inactive') {
            hasSpeechInSegmentRef.current = false;
            try { segmentRecorderRef.current.stop(); } catch { /* ignore */ }
        }
        segmentRecorderRef.current = null;

        if (handsFreeStreamRef.current) {
            handsFreeStreamRef.current.getTracks().forEach(t => t.stop());
            handsFreeStreamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => {});
            audioContextRef.current = null;
        }
        analyserRef.current = null;
        stopSpeaking();
    }, [stopSpeaking]);

    // ============================================================================
    // MODE 2 : MANUEL PUSH-TO-TALK (Guillaume FR / Patient Étranger)
    // ============================================================================
    const startManualRecording = async (speaker: 'therapeut' | 'patient') => {
        try {
            stopSpeaking();
            unlockSpeechSynthesis();

            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
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
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach((track) => track.stop());
                    streamRef.current = null;
                }
                await processAudioSegment(audioBlob, speaker);
            };

            mediaRecorder.start(250);
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
        unlockSpeechSynthesis();
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
                                Traducteur Bilingue Vocal
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

                    {/* Ligne 2 : Mode de capture (Mains Libres vs Push-to-Talk) + Options Vocales (TTS & Vitesse) */}
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

                        {/* Options Vocales (Sortie Audio TTS + Vitesse) */}
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
                                    <option value="all">🔊 Voix : Tout lire (FR ⇄ {selectedLang.label})</option>
                                    <option value="patient_only">🗣️ Voix : Lire au patient ({selectedLang.label})</option>
                                    <option value="mute">🔇 Voix : Muet (Texte seul)</option>
                                </select>
                            </div>

                            {ttsMode !== 'mute' && (
                                <div className="flex items-center bg-white px-2 py-1 rounded-full border border-[#bd613c]/20 text-[11px]">
                                    <select
                                        value={speechRate}
                                        onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                                        className="bg-transparent border-none text-[#4a3f35] font-medium focus:outline-none cursor-pointer"
                                        title="Vitesse de la voix"
                                    >
                                        <option value={0.85}>0.85x (Doux)</option>
                                        <option value={1.0}>1.0x (Normal)</option>
                                        <option value={1.15}>1.15x (Rapide)</option>
                                    </select>
                                </div>
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
                                ? `Mode Mains Libres : Cliquez sur « Démarrer » puis parlez librement en Français ou en ${selectedLang.name}.`
                                : `Mode Manuel : Cliquez sur « Guillaume (FR) » ou « Patient (${selectedLang.label}) » pour enregistrer et traduire.`}
                        </p>
                        <p className="text-xs text-[#8c7b6d] mt-1">
                            La traduction s&apos;affiche en direct et est parlée à voix haute automatiquement.
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
                                        onClick={() => speakText(msg.translatedText, translatedLangCode)}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors cursor-pointer ${
                                            isTherapeut
                                                ? 'bg-white/80 text-[#bd613c] hover:bg-white border border-[#bd613c]/20'
                                                : 'bg-white/20 text-white hover:bg-white/30'
                                        }`}
                                        title="Réécouter la traduction à voix haute"
                                    >
                                        <Volume2 className="w-3 h-3" /> Écouter
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => speakText(msg.originalText, originalLangCode)}
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
                        <Loader2 className="w-4 h-4 animate-spin" /> Traduction médicale en cours...
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
                                        {handsFreeStatus === 'translating' && "⏳ Traduction IA en cours..."}
                                        {handsFreeStatus === 'tts_playing' && "🔊 Lecture vocale de la traduction (micro en pause anti-écho)..."}
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

