"use client";

import React, { useState, useRef, useEffect } from "react";
import { Mic, Square, Pause, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/db";

interface AudioRecorderProps {
    onRecordingComplete: (audioBlob: Blob) => void;
    isProcessing?: boolean;
}

export function AudioRecorder({ onRecordingComplete, isProcessing = false }: AudioRecorderProps) {
    const [draftExists, setDraftExists] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const { toast } = useToast();

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const recordStartTimeRef = useRef<Date | null>(null);
    const mimeTypeRef = useRef<string>('audio/webm');

    // Audio Visualizer Refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number | null>(null);

    const cleanupAudioContext = () => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(console.error);
            audioContextRef.current = null;
        }
        analyserRef.current = null;
    };

    const drawWaveform = () => {
        if (!canvasRef.current || !analyserRef.current) return;

        const canvas = canvasRef.current;
        const canvasCtx = canvas.getContext('2d');
        if (!canvasCtx) return;

        const analyser = analyserRef.current;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animationFrameRef.current = requestAnimationFrame(draw);

            analyser.getByteFrequencyData(dataArray);

            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

            // Rendu minimaliste : lignes fines et espacées
            const barWidth = 2.5;
            const gap = 3.5;
            const totalBars = Math.floor(canvas.width / (barWidth + gap));
            let x = (canvas.width - (totalBars * (barWidth + gap))) / 2;

            for (let i = 0; i < totalBars; i++) {
                // Focus sur les fréquences basses/moyennes (0 à 60% du buffer)
                const dataIndex = Math.floor((i / totalBars) * bufferLength * 0.6);
                const value = dataArray[dataIndex] || 0;

                // Application d'une courbe en cloche mathématique (Sine Window)
                // Pour que les bords soient à zéro progressif et le centre rebondisse
                const progress = i / totalBars;
                const windowMultiplier = Math.sin(progress * Math.PI);

                // Calcul de la hauteur avec attenuation sur les bords (padding de 4px)
                const maxBarHeight = canvas.height - 4;
                let barHeight = (value / 255) * maxBarHeight * windowMultiplier;

                // Léger "frétillement" même quand c'est silencieux, plus fort au centre
                const idleWobble = Math.random() * 2 * windowMultiplier;
                barHeight = Math.max(barHeight, 2 + idleWobble);

                const y = (canvas.height - barHeight) / 2;

                canvasCtx.fillStyle = '#bd613c'; // Couleur TDT

                // Utilisation de coins arrondis si le navigateur le supporte
                if (typeof canvasCtx.roundRect === 'function') {
                    canvasCtx.beginPath();
                    canvasCtx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
                    canvasCtx.fill();
                } else {
                    canvasCtx.fillRect(x, y, barWidth, barHeight);
                }

                x += barWidth + gap;
            }
        };

        draw();
    };

    useEffect(() => {
        // Verify if a draft exists on mount
        const checkDraft = async () => {
            const draft = await db.drafts.get('standard');
            if (draft && draft.audioChunks.length > 0) {
                setDraftExists(true);
            }
        };
        checkDraft();

        return () => {
            stopTimer();
            cleanupAudioContext();
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
            }
        };
    }, []);

    const recoverDraft = async () => {
        const draft = await db.drafts.get('standard');
        if (draft && draft.audioChunks.length > 0) {
            const audioBlob = new Blob(draft.audioChunks, { type: draft.mimeType || 'audio/webm' });
            onRecordingComplete(audioBlob);
            await db.drafts.delete('standard');
            setDraftExists(false);
            toast({
                title: "Brouillon récupéré",
                description: "L'enregistrement précédent a été repris et est en cours d'analyse.",
            });
        }
    };

    const discardDraft = async () => {
        await db.drafts.delete('standard');
        setDraftExists(false);
        toast({
            title: "Brouillon supprimé",
            description: "L'enregistrement inachevé a été effacé.",
        });
    };

    const startTimer = () => {
        timerIntervalRef.current = setInterval(() => {
            setRecordingTime((prev) => prev + 1);
        }, 1000);
    };

    const stopTimer = () => {
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }
    };

    const startRecording = async () => {
        try {
            // ⚠️ INITIALISATION SYNCHRONE IMPÉRATIVE SUR SAFARI : 
            // L'AudioContext doit être créé et "resumé" dans le même cycle d'événement que le clic utilisateur,
            // AVANT toute requête asynchrone comme getUserMedia, sinon Safari bloque le son/l'analyse.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextClass();
            audioContextRef.current = audioContext;

            // Safari / iOS fallback: ensure context is resumed immediately
            if (audioContext.state === 'suspended') {
                audioContext.resume().catch(console.error);
            }

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

            // Clear any previous draft when starting a new recording
            await db.drafts.delete('standard');
            setDraftExists(false);

            mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                    // Sauvegarde continue
                    await db.drafts.put({
                        id: 'standard',
                        mode: 'standard',
                        audioChunks: audioChunksRef.current,
                        mimeType: mimeTypeRef.current,
                        startedAt: recordStartTimeRef.current || new Date(),
                        lastUpdatedAt: new Date()
                    });
                }
            };

            mediaRecorder.onstop = () => {
                // Ensure blob type matches what was supported
                const finalMimeType = options.mimeType;
                const audioBlob = new Blob(audioChunksRef.current, { type: finalMimeType });

                if (audioBlob.size === 0) {
                    toast({
                        title: "Erreur audio",
                        description: "L'enregistrement a retourné un fichier vide. Vérifiez les accès micro Safari.",
                        variant: "destructive",
                    });
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }

                onRecordingComplete(audioBlob);
                stream.getTracks().forEach((track) => track.stop());
            };

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;

            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            drawWaveform();

            // Collect data every 1 second to safeguard against memory loss
            mediaRecorder.start(1000);
            setIsRecording(true);
            setIsPaused(false);
            setRecordingTime(0);
            startTimer();
        } catch (error: unknown) {
            console.error("Error accessing microphone:", error);

            let errorMessage = "Impossible d'accéder au microphone.";
            if (error instanceof Error && error.name === 'NotAllowedError') errorMessage += " Veuillez autoriser l'accès dans les réglages iOS/Safari.";

            toast({
                title: "Erreur Microphone",
                description: errorMessage,
                variant: "destructive",
            });
        }
    };

    const pauseRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.pause();
            setIsPaused(true);
            stopTimer();
            if (audioContextRef.current) {
                audioContextRef.current.suspend();
            }
        }
    };

    const resumeRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
            mediaRecorderRef.current.resume();
            setIsPaused(false);
            startTimer();
            if (audioContextRef.current) {
                audioContextRef.current.resume();
            }
        }
    };

    const stopRecording = async () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setIsPaused(false);
            stopTimer();
            cleanupAudioContext();

            // Delete draft as the recording is successfully finished
            await db.drafts.delete('standard');

            // Feedback visuel (Toast) uniquement
            toast({
                title: "✅ Fin de l'enregistrement",
                description: "L'enregistrement est terminé, l'IA génère le bilan en ce moment...",
                className: "bg-[#bd613c] text-white border-none font-inter",
                duration: 5000,
            });
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    return (
        <Card className="w-full max-w-md mx-auto shadow-md border-[#bd613c]/20">
            <CardHeader className="bg-[#ebd9c8]/30 border-b border-[#bd613c]/10 pb-4">
                <CardTitle className="text-center font-bebas tracking-wide text-2xl text-[#bd613c]">Enregistrement</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center pt-8 pb-6 gap-6">
                {draftExists && !isRecording && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-center w-full mb-2">
                        <p className="text-sm font-medium mb-3">⚠️ Oups ! Un morceau d&apos;enregistrement (suite à une fermeture) n&apos;a pas été traduit.</p>
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

                <div className="text-5xl font-mono text-[#4a3f35] tracking-wider">
                    {formatTime(recordingTime)}
                </div>

                <div className="flex gap-4">
                    {!isRecording ? (
                        <Button
                            size="lg"
                            className="rounded-full w-16 h-16 bg-[#e25822] hover:bg-[#bd613c] shadow-md shadow-[#e25822]/30 transition-colors"
                            onClick={startRecording}
                            disabled={isProcessing}
                        >
                            <Mic className="w-6 h-6 text-white" />
                        </Button>
                    ) : (
                        <>
                            {isPaused ? (
                                <Button
                                    size="lg"
                                    variant="outline"
                                    className="rounded-full w-14 h-14 border-2 border-[#ebd9c8]"
                                    onClick={resumeRecording}
                                >
                                    <Play className="w-6 h-6 text-[#bd613c]" />
                                </Button>
                            ) : (
                                <Button
                                    size="lg"
                                    variant="outline"
                                    className="rounded-full w-14 h-14 border-2 border-[#ebd9c8]"
                                    onClick={pauseRecording}
                                >
                                    <Pause className="w-6 h-6 text-[#bd613c]" />
                                </Button>
                            )}

                            <Button
                                size="lg"
                                className="rounded-full w-14 h-14 bg-[#4a3f35] hover:bg-[#4a3f35]/80 shadow-md"
                                onClick={stopRecording}
                            >
                                <Square className="w-5 h-5 text-white" />
                            </Button>
                        </>
                    )}
                </div>

                {/* Animated wave spectrum */}
                <div className={`w-full overflow-hidden transition-opacity duration-300 ${isRecording && !isPaused ? 'opacity-100 h-16' : 'opacity-20 h-16'}`}>
                    <canvas ref={canvasRef} width={250} height={60} className={`mx-auto ${isRecording ? 'block' : 'hidden'}`} />
                    {!isRecording && (
                        <div className="h-full flex items-center justify-center">
                            <span className="text-slate-300 text-sm font-inter">Micro prêt</span>
                        </div>
                    )}
                </div>

                {isProcessing && (
                    <div className="flex items-center gap-2 text-sm text-[#e25822] mt-2 font-medium">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Enregistrement bien effectué. Analyse en cours...</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
