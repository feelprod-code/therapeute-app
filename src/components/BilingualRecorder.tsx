"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, Loader2, Volume2, Globe, Trash2, Wifi, WifiOff, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/db";
import { useRealtime } from "@/hooks/use-realtime";

type ChatMessage = {
    id: string;
    sender: 'therapeut' | 'patient';
    speakerName: string;
    transcription: string;
    translation: string;
    patientLangCode: string;
    patientLangTts: string;
    isStreaming?: boolean;
};

const PRACTITIONER_NAME = "Guillaume Philippe";

const LANGUAGES = [
    { code: 'Anglais', label: 'Anglais (EN)', tts: 'en-US', flag: '🇬🇧' },
    { code: 'Espagnol', label: 'Espagnol (ES)', tts: 'es-ES', flag: '🇪🇸' },
    { code: 'Allemand', label: 'Allemand (DE)', tts: 'de-DE', flag: '🇩🇪' },
    { code: 'Italien', label: 'Italien (IT)', tts: 'it-IT', flag: '🇮🇹' },
    { code: 'Portugais', label: 'Portugais (BR)', tts: 'pt-BR', flag: '🇵🇹' },
    { code: 'Arabe', label: 'Arabe (AR)', tts: 'ar-SA', flag: '🇸🇦' },
    { code: 'Russe', label: 'Russe (RU)', tts: 'ru-RU', flag: '🇷🇺' },
    { code: 'Turc', label: 'Turc (TR)', tts: 'tr-TR', flag: '🇹🇷' },
    { code: 'Chinois', label: 'Chinois (ZH)', tts: 'zh-CN', flag: '🇨🇳' },
    { code: 'Japonais', label: 'Japonais (JA)', tts: 'ja-JP', flag: '🇯🇵' },
    { code: 'Polonais', label: 'Polonais (PL)', tts: 'pl-PL', flag: '🇵🇱' },
    { code: 'Hindi', label: 'Hindi (HI)', tts: 'hi-IN', flag: '🇮🇳' },
];

export default function BilingualRecorder({
    onRecordingComplete,
    attachedFiles = []
}: {
    onRecordingComplete: (audioBlob: Blob, data: Record<string, string>) => void;
    attachedFiles?: File[];
}) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [patientLang, setPatientLang] = useState(LANGUAGES[0]);
    const [patientName, setPatientName] = useState<string>("Patient Anglais");
    const [isRecording, setIsRecording] = useState(false);
    const [recordingRole, setRecordingRole] = useState<'therapeut' | 'patient' | null>(null);
    const [isTranslating, setIsTranslating] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [draftExists, setDraftExists] = useState(false);
    const [draftRole, setDraftRole] = useState<'therapeut' | 'patient' | null>(null);
    const [translationMode, setTranslationMode] = useState<'conversation' | 'realtime' | 'classic'>('conversation');
    const [realtimeRole, setRealtimeRole] = useState<'therapeut' | 'patient' | 'bidirectional' | null>(null);
    const realtimeMessageIdRef = useRef<string | null>(null);
    const [chatExpanded, setChatExpanded] = useState(false);
    const [sessionSeconds, setSessionSeconds] = useState(0);

    const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
    const wakeLockRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<BlobPart[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const recordStartTimeRef = useRef<Date | null>(null);
    const mimeTypeRef = useRef<string>('audio/webm');
    const streamRef = useRef<MediaStream | null>(null);
    const { toast } = useToast();
    const { connect, disconnect, isConnected, isConnecting } = useRealtime();

    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            }
        } catch (err) {
            console.log('WakeLock not supported or disabled', err);
        }
    };

    const releaseWakeLock = () => {
        if (wakeLockRef.current) {
            wakeLockRef.current.release().catch(console.error);
            wakeLockRef.current = null;
        }
    };

    const startSessionTimer = () => {
        if (!sessionTimerRef.current) {
            sessionTimerRef.current = setInterval(() => {
                setSessionSeconds(prev => prev + 1);
            }, 1000);
        }
    };

    const stopSessionTimer = () => {
        if (sessionTimerRef.current) {
            clearInterval(sessionTimerRef.current);
            sessionTimerRef.current = null;
        }
    };

    const formatSessionTime = (seconds: number) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hrs > 0) {
            return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
        }
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    // Pre-load voices on mount to ensure premium voices are available
    useEffect(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => {
                window.speechSynthesis.getVoices();
            };
        }
    }, []);

    useEffect(() => {
        // Verify if a draft exists on mount
        const checkDraft = async () => {
            const draft = await db.drafts.get('bilingual');
            if (draft && draft.audioChunks.length > 0) {
                setDraftExists(true);
                if (draft.bilingualRole) setDraftRole(draft.bilingualRole);
            }
        };
        checkDraft();

        // CLEANUP DU MICROPHONE SI ON CHANGE D'ONGLET
        return () => {
            stopSessionTimer();
            releaseWakeLock();
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    useEffect(() => {
        // Auto-scroll to bottom of chat
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const recoverDraft = async () => {
        const draft = await db.drafts.get('bilingual');
        if (draft && draft.audioChunks.length > 0 && draft.bilingualRole) {
            const audioBlob = new Blob(draft.audioChunks, { type: draft.mimeType || 'audio/webm' });
            const success = await handleTranslation(audioBlob, draft.bilingualRole);
            if (success) {
                await db.drafts.delete('bilingual');
                setDraftExists(false);
                setDraftRole(null);
                toast({
                    title: "Brouillon récupéré",
                    description: "Le segment audio interrompu a été traduit.",
                });
            } else {
                toast({
                    title: "Erreur",
                    description: "La traduction du brouillon a de nouveau échoué.",
                    variant: "destructive",
                });
            }
        }
    };

    const discardDraft = async () => {
        await db.drafts.delete('bilingual');
        setDraftExists(false);
        setDraftRole(null);
        toast({
            title: "Brouillon supprimé",
            description: "Le segment audio inachevé a été effacé.",
        });
    };

    // ========== REALTIME MODE (push-to-talk + conversation continue) ==========
    const startRealtimeSession = useCallback(async (role: 'therapeut' | 'patient' | 'bidirectional') => {
        if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance('');
            u.volume = 0;
            window.speechSynthesis.speak(u);
        }

        const messageId = Date.now().toString();
        realtimeMessageIdRef.current = messageId;
        setRealtimeRole(role);
        startSessionTimer();
        requestWakeLock();

        const senderRole = role === 'bidirectional' ? 'therapeut' : role;
        const currentSpeaker = senderRole === 'therapeut' ? PRACTITIONER_NAME : (patientName || 'Patient');
        setMessages(prev => [...prev, {
            id: messageId,
            sender: senderRole,
            speakerName: currentSpeaker,
            transcription: '',
            translation: '',
            patientLangCode: patientLang.code,
            patientLangTts: patientLang.tts,
            isStreaming: true,
        }]);

        try {
            await connect(role, patientLang.code, {
                onSpeechStart: () => {},
                onSpeechStop: () => {},
                onTranscript: (text: string) => {
                    const currentId = realtimeMessageIdRef.current;
                    if (currentId) {
                        setMessages(prev => prev.map(m =>
                            m.id === currentId ? { ...m, transcription: text } : m
                        ));
                    }
                },
                onTranslation: (text: string) => {
                    const currentId = realtimeMessageIdRef.current;
                    if (currentId) {
                        setMessages(prev => prev.map(m =>
                            m.id === currentId ? { ...m, translation: text, isStreaming: false } : m
                        ));
                    }
                    // In bidirectional mode, prepare next message for the next utterance
                    if (role === 'bidirectional') {
                        const nextId = Date.now().toString();
                        realtimeMessageIdRef.current = nextId;
                        setMessages(prev => [...prev, {
                            id: nextId,
                            sender: 'therapeut',
                            speakerName: PRACTITIONER_NAME,
                            transcription: '',
                            translation: '',
                            patientLangCode: patientLang.code,
                            patientLangTts: patientLang.tts,
                            isStreaming: true,
                        }]);
                    }
                },
                onDone: () => {
                    if (role !== 'bidirectional') {
                        const currentId = realtimeMessageIdRef.current;
                        if (currentId) {
                            setMessages(prev => prev.map(m =>
                                m.id === currentId ? { ...m, isStreaming: false } : m
                            ));
                        }
                    }
                },
                onError: (error: string) => {
                    console.error('Realtime error:', error);
                    toast({ title: 'Erreur Realtime', description: error, variant: 'destructive' });
                },
            });
        } catch (error) {
            console.warn('WebRTC failed:', error);
            setMessages(prev => prev.filter(m => m.id !== messageId));
            setRealtimeRole(null);
            realtimeMessageIdRef.current = null;
            setTranslationMode('classic');
            toast({ title: 'Mode Classique', description: 'WebRTC indisponible.' });
            if (role !== 'bidirectional') startRecording(role);
        }
    }, [connect, patientLang, patientName, toast]);

    const stopRealtimeSession = useCallback(() => {
        disconnect();
        stopSessionTimer();
        releaseWakeLock();
        const msgId = realtimeMessageIdRef.current;
        if (msgId) {
            // Remove empty trailing message
            setMessages(prev => {
                const last = prev.find(m => m.id === msgId);
                if (last && !last.transcription && !last.translation) {
                    return prev.filter(m => m.id !== msgId);
                }
                return prev.map(m => m.id === msgId ? { ...m, isStreaming: false } : m);
            });
        }
        setRealtimeRole(null);
        realtimeMessageIdRef.current = null;
    }, [disconnect]);

    // ========== CLASSIC RECORDING MODE (SSE FALLBACK) ==========
    const startRecording = async (role: 'therapeut' | 'patient') => {
        // Unlock iOS Audio: Siri/Web Speech API blocks audio after async fetches
        if ('speechSynthesis' in window) {
            const unlockUtterance = new SpeechSynthesisUtterance('');
            unlockUtterance.volume = 0;
            window.speechSynthesis.speak(unlockUtterance);
        }

        try {
            // Nettoyage sécurité avant d'ouvrir un nouveau flux
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Safari iOS fallback logic
            let options = { mimeType: 'audio/webm' };
            if (!MediaRecorder.isTypeSupported('audio/webm')) {
                options = { mimeType: 'audio/mp4' };
            }
            mimeTypeRef.current = options.mimeType;

            const mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];
            recordStartTimeRef.current = new Date();

            // Clear any previous draft
            await db.drafts.delete('bilingual');
            setDraftExists(false);
            setDraftRole(null);

            mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);

                    // Sauvegarde continue
                    await db.drafts.put({
                        id: 'bilingual',
                        mode: 'bilingual',
                        audioChunks: audioChunksRef.current as Blob[],
                        mimeType: mimeTypeRef.current,
                        startedAt: recordStartTimeRef.current || new Date(),
                        lastUpdatedAt: new Date(),
                        bilingualRole: role
                    });
                }
            };

            mediaRecorder.onstop = async () => {
                const finalMimeType = options.mimeType;
                const audioBlob = new Blob(audioChunksRef.current, { type: finalMimeType });

                // Couper le matériel micro IMMÉDIATEMENT même si l'API traduit en arrière plan
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }

                if (audioBlob.size > 0) {
                    handleTranslation(audioBlob, role).then(async (success) => {
                        // Clear draft only on successful translation
                        if (success) {
                            await db.drafts.delete('bilingual');
                        }
                    }).catch(console.error);
                }
            };

            // Collect data every 1 second to safeguard against memory loss
            mediaRecorder.start(1000);
            setRecordingRole(role);
            setIsRecording(true);
            startSessionTimer();
            requestWakeLock();
        } catch (error) {
            console.error("Erreur d'accès au microphone: ", error);
            toast({
                title: "Erreur Microphone",
                description: "Veuillez autoriser l'accès au microphone.",
                variant: "destructive"
            });
        }
    };

    const stopRecording = async () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setRecordingRole(null);
            releaseWakeLock();
        }
    };

    const handleTranslation = async (audioBlob: Blob, role: 'therapeut' | 'patient'): Promise<boolean> => {
        setIsTranslating(true);
        const messageId = Date.now().toString();
        const currentSpeaker = role === 'therapeut' ? PRACTITIONER_NAME : (patientName || 'Patient');

        try {
            const base64Audio = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = (reader.result as string).split(',')[1];
                    resolve(base64);
                };
                reader.readAsDataURL(audioBlob);
            });

            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio: base64Audio, mimeType: audioBlob.type, speaker: role, targetLanguage: patientLang.code })
            });

            if (!res.ok) throw new Error("Erreur de traduction");

            // Créer le message immédiatement en état streaming
            const streamingMessage: ChatMessage = {
                id: messageId,
                sender: role,
                speakerName: currentSpeaker,
                transcription: '',
                translation: '',
                patientLangCode: patientLang.code,
                patientLangTts: patientLang.tts,
                isStreaming: true,
            };
            setMessages(prev => [...prev, streamingMessage]);

            // Lire le flux SSE progressivement
            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parser les événements SSE complets (séparés par \n\n)
                const events = buffer.split('\n\n');
                buffer = events.pop() || ''; // Garder le dernier fragment incomplet

                for (const event of events) {
                    const dataLine = event.trim();
                    if (!dataLine.startsWith('data: ')) continue;

                    try {
                        const data = JSON.parse(dataLine.slice(6));

                        if (data.type === 'transcription') {
                            // Afficher la transcription immédiatement
                            setMessages(prev => prev.map(m =>
                                m.id === messageId ? { ...m, transcription: data.text } : m
                            ));
                        } else if (data.type === 'translation') {
                            // Afficher la traduction et lancer le TTS
                            setMessages(prev => prev.map(m =>
                                m.id === messageId ? { ...m, translation: data.text, isStreaming: false } : m
                            ));
                            speakText(data.text, role === 'therapeut' ? patientLang.tts : 'fr-FR');
                        } else if (data.type === 'error') {
                            throw new Error(data.text);
                        }
                    } catch (parseErr) {
                        // Ignorer les événements mal formés
                        if (parseErr instanceof SyntaxError) continue;
                        throw parseErr;
                    }
                }
            }

            // S'assurer que le message n'est plus en état streaming
            setMessages(prev => prev.map(m =>
                m.id === messageId ? { ...m, isStreaming: false } : m
            ));

            return true;

        } catch (e) {
            console.error(e);
            setMessages(prev => prev.filter(m => m.id !== messageId || m.transcription));
            toast({
                title: "Erreur",
                description: "La traduction a échoué. L'audio a été conservé en brouillon.",
                variant: "destructive"
            });
            return false;
        } finally {
            setIsTranslating(false);
        }
    };

    const getBestVoice = (lang: string) => {
        const voices = window.speechSynthesis.getVoices();
        const targetLangVoices = voices.filter(v => v.lang.toLowerCase().startsWith(lang.substring(0, 2).toLowerCase()));

        let bestVoice = targetLangVoices.find(v =>
            v.name.includes('Siri') ||
            v.name.includes('Premium') ||
            v.name.includes('Enhanced')
        );

        if (!bestVoice) {
            if (lang.startsWith('fr')) bestVoice = targetLangVoices.find(v => v.name.includes('Amelie') || v.name.includes('Thomas') || v.name.includes('Marie') || v.name.includes('Audrey'));
            else if (lang.startsWith('en')) bestVoice = targetLangVoices.find(v => v.name.includes('Samantha') || v.name.includes('Karen') || v.name.includes('Daniel') || v.name.includes('Moira'));
        }

        if (!bestVoice && targetLangVoices.length > 0) {
            bestVoice = targetLangVoices.find(v => v.localService) || targetLangVoices[0];
        }

        return bestVoice;
    };

    const speakText = (text: string, lang: string) => {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;

            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

            if (isIOS) {
                utterance.rate = 1.05;
                utterance.pitch = 1.0;
                utterance.volume = 1.0;
                const voice = getBestVoice(lang);
                if (voice) {
                    utterance.voice = voice;
                }
            } else {
                utterance.rate = 0.95;
            }

            window.speechSynthesis.speak(utterance);
        }
    };

    const synthesizeConsultation = async () => {
        if (messages.length === 0) return;

        setIsAnalyzing(true);
        toast({
            title: "Génération en cours...",
            description: "L'IA analyse votre conversation bilingue" + (attachedFiles.length > 0 ? " et les documents fournis." : "."),
        });

        try {
            const validMessages = messages.filter(m => m.transcription || m.translation);
            if (validMessages.length === 0) {
                toast({ title: "Aucun contenu", description: "Aucune transcription à analyser.", variant: "destructive" });
                setIsAnalyzing(false);
                return;
            }

            const activePatientName = patientName.trim() || `Patient (${patientLang.code})`;
            const fullTranscript = validMessages.map(m =>
                `${m.sender === 'therapeut' ? `**${PRACTITIONER_NAME} (Thérapeute) :**` : `**${activePatientName} :**`} ${m.transcription}\n*(Traduction : ${m.translation})*`
            ).join('\n\n');

            const formData = new FormData();
            formData.append("transcript", fullTranscript);
            formData.append("patientName", activePatientName);
            attachedFiles.forEach(file => {
                formData.append("files", file);
            });

            const response = await fetch('/api/analyze-transcript', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error("Erreur d'analyse");

            const data = await response.json();
            if (!data.patientName || data.patientName.includes("Anonyme")) {
                data.patientName = activePatientName;
            }

            await onRecordingComplete(new Blob(), data);

        } catch (e) {
            console.error(e);
            toast({
                title: "Erreur IA",
                description: "Impossible de générer le bilan.",
                variant: "destructive"
            });
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="flex flex-col space-y-4">

            {/* 1. Header d'identification & Sélection de langue */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Praticien */}
                <div className="flex items-center gap-2.5 p-2 bg-[#ebd9c8]/20 border border-[#ebd9c8]/60 rounded-xl">
                    <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-[#bd613c]/60 shadow-sm shrink-0 bg-[#4a3f35]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img 
                            src="/images/guillaume_philippe.jpg" 
                            alt={PRACTITIONER_NAME}
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="text-[10px] uppercase tracking-wider text-[#8c7b6c] font-semibold">Praticien</span>
                        <span className="text-xs font-bold text-[#4a3f35] flex items-center gap-1 truncate">
                            <span>🇫🇷</span> {PRACTITIONER_NAME}
                        </span>
                    </div>
                </div>

                {/* Patient & Langue */}
                <div className="flex items-center gap-2.5 p-2 bg-white border border-[#e8dfd5] rounded-xl shadow-sm">
                    <div className="w-8 h-8 rounded-full bg-[#bd613c] text-white flex items-center justify-center text-sm font-bold shrink-0 shadow-sm">
                        {patientLang.flag}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-[10px] uppercase tracking-wider text-[#8c7b6c] font-semibold">Patient & Langue</span>
                        <div className="flex items-center gap-1.5">
                            <input
                                type="text"
                                value={patientName}
                                onChange={(e) => setPatientName(e.target.value)}
                                placeholder="Nom du patient..."
                                className="text-xs font-semibold text-[#4a3f35] bg-transparent border-none outline-none focus:ring-0 p-0 w-28 truncate"
                            />
                            <select
                                className="bg-[#ebd9c8]/25 border border-[#ebd9c8] text-[#4a3f35] font-medium text-[11px] rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-[#bd613c]"
                                value={patientLang.code}
                                onChange={(e) => {
                                    const found = LANGUAGES.find(l => l.code === e.target.value) || LANGUAGES[0];
                                    setPatientLang(found);
                                    if (patientName === "Patient Anglais" || patientName.startsWith("Patient ")) {
                                        setPatientName(`Patient ${found.code}`);
                                    }
                                }}
                                disabled={isRecording || isTranslating || isAnalyzing}
                            >
                                {LANGUAGES.map(l => (
                                    <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. Bandeau Moteurs IA Actifs */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-amber-500/10 via-[#ebd9c8]/30 to-purple-500/10 border border-[#ebd9c8]/50 rounded-lg text-[11px] text-[#4a3f35]">
                <span className="flex items-center gap-1.5 font-medium">
                    <span className="text-amber-600">⚡</span> <strong>Gemini Live</strong> <span className="text-[#8c7b6c] hidden sm:inline">(Audio-to-Audio)</span>
                </span>
                <span className="text-[#8c7b6c] font-mono">•</span>
                <span className="flex items-center gap-1.5 font-medium">
                    <span className="text-purple-600">✨</span> <strong>Gemini 3.5</strong> <span className="text-[#8c7b6c] hidden sm:inline">(Retranscription Clinique)</span>
                </span>
            </div>

            {/* 3. CONTRÔLES & DÉMARRAGE DE LA CONSULTATION (AU-DESSUS DU CHAT) */}
            <div className="flex flex-col gap-3 p-3.5 bg-white/80 border border-[#e8dfd5] rounded-2xl shadow-sm">
                <div className="flex flex-col items-center gap-1.5">
                    <div className="flex justify-center items-center gap-1 p-1 bg-[#ebd9c8]/25 rounded-full border border-[#e8dfd5]">
                        {(['conversation', 'realtime', 'classic'] as const).map(mode => (
                            <button
                                key={mode}
                                onClick={() => setTranslationMode(mode)}
                                className={`text-xs px-3.5 py-1.5 rounded-full font-medium transition-all ${
                                    translationMode === mode
                                        ? 'bg-[#bd613c] text-white shadow-sm font-semibold'
                                        : 'text-[#8c7b6c] hover:text-[#4a3f35] hover:bg-[#ebd9c8]/40'
                                }`}
                                disabled={isRecording || isConnected || isConnecting}
                            >
                                {mode === 'conversation' ? '🎙️ Mains Libres' : mode === 'realtime' ? '⚡ Manuel (Push-to-Talk)' : '📱 Dictée par bloc'}
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-[#8c7b6c] text-center italic max-w-md">
                        {translationMode === 'conversation' && "Mains Libres : posez le téléphone, écoute et traduction automatiques en continu pendant toute la séance (1h+)."}
                        {translationMode === 'realtime' && "Manuel Push-to-Talk : cliquez pour parler, traduction vocale instantanée à chaque prise de parole."}
                        {translationMode === 'classic' && "Dictée par bloc : enregistrement par segments audio avec retranscription Gemini 3.5 ultra-précise."}
                    </p>
                </div>

                {/* Mode Mains Libres : Bouton Majeur Raffiné */}
                {translationMode === 'conversation' && (
                    <Button
                        size="lg"
                        variant={realtimeRole === 'bidirectional' ? 'destructive' : 'default'}
                        className={`w-full h-20 rounded-xl flex items-center justify-center gap-3 transition-all duration-300 shadow-md ${
                            realtimeRole === 'bidirectional' 
                                ? 'bg-red-600 hover:bg-red-700 animate-pulse text-white border-none' 
                                : 'bg-gradient-to-r from-[#4a3f35] via-[#594b40] to-[#4a3f35] hover:from-[#3a3129] hover:to-[#3a3129] text-white border border-[#ebd9c8]/30'
                        }`}
                        onClick={() => {
                            if (isConnected && realtimeRole === 'bidirectional') return stopRealtimeSession();
                            return startRealtimeSession('bidirectional');
                        }}
                        disabled={isAnalyzing || isConnecting}
                    >
                        {isConnecting ? (
                            <Loader2 className="w-6 h-6 animate-spin text-[#ebd9c8]" />
                        ) : realtimeRole === 'bidirectional' ? (
                            <Square className="w-6 h-6 text-white" />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-[#bd613c] flex items-center justify-center text-white shadow-inner shrink-0">
                                <Globe className="w-5 h-5" />
                            </div>
                        )}
                        <div className="flex flex-col items-start text-left">
                            <span className="font-bebas text-lg sm:text-xl tracking-wide leading-tight">
                                {isConnecting 
                                    ? 'CONNEXION EN COURS…' 
                                    : realtimeRole === 'bidirectional' 
                                    ? 'ARRÊTER LA SÉANCE MAINS LIBRES' 
                                    : 'DÉMARRER LA SÉANCE MAINS LIBRES (1H+)'
                                }
                            </span>
                            <span className="text-[11px] opacity-80 font-normal">
                                {realtimeRole === 'bidirectional' 
                                    ? 'Écoute active continue • Appuyez pour stopper'
                                    : `🇫🇷 ${PRACTITIONER_NAME} ↔ ${patientLang.flag} ${patientName || 'Patient'}`
                                }
                            </span>
                        </div>
                    </Button>
                )}

                {/* Mode Manuel (Push-to-Talk) ou Dictée par bloc */}
                {translationMode !== 'conversation' && (
                    <div className="grid grid-cols-2 gap-3">
                        <Button
                            size="lg"
                            variant={(recordingRole === 'therapeut' || realtimeRole === 'therapeut') ? 'destructive' : 'default'}
                            className={`h-20 text-base font-bebas tracking-wide flex flex-col items-center justify-center gap-1.5 ${
                                (recordingRole === 'therapeut' || realtimeRole === 'therapeut') ? 'animate-pulse' : 'bg-[#4a3f35] hover:bg-[#3a3129]'
                            }`}
                            onClick={() => {
                                if (isRecording && recordingRole === 'therapeut') return stopRecording();
                                if (isConnected && realtimeRole === 'therapeut') return stopRealtimeSession();
                                if (translationMode === 'realtime') return startRealtimeSession('therapeut');
                                return startRecording('therapeut');
                            }}
                            disabled={isAnalyzing || isConnecting || (isRecording && recordingRole !== 'therapeut') || (isConnected && realtimeRole !== 'therapeut')}
                        >
                            {isConnecting && realtimeRole === 'therapeut' ? <Loader2 className="w-5 h-5 animate-spin" /> : (recordingRole === 'therapeut' || realtimeRole === 'therapeut') ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                            <span className="text-center truncate px-1 flex items-center justify-center gap-1.5">
                                <span className="w-4 h-4 rounded-full overflow-hidden inline-block shrink-0 border border-white/40">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src="/images/guillaume_philippe.jpg" alt="GP" className="w-full h-full object-cover" />
                                </span>
                                <span>
                                    {isConnecting 
                                        ? 'Connexion...' 
                                        : (recordingRole === 'therapeut' || realtimeRole === 'therapeut') 
                                        ? "Arrêter" 
                                        : translationMode === 'classic'
                                        ? "Dicter (Guillaume)"
                                        : "Guillaume (FR)"
                                    }
                                </span>
                            </span>
                        </Button>

                        <Button
                            size="lg"
                            variant={(recordingRole === 'patient' || realtimeRole === 'patient') ? 'destructive' : 'outline'}
                            className={`h-20 text-base font-bebas tracking-wide flex flex-col items-center justify-center gap-1.5 border-2 ${
                                (recordingRole === 'patient' || realtimeRole === 'patient') ? 'animate-pulse' : 'border-[#4a3f35] text-[#4a3f35] hover:bg-[#e8dfd5]'
                            }`}
                            onClick={() => {
                                if (isRecording && recordingRole === 'patient') return stopRecording();
                                if (isConnected && realtimeRole === 'patient') return stopRealtimeSession();
                                if (translationMode === 'realtime') return startRealtimeSession('patient');
                                return startRecording('patient');
                            }}
                            disabled={isAnalyzing || isConnecting || (isRecording && recordingRole !== 'patient') || (isConnected && realtimeRole !== 'patient')}
                        >
                            {isConnecting && realtimeRole === 'patient' ? <Loader2 className="w-5 h-5 animate-spin" /> : (recordingRole === 'patient' || realtimeRole === 'patient') ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                            <span className="text-center truncate px-1">
                                {isConnecting 
                                    ? 'Connexion...' 
                                    : (recordingRole === 'patient' || realtimeRole === 'patient') 
                                    ? "Stop" 
                                    : translationMode === 'classic'
                                    ? `Dicter (${patientName || 'Patient'})`
                                    : `${patientName || 'Patient'} (${patientLang.code.substring(0, 2).toUpperCase()})`
                                }
                            </span>
                        </Button>
                    </div>
                )}

                {/* Indicateur de durée de consultation en direct (1h+ supporté) */}
                {(isConnected || isRecording || sessionSeconds > 0) && (
                    <div className="flex items-center justify-between px-3 py-1 bg-[#ebd9c8]/30 rounded-lg text-[11px] text-[#4a3f35]">
                        <span className="flex items-center gap-1.5 font-mono font-bold text-[#bd613c]">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                            ⏱️ {formatSessionTime(sessionSeconds)}
                        </span>
                        <span className="text-[10px] text-[#8c7b6c] italic">
                            Session continue (1h+) • Écran maintenu allumé • Sauvegarde auto
                        </span>
                    </div>
                )}
            </div>

            {/* 4. Alerte brouillon si présent */}
            {draftExists && !isRecording && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3.5 rounded-xl text-center w-full mb-0 shadow-sm">
                    <p className="text-xs font-medium mb-2.5">⚠️ Un segment d&apos;enregistrement de {draftRole === 'therapeut' ? PRACTITIONER_NAME : (patientName || 'discours patient')} n&apos;a pas été finalisé.</p>
                    <div className="flex justify-center gap-2.5">
                        <Button variant="outline" size="sm" onClick={discardDraft} className="text-amber-700 border-amber-300 hover:bg-amber-100 text-xs h-7">
                            Ignorer
                        </Button>
                        <Button size="sm" onClick={recoverDraft} className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7">
                            Traduire & ajouter
                        </Button>
                    </div>
                </div>
            )}

            {/* 5. Chat Area & Retranscription Parallèle */}
            <Card className={`bg-white/85 backdrop-blur-sm border-[#e8dfd5] shadow-lg flex flex-col relative transition-all duration-300 ${chatExpanded ? 'fixed inset-0 z-50 rounded-none min-h-0 h-full bg-white' : 'flex-1 min-h-[360px]'}`}>
                <div className={`absolute z-10 flex items-center gap-1 ${chatExpanded ? 'top-[env(safe-area-inset-top,12px)] right-4 pt-2' : 'top-2 right-2'}`}>
                    {messages.length > 0 && !chatExpanded && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setMessages([])}
                            className="text-[#bd613c] hover:bg-[#bd613c]/10 hover:text-[#bd613c] bg-white/50 rounded-full h-8 w-8"
                            title="Effacer la discussion"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setChatExpanded(!chatExpanded)}
                        className="text-[#bd613c] hover:bg-[#bd613c]/10 bg-white/50 rounded-full h-8 w-8"
                        title={chatExpanded ? 'Réduire' : 'Agrandir'}
                    >
                        {chatExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </Button>
                </div>

                <CardContent className={`p-4 flex-1 h-full ${chatExpanded ? 'pt-14' : ''}`}>
                    <ScrollArea className={`${chatExpanded ? 'h-[calc(100dvh-90px)]' : 'h-[340px]'} pr-3 w-full`} ref={scrollRef}>
                        {messages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-[#8c7b6c] space-y-3 py-10">
                                <Globe className="w-12 h-12 opacity-25 text-[#bd613c]" />
                                <div className="text-center">
                                    <p className="font-bebas text-xl text-[#4a3f35] tracking-wide">
                                        Consultation Bilingue Prête
                                    </p>
                                    <p className="text-xs text-[#8c7b6c] font-light max-w-sm mt-1">
                                        {PRACTITIONER_NAME} (FR) ↔ {patientName || 'Patient'} ({patientLang.label})<br />
                                        La retranscription et la traduction audio s&apos;afficheront en direct ici.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {messages.map((msg) => (
                                    <div key={msg.id} className={`flex flex-col ${msg.sender === 'therapeut' ? 'items-end' : 'items-start'}`}>
                                        {/* Header du locuteur */}
                                        <div className="flex items-center gap-1.5 mb-1 px-1">
                                            {msg.sender === 'therapeut' ? (
                                                <div className="w-4 h-4 rounded-full overflow-hidden border border-[#bd613c]/50 shrink-0">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src="/images/guillaume_philippe.jpg" alt="GP" className="w-full h-full object-cover" />
                                                </div>
                                            ) : (
                                                <span className="text-xs">{patientLang.flag}</span>
                                            )}
                                            <span className="text-[11px] font-bold text-[#4a3f35]">
                                                {msg.sender === 'therapeut' ? `🇫🇷 ${PRACTITIONER_NAME}` : `${patientLang.flag} ${patientName || 'Patient'}`}
                                            </span>
                                            <span className="text-[10px] text-[#8c7b6c]">
                                                {msg.sender === 'therapeut' ? '(Français)' : `(${msg.patientLangCode})`}
                                            </span>
                                        </div>

                                        {/* Bloc Parallèle : Retranscription + Traduction */}
                                        <div className={`w-full max-w-[92%] sm:max-w-[85%] p-3 rounded-2xl shadow-sm space-y-2.5 transition-all duration-300 ${
                                            msg.sender === 'therapeut' 
                                                ? 'bg-[#4a3f35]/5 border border-[#4a3f35]/15 rounded-tr-sm' 
                                                : 'bg-[#ebd9c8]/25 border border-[#ebd9c8]/60 rounded-tl-sm'
                                        }`}>
                                            {/* 1. Retranscription Originale (Gemini 3.5) */}
                                            <div className="bg-white/90 p-2.5 rounded-xl border border-[#ebd9c8]/50">
                                                <div className="text-[9px] uppercase font-bold text-[#8c7b6c] mb-1 flex items-center justify-between">
                                                    <span>📝 Retranscription originale</span>
                                                    <span className="text-[9px] px-1.5 py-0.2 bg-purple-100 text-purple-700 font-mono rounded font-medium">Gemini 3.5</span>
                                                </div>
                                                {msg.transcription ? (
                                                    <p className="text-xs sm:text-sm text-[#2b241e] italic leading-relaxed">
                                                        &ldquo;{msg.transcription}&rdquo;
                                                    </p>
                                                ) : msg.isStreaming ? (
                                                    <p className="text-xs text-[#8c7b6c] italic flex items-center gap-1.5">
                                                        <Loader2 className="w-3 h-3 animate-spin text-[#bd613c]" />
                                                        Écoute et retranscription en direct…
                                                    </p>
                                                ) : null}
                                            </div>

                                            {/* 2. Traduction en Parallèle (Gemini Live) */}
                                            <div className={`p-2.5 rounded-xl flex items-start justify-between gap-2.5 ${
                                                msg.sender === 'therapeut'
                                                    ? 'bg-[#4a3f35] text-[#fdfbf6]'
                                                    : 'bg-[#bd613c] text-white'
                                            }`}>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[9px] uppercase font-bold opacity-80 mb-1 flex items-center gap-1">
                                                        <span>🔊 Traduction en direct</span>
                                                        <span className="text-[8px] px-1 py-0.2 bg-white/20 rounded font-mono font-medium">Gemini Live</span>
                                                    </div>
                                                    {msg.isStreaming && msg.transcription && !msg.translation ? (
                                                        <p className="text-xs opacity-90 flex items-center gap-1.5">
                                                            <span className="inline-flex gap-0.5">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                                                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                                                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                                            </span>
                                                            Génération de la voix traduite…
                                                        </p>
                                                    ) : msg.translation ? (
                                                        <p className="text-xs sm:text-sm font-semibold leading-relaxed">
                                                            {msg.translation}
                                                        </p>
                                                    ) : null}
                                                </div>

                                                {msg.translation && (
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        onClick={() => speakText(msg.translation, msg.sender === 'therapeut' ? msg.patientLangTts : 'fr-FR')}
                                                        className="shrink-0 h-7 w-7 rounded-full hover:bg-white/20 text-white"
                                                        title="Réécouter à voix haute"
                                                    >
                                                        <Volume2 className="w-4 h-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* 6. Bouton de finalisation du Bilan TDT */}
            {messages.length > 0 && (
                <Button
                    onClick={synthesizeConsultation}
                    disabled={isAnalyzing || isRecording || isTranslating || isConnected || isConnecting}
                    className="w-full py-5 text-lg font-bebas tracking-widest bg-[#bd613c] hover:bg-[#a05232] text-white transition-all duration-300 shadow-xl"
                >
                    {isAnalyzing ? (
                        <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            Génération du Bilan TDT pour {patientName || 'le Patient'}...
                        </>
                    ) : `Terminer et créer le Bilan pour ${patientName || 'le Patient'}`}
                </Button>
            )}

        </div>
    );
}
