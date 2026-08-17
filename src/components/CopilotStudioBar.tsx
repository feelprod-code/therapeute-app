"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Mic, MicOff, Send, Loader2, Undo2, Check, Code, Stethoscope, ChevronUp, ChevronDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

interface CopilotStudioBarProps {
    // Props optionnelles pour le mode clinique (quand on est sur une fiche bilan)
    synthese?: string;
    transcription?: string;
    patientName?: string;
    onUpdateSynthese?: (newSynthese: string, newPatientName?: string) => void;
    currentPath?: string;
}

export function CopilotStudioBar({
    synthese,
    transcription,
    patientName,
    onUpdateSynthese,
    currentPath = "/"
}: CopilotStudioBarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<"clinique" | "studio">(synthese ? "clinique" : "studio");
    const [instruction, setInstruction] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [lastAction, setLastAction] = useState<{
        type: "clinique" | "studio";
        summary: string;
        previousSynthese?: string;
        previousPatientName?: string;
        backupId?: string;
    } | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const { toast } = useToast();

    // Raccourci clavier Cmd+K / Ctrl+K pour ouvrir/fermer
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setIsOpen(prev => {
                    const next = !prev;
                    if (next) setTimeout(() => inputRef.current?.focus(), 150);
                    return next;
                });
            }
            if (e.key === "Escape" && isOpen) {
                setIsOpen(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen]);

    // Basculer automatiquement en mode clinique si un bilan est présent
    useEffect(() => {
        if (synthese && mode !== "clinique") {
            setMode("clinique");
        }
    }, [synthese]);

    // Gestion de l'enregistrement vocal direct
    const toggleRecording = async () => {
        if (isRecording) {
            // Arrêter l'enregistrement et traiter
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioChunksRef.current = [];
                const mediaRecorder = new MediaRecorder(stream);
                mediaRecorderRef.current = mediaRecorder;

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) audioChunksRef.current.push(e.data);
                };

                mediaRecorder.onstop = async () => {
                    stream.getTracks().forEach(t => t.stop());
                    const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64 = (reader.result as string).split(",")[1];
                        handleSubmitAudio(base64);
                    };
                    reader.readAsDataURL(audioBlob);
                };

                mediaRecorder.start();
                setIsRecording(true);
            } catch (err) {
                console.error("Erreur accès microphone :", err);
                toast({
                    title: "Microphone inaccessible",
                    description: "Veuillez autoriser l'accès au microphone.",
                    variant: "destructive"
                });
            }
        }
    };

    const handleSubmitAudio = async (audioBase64: string) => {
        setIsLoading(true);
        try {
            if (mode === "clinique") {
                await executeClinique({ audioBase64, mimeType: "audio/webm" });
            } else {
                await executeStudio({ audioBase64, mimeType: "audio/webm" });
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmitText = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!instruction.trim() || isLoading) return;

        const currentText = instruction.trim();
        setInstruction("");
        setIsLoading(true);

        try {
            if (mode === "clinique") {
                await executeClinique({ instruction: currentText });
            } else {
                await executeStudio({ instruction: currentText });
            }
        } finally {
            setIsLoading(false);
        }
    };

    const executeClinique = async (payload: { instruction?: string; audioBase64?: string; mimeType?: string }) => {
        try {
            const res = await fetch("/api/copilot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...payload,
                    synthese,
                    transcription,
                    patientName
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erreur de traitement");

            // Sauvegarder pour pouvoir annuler
            setLastAction({
                type: "clinique",
                summary: data.summaryOfChanges || "Bilan mis à jour",
                previousSynthese: synthese,
                previousPatientName: patientName
            });

            if (onUpdateSynthese) {
                onUpdateSynthese(data.synthese, data.patientName);
            }

            toast({
                title: "✨ Bilan ajusté",
                description: data.summaryOfChanges || "Modifications intégrées avec succès."
            });
        } catch (err) {
            toast({
                title: "Erreur",
                description: err instanceof Error ? err.message : "Échec de l'opération",
                variant: "destructive"
            });
        }
    };

    const executeStudio = async (payload: { instruction?: string; audioBase64?: string; mimeType?: string }) => {
        try {
            const res = await fetch("/api/studio", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "execute",
                    ...payload,
                    currentPath
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erreur de modification");

            setLastAction({
                type: "studio",
                summary: data.summary || "Application mise à jour",
                backupId: data.backupId
            });

            toast({
                title: "🚀 Application modifiée en direct",
                description: data.summary || `${data.appliedFiles?.length || 0} fichier(s) mis à jour.`
            });
        } catch (err) {
            toast({
                title: "Erreur Studio",
                description: err instanceof Error ? err.message : "Échec de la modification",
                variant: "destructive"
            });
        }
    };

    const handleUndo = async () => {
        if (!lastAction) return;

        if (lastAction.type === "clinique" && lastAction.previousSynthese && onUpdateSynthese) {
            onUpdateSynthese(lastAction.previousSynthese, lastAction.previousPatientName);
            setLastAction(null);
            toast({ title: "↩️ Annulation", description: "Bilan rétabli à l'état précédent." });
        } else if (lastAction.type === "studio" && lastAction.backupId) {
            setIsLoading(true);
            try {
                const res = await fetch("/api/studio", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "rollback",
                        backupId: lastAction.backupId
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                setLastAction(null);
                toast({ title: "↩️ Code restauré", description: data.message });
            } catch (err) {
                toast({ title: "Erreur Rollback", description: String(err), variant: "destructive" });
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 pointer-events-none">
            <div className="pointer-events-auto flex flex-col items-center gap-2">
                {/* Bannière de récapitulatif & Annulation */}
                <AnimatePresence>
                    {lastAction && (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="bg-[#1a1918]/90 backdrop-blur-md text-white text-xs px-3.5 py-1.5 rounded-full shadow-lg flex items-center gap-2 border border-white/10"
                        >
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="truncate max-w-xs">{lastAction.summary}</span>
                            <button
                                onClick={handleUndo}
                                className="ml-1 px-2 py-0.5 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center gap-1 transition-colors"
                            >
                                <Undo2 className="w-3 h-3" />
                                <span>Annuler</span>
                            </button>
                            <button
                                onClick={() => setLastAction(null)}
                                className="text-white/60 hover:text-white ml-1"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Barre principale ultra-épurée */}
                <motion.div
                    layout
                    className={`bg-white/92 backdrop-blur-2xl border border-[#e5e2dd] shadow-2xl rounded-full px-3 py-1.5 flex items-center gap-2 w-full transition-all duration-300 ${
                        isOpen ? "ring-2 ring-[#bd613c]/20" : "hover:border-[#d0ccc6]"
                    }`}
                >
                    {/* Bouton de bascule de Mode */}
                    <div className="flex items-center bg-[#f5f2eb] rounded-full p-0.5 border border-[#e8e4dc]">
                        <button
                            type="button"
                            onClick={() => {
                                setMode("clinique");
                                if (!isOpen) setIsOpen(true);
                            }}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                                mode === "clinique"
                                    ? "bg-white text-[#bd613c] shadow-xs"
                                    : "text-[#8c7b6d] hover:text-[#4a3f35]"
                            }`}
                            title="Mode Clinique : retouche du bilan en cours"
                        >
                            <Stethoscope className="w-3 h-3" />
                            <span className="hidden sm:inline">Bilan</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMode("studio");
                                if (!isOpen) setIsOpen(true);
                            }}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                                mode === "studio"
                                    ? "bg-white text-[#1a1918] shadow-xs"
                                    : "text-[#8c7b6d] hover:text-[#4a3f35]"
                            }`}
                            title="Mode Studio : modification de l'application en direct"
                        >
                            <Code className="w-3 h-3" />
                            <span className="hidden sm:inline">Studio</span>
                        </button>
                    </div>

                    {/* Champ de saisie fluide */}
                    <form onSubmit={handleSubmitText} className="flex-1 flex items-center min-w-0">
                        <input
                            ref={inputRef}
                            type="text"
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            onFocus={() => setIsOpen(true)}
                            placeholder={
                                mode === "clinique"
                                    ? "Une retouche sur le bilan ? (ex: 'Corrige la date', 'Précise la douleur...')"
                                    : "Une amélioration sur l'app ? (ex: 'Ajoute un bouton d'export...')"
                            }
                            disabled={isLoading || isRecording}
                            className="w-full bg-transparent text-xs text-[#4a3f35] placeholder:text-[#8c7b6d]/60 focus:outline-none px-2 py-1"
                        />
                    </form>

                    {/* Bouton Enregistrement Vocal */}
                    <button
                        type="button"
                        onClick={toggleRecording}
                        disabled={isLoading}
                        className={`relative p-2 rounded-full transition-all ${
                            isRecording
                                ? "bg-[#bd613c] text-white shadow-md animate-pulse"
                                : "bg-[#f5f2eb] text-[#8c7b6d] hover:text-[#bd613c] hover:bg-[#ede8df]"
                        }`}
                        title={isRecording ? "Arrêter l'écoute" : "Dicter votre consigne"}
                    >
                        {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                        {isRecording && (
                            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                        )}
                    </button>

                    {/* Bouton d'envoi ou Loader */}
                    {isLoading ? (
                        <div className="p-2 text-[#bd613c]">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => handleSubmitText()}
                            disabled={!instruction.trim()}
                            className={`p-2 rounded-full transition-all ${
                                instruction.trim()
                                    ? "bg-[#bd613c] text-white shadow-xs hover:bg-[#a64f2d]"
                                    : "bg-transparent text-[#8c7b6d]/40"
                            }`}
                        >
                            <Send className="w-3.5 h-3.5" />
                        </button>
                    )}

                    {/* Raccourci subtil */}
                    <span className="hidden md:inline-block text-[10px] text-[#8c7b6d]/50 font-mono pr-1">
                        ⌘K
                    </span>
                </motion.div>
            </div>
        </div>
    );
}
