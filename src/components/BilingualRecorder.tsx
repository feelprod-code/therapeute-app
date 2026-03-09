"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, Volume2, Globe, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/db";

type ChatMessage = {
    id: string;
    sender: 'therapeut' | 'patient';
    transcription: string;
    translation: string;
    patientLangCode: string;
    patientLangTts: string;
};

const LANGUAGES = [
    { code: 'Anglais', label: 'Anglais (EN)', tts: 'en-US' },
    { code: 'Espagnol', label: 'Espagnol (ES)', tts: 'es-ES' },
    { code: 'Italien', label: 'Italien (IT)', tts: 'it-IT' },
    { code: 'Portugais', label: 'Portugais (BR)', tts: 'pt-BR' },
    { code: 'Chinois', label: 'Chinois (ZH)', tts: 'zh-CN' },
];

export default function BilingualRecorder({ onRecordingComplete }: { onRecordingComplete: (audioBlob: Blob, data: Record<string, string>) => void }) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [patientLang, setPatientLang] = useState(LANGUAGES[0]);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingRole, setRecordingRole] = useState<'therapeut' | 'patient' | null>(null);
    const [isTranslating, setIsTranslating] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [draftExists, setDraftExists] = useState(false);
    const [draftRole, setDraftRole] = useState<'therapeut' | 'patient' | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<BlobPart[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const recordStartTimeRef = useRef<Date | null>(null);
    const mimeTypeRef = useRef<string>('audio/webm');
    const { toast } = useToast();

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
            await handleTranslation(audioBlob, draft.bilingualRole);
            await db.drafts.delete('bilingual');
            setDraftExists(false);
            setDraftRole(null);
            toast({
                title: "Brouillon récupéré",
                description: "Le segment audio interrompu a été traduit.",
            });
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

    const startRecording = async (role: 'therapeut' | 'patient') => {
        // Unlock iOS Audio: Siri/Web Speech API blocks audio after async fetches
        // We must play a silent sound synchronously on the button click to unlock it
        if ('speechSynthesis' in window) {
            const unlockUtterance = new SpeechSynthesisUtterance('');
            unlockUtterance.volume = 0;
            window.speechSynthesis.speak(unlockUtterance);
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

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

                if (audioBlob.size > 0) {
                    await handleTranslation(audioBlob, role);
                }

                // Stop all tracks to release microphone
                stream.getTracks().forEach(track => track.stop());

                // Clear draft on successful stop
                await db.drafts.delete('bilingual');
            };

            // Collect data every 1 second to safeguard against memory loss
            mediaRecorder.start(1000);
            setRecordingRole(role);
            setIsRecording(true);
        } catch (error) {
            console.error('Erreur d\'accès au microphone:', error);
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
            // Draft deletion happens in mediaRecorder.onstop to ensure translation starts correctly
        }
    };

    const handleTranslation = async (audioBlob: Blob, role: 'therapeut' | 'patient') => {
        setIsTranslating(true);
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
                body: JSON.stringify({ audio: base64Audio, speaker: role, targetLanguage: patientLang.code })
            });

            if (!res.ok) throw new Error("Erreur de traduction");

            const data = await res.json();

            const newMessage: ChatMessage = {
                id: Date.now().toString(),
                sender: role,
                transcription: data.transcription,
                translation: data.translation,
                patientLangCode: patientLang.code,
                patientLangTts: patientLang.tts
            };

            setMessages(prev => [...prev, newMessage]);

            // Auto Play Speech
            speakText(data.translation, role === 'therapeut' ? patientLang.tts : 'fr-FR');

        } catch (e) {
            console.error(e);
            toast({
                title: "Erreur",
                description: "La traduction a échoué. Veuillez réessayer.",
                variant: "destructive"
            });
        } finally {
            setIsTranslating(false);
        }
    };

    const getBestVoice = (lang: string) => {
        const voices = window.speechSynthesis.getVoices();
        const targetLangVoices = voices.filter(v => v.lang.toLowerCase().startsWith(lang.substring(0, 2).toLowerCase()));

        // Target specifically Siri, Premium, or Enhanced voices first
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
            window.speechSynthesis.cancel(); // Stop current speech if any
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;

            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

            if (isIOS) {
                // iOS Specific optimizations: Siri voices & slightly faster rate
                utterance.rate = 1.15;
                utterance.pitch = 1.0;
                utterance.volume = 1.0;
                const voice = getBestVoice(lang);
                if (voice) {
                    utterance.voice = voice;
                }
            } else {
                // Desktop and Android: Use completely native browser defaults without forcing rate/pitch/voice 
                // This prevents bugs on Mac Chrome where forcing premium voices causes stutters/overlays
                utterance.rate = 1.0;
            }

            window.speechSynthesis.speak(utterance);
        }
    };

    const synthesizeConsultation = async () => {
        if (messages.length === 0) return;

        setIsAnalyzing(true);
        toast({
            title: "Génération en cours...",
            description: "L'IA analyse votre conversation bilingue.",
        });

        try {
            // Format transcript
            const fullTranscript = messages.map(m =>
                `${m.sender === 'therapeut' ? 'Thérapeute' : 'Patient'}: ${m.transcription}\n(Traduit: ${m.translation})`
            ).join('\n\n');

            const response = await fetch('/api/analyze-transcript', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: fullTranscript })
            });

            if (!response.ok) throw new Error("Erreur d'analyse");

            const data = await response.json();

            // Complete
            // We pass an empty blob since this mode relies on text context
            onRecordingComplete(new Blob(), data);

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
        <div className="flex flex-col space-y-6">

            {draftExists && !isRecording && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-center w-full mb-0 shadow-sm">
                    <p className="text-sm font-medium mb-3">⚠️ Oups ! Un morceau d&apos;enregistrement de {draftRole === 'therapeut' ? 'votre discours' : 'discours du patient'} (suite à une fermeture) n&apos;a pas été traduit.</p>
                    <div className="flex justify-center gap-3">
                        <Button variant="outline" size="sm" onClick={discardDraft} className="text-amber-700 border-amber-300 hover:bg-amber-100">
                            L&apos;ignorer
                        </Button>
                        <Button size="sm" onClick={recoverDraft} className="bg-amber-600 hover:bg-amber-700 text-white">
                            Le traduire & l&apos;ajouter
                        </Button>
                    </div>
                </div>
            )}

            {/* Chat Area */}
            <Card className="bg-white/80 backdrop-blur-sm border-[#e8dfd5] shadow-lg flex-1 min-h-[300px] flex flex-col relative">
                {messages.length > 0 && (
                    <div className="absolute top-2 right-2 z-10 bg-white/50 rounded-full">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setMessages([])}
                            className="text-[#bd613c] hover:bg-[#bd613c]/10 hover:text-[#bd613c]"
                            title="Effacer la discussion"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                )}
                <CardContent className="p-4 pt-8 flex-1">
                    <ScrollArea className="h-[300px] pr-4 w-full" ref={scrollRef}>
                        {messages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-[#8c7b6c] space-y-4">
                                <Globe className="w-12 h-12 opacity-20" />
                                <p className="text-center font-light">
                                    Appuyez sur un bouton pour parler.<br />
                                    La traduction sera lue à voix haute.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {messages.map((msg) => (
                                    <div key={msg.id} className={`flex flex-col ${msg.sender === 'therapeut' ? 'items-end' : 'items-start'}`}>
                                        <span className="text-xs uppercase tracking-widest text-[#8c7b6c] mb-1">
                                            {msg.sender === 'therapeut' ? 'Vous (FR)' : `Patient (${msg.patientLangCode.substring(0, 3).toUpperCase()})`}
                                        </span>
                                        <div className={`max-w-[85%] p-4 rounded-2xl ${msg.sender === 'therapeut' ? 'bg-[#4a3f35] text-[#fdfbf6] rounded-tr-sm' : 'bg-[#e8dfd5] text-[#4a3f35] rounded-tl-sm'}`}>
                                            <p className="text-sm opacity-80 italic mb-2">&quot;{msg.transcription}&quot;</p>
                                            <div className="w-full h-px bg-current opacity-20 mb-2"></div>
                                            <p className="text-lg font-medium flex items-start gap-2">
                                                <Volume2 className="w-5 h-5 shrink-0 mt-0.5 opacity-70" onClick={() => speakText(msg.translation, msg.sender === 'therapeut' ? msg.patientLangTts : 'fr-FR')} style={{ cursor: 'pointer' }} />
                                                {msg.translation}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                                {isTranslating && (
                                    <div className="flex justify-center py-4">
                                        <Loader2 className="w-6 h-6 animate-spin text-[#bd613c]" />
                                    </div>
                                )}
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* Control Buttons */}
            <div className="flex flex-col gap-3">
                <div className="flex justify-end items-center">
                    <label className="text-xs uppercase tracking-widest text-[#8c7b6c] mr-3">Traduire en :</label>
                    <select
                        className="bg-white/50 border border-[#e8dfd5] text-[#8c7b6c] font-medium text-sm rounded px-3 py-1 outline-none ring-offset-background focus-visible:ring-1 focus-visible:ring-[#bd613c]"
                        value={patientLang.code}
                        onChange={(e) => setPatientLang(LANGUAGES.find(l => l.code === e.target.value) || LANGUAGES[0])}
                        disabled={isRecording || isTranslating || isAnalyzing}
                    >
                        {LANGUAGES.map(l => (
                            <option key={l.code} value={l.code}>{l.label}</option>
                        ))}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <Button
                        size="lg"
                        variant={recordingRole === 'therapeut' ? 'destructive' : 'default'}
                        className={`h-24 text-lg font-bebas tracking-wide flex flex-col gap-2 ${recordingRole === 'therapeut' ? 'animate-pulse' : 'bg-[#4a3f35] hover:bg-[#3a3129]'}`}
                        onClick={() => isRecording ? stopRecording() : startRecording('therapeut')}
                        disabled={isTranslating || isAnalyzing || (isRecording && recordingRole !== 'therapeut')}
                    >
                        {recordingRole === 'therapeut' ? <Square className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                        {recordingRole === 'therapeut' ? "Arrêter" : "Parler (Français)"}
                    </Button>

                    <Button
                        size="lg"
                        variant={recordingRole === 'patient' ? 'destructive' : 'outline'}
                        className={`h-24 text-lg font-bebas tracking-wide flex flex-col gap-2 border-2 ${recordingRole === 'patient' ? 'animate-pulse' : 'border-[#4a3f35] text-[#4a3f35] hover:bg-[#e8dfd5]'}`}
                        onClick={() => isRecording ? stopRecording() : startRecording('patient')}
                        disabled={isTranslating || isAnalyzing || (isRecording && recordingRole !== 'patient')}
                    >
                        {recordingRole === 'patient' ? <Square className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                        {recordingRole === 'patient' ? "Stop" : `Patient (${patientLang.code.substring(0, 2).toUpperCase()})`}
                    </Button>
                </div>
            </div>

            {messages.length > 0 && (
                <Button
                    onClick={synthesizeConsultation}
                    disabled={isAnalyzing || isRecording || isTranslating}
                    className="w-full py-8 text-xl font-bebas tracking-widest bg-[#bd613c] hover:bg-[#a05232] text-white transition-all duration-300 shadow-xl"
                >
                    {isAnalyzing ? (
                        <>
                            <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                            Création du bilan...
                        </>
                    ) : "Terminer et créer le Bilan TDT"}
                </Button>
            )}

        </div>
    );
}
