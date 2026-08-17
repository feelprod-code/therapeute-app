"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Mic, MicOff, Send, Loader2, Undo2, Check, Code, Stethoscope, ChevronUp, ChevronDown, X, MessageSquare, History } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { CopilotChatDrawer } from "./CopilotChatDrawer";

interface CopilotStudioBarProps {
    synthese?: string;
    transcription?: string;
    patientName?: string;
    onUpdateSynthese?: (newSynthese: string, newPatientName?: string, actionLabel?: string) => Promise<void> | void;
    currentPath?: string;
    onOpenHistory?: () => void;
    versionCount?: number;
}

export function CopilotStudioBar({
    synthese,
    transcription,
    patientName,
    onUpdateSynthese,
    currentPath = "/",
    onOpenHistory,
    versionCount = 0
}: CopilotStudioBarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
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
                if (mode === "clinique") {
                    setIsChatDrawerOpen(prev => !prev);
                } else {
                    setIsOpen(prev => {
                        const next = !prev;
                        if (next) setTimeout(() => inputRef.current?.focus(), 150);
                        return next;
                    });
                }
            }
            if (e.key === "Escape") {
                if (isChatDrawerOpen) setIsChatDrawerOpen(false);
                if (isOpen) setIsOpen(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, isChatDrawerOpen, mode]);

    // Basculer automatiquement en mode clinique si un bilan est présent
    useEffect(() => {
        if (synthese && mode !== "clinique") {
            setMode("clinique");
        }
    }, [synthese]);

    // Gestion de l'enregistrement vocal direct
    const toggleRecording = async () => {
        if (isRecording) {
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
                    title: "Accès micro refusé",
                    description: "Veuillez autoriser le microphone dans votre navigateur.",
                    variant: "destructive"
                });
            }
        }
    };

    // Soumission de texte
    const handleSubmitText = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const text = instruction.trim();
        if (!text) return;

        setIsLoading(true);
        try {
            if (mode === "clinique") {
                const prevSynthese = synthese;
                const prevName = patientName;

                const res = await fetch("/api/copilot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        instruction: text,
                        synthese,
                        transcription,
                        patientName
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de traitement");

                if (onUpdateSynthese && data.synthese) {
                    await onUpdateSynthese(
                        data.synthese,
                        data.patientName,
                        data.summaryOfChanges || `Correction: "${text}"`
                    );
                }

                setLastAction({
                    type: "clinique",
                    summary: data.summaryOfChanges || "Bilan mis à jour",
                    previousSynthese: prevSynthese,
                    previousPatientName: prevName
                });

                toast({
                    title: "Bilan mis à jour",
                    description: data.summaryOfChanges || "Retouche appliquée avec succès."
                });

                setInstruction("");
            } else {
                // Mode Studio (Code de l'application)
                const res = await fetch("/api/studio", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        instruction: text,
                        currentPath
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur Studio");

                setLastAction({
                    type: "studio",
                    summary: data.summary || "Application modifiée",
                    backupId: data.backupId
                });

                toast({
                    title: "Modification Studio appliquée !",
                    description: `${data.summary || 'Code mis à jour.'} (${data.appliedFiles?.join(', ') || ''})`
                });

                setInstruction("");
            }
        } catch (err: any) {
            console.error("Erreur Copilot/Studio:", err);
            toast({
                title: mode === "clinique" ? "Erreur Copilote" : "Erreur Studio",
                description: err?.message || "Une erreur est survenue.",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Soumission d'un audio enregistré
    const handleSubmitAudio = async (base64Audio: string) => {
        setIsLoading(true);
        try {
            if (mode === "clinique") {
                const prevSynthese = synthese;
                const prevName = patientName;

                const res = await fetch("/api/copilot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        audioBase64: base64Audio,
                        mimeType: "audio/webm",
                        synthese,
                        transcription,
                        patientName
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur audio Copilot");

                if (onUpdateSynthese && data.synthese) {
                    await onUpdateSynthese(
                        data.synthese,
                        data.patientName,
                        data.summaryOfChanges || `Consigne vocale: "${data.recognizedInstruction || 'retouche'}"`
                    );
                }

                setLastAction({
                    type: "clinique",
                    summary: data.summaryOfChanges || "Bilan mis à jour",
                    previousSynthese: prevSynthese,
                    previousPatientName: prevName
                });

                toast({
                    title: "Consigne vocale appliquée",
                    description: data.summaryOfChanges || "Bilan réajusté avec succès."
                });
            } else {
                const res = await fetch("/api/studio", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        audioBase64: base64Audio,
                        mimeType: "audio/webm",
                        currentPath
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur audio Studio");

                setLastAction({
                    type: "studio",
                    summary: data.summary || "Application modifiée",
                    backupId: data.backupId
                });

                toast({
                    title: "Studio : Modification vocale appliquée",
                    description: data.summary || "Code mis à jour."
                });
            }
        } catch (err: any) {
            console.error("Erreur audio Copilot/Studio:", err);
            toast({
                title: "Erreur d'analyse vocale",
                description: err?.message || "Impossible de traiter la consigne audio.",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Rollback / Annuler la dernière action
    const handleUndo = async () => {
        if (!lastAction) return;

        if (lastAction.type === "clinique" && lastAction.previousSynthese && onUpdateSynthese) {
            await onUpdateSynthese(
                lastAction.previousSynthese,
                lastAction.previousPatientName,
                "Restauration avant dernière retouche"
            );
            toast({
                title: "Modification annulée",
                description: "Le bilan a été restauré dans son état précédent."
            });
            setLastAction(null);
        } else if (lastAction.type === "studio" && lastAction.backupId) {
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
                if (!res.ok) throw new Error(data.error || "Erreur d'annulation");

                toast({
                    title: "Code restauré avec succès !",
                    description: data.message || "Les fichiers d'origine ont été rétablis."
                });
                setLastAction(null);
            } catch (e: any) {
                toast({
                    title: "Erreur lors de l'annulation",
                    description: e?.message,
                    variant: "destructive"
                });
            }
        }
    };

    return (
        <>
            {/* Volet Latéral de Tchat Conversationnel */}
            <CopilotChatDrawer
                isOpen={isChatDrawerOpen}
                onClose={() => setIsChatDrawerOpen(false)}
                synthese={synthese}
                transcription={transcription}
                patientName={patientName}
                currentPath={currentPath}
                onUpdateSynthese={onUpdateSynthese}
                onOpenHistory={onOpenHistory}
                versionCount={versionCount}
            />

            {/* Capsule Flottante en Bas */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-xl px-4 pointer-events-none">
                <div className="flex flex-col items-center gap-2 pointer-events-auto">
                    {/* Bannière de confirmation / annulation rapide */}
                    <AnimatePresence>
                        {lastAction && (
                            <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                className="bg-white/95 backdrop-blur-md border border-[#ebd9c8] shadow-lg rounded-full px-4 py-1.5 flex items-center gap-3 text-xs text-[#594c42]"
                            >
                                <span className="flex items-center gap-1 font-medium text-emerald-700">
                                    <Check className="w-3.5 h-3.5" />
                                    {lastAction.summary}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleUndo}
                                    className="text-[#bd613c] hover:underline font-semibold flex items-center gap-1 transition-all"
                                >
                                    <Undo2 className="w-3 h-3" />
                                    Annuler
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setLastAction(null)}
                                    className="text-slate-400 hover:text-slate-600 ml-1"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Capsule Principale */}
                    <motion.div
                        className={`w-full bg-white/92 backdrop-blur-2xl border border-[#ebd9c8] shadow-xl rounded-full p-1.5 flex items-center gap-2 transition-all ${
                            isOpen ? "ring-2 ring-[#bd613c]/30 shadow-2xl" : "hover:border-[#bd613c]/50"
                        }`}
                    >
                        {/* Bouton de bascule de Mode */}
                        <div className="flex items-center bg-[#f5f2eb] rounded-full p-0.5 border border-[#e8e4dc] shrink-0">
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

                        {/* Champ de saisie */}
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

                        {/* Bouton Tchat Déroulant (en mode clinique) */}
                        {mode === "clinique" && (
                            <button
                                type="button"
                                onClick={() => setIsChatDrawerOpen(true)}
                                className="p-2 rounded-full transition-all bg-[#f5f2eb] text-[#8c7b6d] hover:text-[#bd613c] hover:bg-[#ede8df] shrink-0"
                                title="Ouvrir le tchat conversationnel complet"
                            >
                                <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                        )}

                        {/* Bouton Historique (si présent) */}
                        {onOpenHistory && mode === "clinique" && (
                            <button
                                type="button"
                                onClick={onOpenHistory}
                                className="p-2 rounded-full transition-all bg-[#f5f2eb] text-[#8c7b6d] hover:text-[#bd613c] hover:bg-[#ede8df] shrink-0"
                                title={`Consulter l'historique (${versionCount} versions)`}
                            >
                                <History className="w-3.5 h-3.5" />
                            </button>
                        )}

                        {/* Bouton Enregistrement Vocal */}
                        <button
                            type="button"
                            onClick={toggleRecording}
                            disabled={isLoading}
                            className={`relative p-2 rounded-full transition-all shrink-0 ${
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
                            <div className="p-2 text-[#bd613c] shrink-0">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => handleSubmitText()}
                                disabled={!instruction.trim()}
                                className={`p-2 rounded-full transition-all shrink-0 ${
                                    instruction.trim()
                                        ? "bg-[#bd613c] text-white shadow-xs hover:bg-[#a64f2d]"
                                        : "bg-transparent text-[#8c7b6d]/40"
                                }`}
                            >
                                <Send className="w-3.5 h-3.5" />
                            </button>
                        )}

                        {/* Raccourci subtil */}
                        <span className="hidden md:inline-block text-[10px] text-[#8c7b6d]/50 font-mono pr-1 shrink-0">
                            ⌘K
                        </span>
                    </motion.div>
                </div>
            </div>
        </>
    );
}
