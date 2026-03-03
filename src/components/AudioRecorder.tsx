"use client";

import React, { useState, useRef, useEffect } from "react";
import { Mic, Square, Pause, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface AudioRecorderProps {
    onRecordingComplete: (audioBlob: Blob) => void;
    isProcessing?: boolean;
}

export function AudioRecorder({ onRecordingComplete, isProcessing = false }: AudioRecorderProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const { toast } = useToast();

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            stopTimer();
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
            }
        };
    }, []);

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
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                onRecordingComplete(audioBlob);
                stream.getTracks().forEach((track) => track.stop());
            };

            // Collect data every 1 second to safeguard against memory loss
            mediaRecorder.start(1000);
            setIsRecording(true);
            setIsPaused(false);
            setRecordingTime(0);
            startTimer();
        } catch (error) {
            console.error("Error accessing microphone:", error);
            toast({
                title: "Erreur Microphone",
                description: "Impossible d'accéder au microphone. Vérifiez vos permissions.",
                variant: "destructive",
            });
        }
    };

    const pauseRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.pause();
            setIsPaused(true);
            stopTimer();
        }
    };

    const resumeRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
            mediaRecorderRef.current.resume();
            setIsPaused(false);
            startTimer();
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setIsPaused(false);
            stopTimer();
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

                {isProcessing && (
                    <div className="flex items-center gap-2 text-sm text-[#e25822] mt-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Génération du bilan en cours...</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
