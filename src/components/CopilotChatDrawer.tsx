"use client";

import { useState, useRef, useEffect } from "react";
import { 
    Sparkles, Mic, MicOff, Send, Loader2, Undo2, X, History, Brain, 
    ChevronRight, Stethoscope, MessageSquare, Bot, User, Check, RefreshCw, 
    Plus, Trash2, ChevronLeft, Search, Code, CornerDownLeft
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
    AiConversation, 
    AiChatMessage, 
    loadAiConversations, 
    createNewConversation, 
    appendMessageToConversation, 
    deleteAiConversation 
} from "@/lib/ai-conversations";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface CopilotChatDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    synthese?: string;
    transcription?: string;
    patientName?: string;
    currentPath?: string;
    onUpdateSynthese?: (newSynthese: string, newPatientName?: string, actionLabel?: string) => Promise<void> | void;
    initialMode?: "clinique" | "studio";
    onOpenHistory?: () => void;
    versionCount?: number;
}

export function CopilotChatDrawer({
    isOpen,
    onClose,
    synthese,
    transcription,
    patientName,
    currentPath = "/",
    onUpdateSynthese,
    initialMode = "clinique"
}: CopilotChatDrawerProps) {
    const [conversations, setConversations] = useState<AiConversation[]>([]);
    const [activeConvId, setActiveConvId] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [searchConv, setSearchConv] = useState("");
    const [mode, setMode] = useState<"clinique" | "studio">(synthese ? "clinique" : initialMode);

    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [learnedRules, setLearnedRules] = useState<string[]>([]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const { toast } = useToast();

    // Initialiser les conversations au montage ou à l'ouverture
    useEffect(() => {
        if (isOpen) {
            const all = loadAiConversations();
            setConversations(all);

            // Si aucune conversation active, en créer une ou prendre la plus récente
            if (!activeConvId) {
                if (all.length > 0) {
                    setActiveConvId(all[0].id);
                } else {
                    const newC = createNewConversation(
                        synthese ? "clinique" : mode,
                        undefined,
                        undefined,
                        patientName
                    );
                    setConversations([newC]);
                    setActiveConvId(newC.id);
                }
            }
            fetchRules();
        }
    }, [isOpen, synthese, patientName]);

    const activeConversation = conversations.find(c => c.id === activeConvId) || conversations[0] || null;

    // Auto-scroll sur nouveau message
    useEffect(() => {
        if (isOpen && !isSidebarOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            setTimeout(() => inputRef.current?.focus(), 150);
        }
    }, [activeConversation?.messages, isOpen, isSidebarOpen]);

    const fetchRules = async () => {
        try {
            const res = await fetch('/api/learn-rule');
            const data = await res.json();
            if (data.rules) setLearnedRules(data.rules);
        } catch {}
    };

    // Créer une nouvelle conversation
    const handleNewChat = (forcedMode?: "clinique" | "studio") => {
        const targetMode = forcedMode || (synthese ? "clinique" : mode);
        const newC = createNewConversation(targetMode, undefined, undefined, patientName);
        const updated = loadAiConversations();
        setConversations(updated);
        setActiveConvId(newC.id);
        setIsSidebarOpen(false);
        setTimeout(() => inputRef.current?.focus(), 150);
    };

    // Supprimer une conversation
    const handleDeleteChat = (e: React.MouseEvent, convId: string) => {
        e.stopPropagation();
        const updated = deleteAiConversation(convId);
        setConversations(updated);
        if (activeConvId === convId) {
            setActiveConvId(updated[0]?.id || null);
        }
        toast({
            title: "Discussion supprimée",
            description: "La conversation avec l'IA a été retirée de votre historique."
        });
    };

    // Gestion de l'enregistrement vocal direct
    const toggleRecording = async () => {
        if (isRecording) {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
            }
            setIsRecording(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                    ? "audio/webm;codecs=opus"
                    : "audio/mp4";

                const recorder = new MediaRecorder(stream, { mimeType });
                audioChunksRef.current = [];

                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) audioChunksRef.current.push(e.data);
                };

                recorder.onstop = async () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                    stream.getTracks().forEach((track) => track.stop());

                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64Data = (reader.result as string).split(",")[1];
                        handleSendMessage("", base64Data, mimeType);
                    };
                    reader.readAsDataURL(audioBlob);
                };

                mediaRecorderRef.current = recorder;
                recorder.start();
                setIsRecording(true);
            } catch (err) {
                console.error("Erreur accès micro:", err);
                toast({
                    title: "Accès micro refusé",
                    description: "Veuillez autoriser l'accès au micro dans votre navigateur.",
                    variant: "destructive"
                });
            }
        }
    };

    // Envoyer un message dans la conversation active
    const handleSendMessage = async (textInstruction?: string, audioBase64?: string, mimeType?: string) => {
        const queryText = (textInstruction !== undefined ? textInstruction : input).trim();
        if (!queryText && !audioBase64) return;

        let currentConv = activeConversation;
        if (!currentConv) {
            currentConv = createNewConversation(synthese ? "clinique" : mode, undefined, undefined, patientName);
            setActiveConvId(currentConv.id);
        }

        const userMsgId = crypto.randomUUID();
        const userMsg: AiChatMessage = {
            id: userMsgId,
            role: "user",
            content: queryText || "🎤 Consigne vocale...",
            timestamp: new Date().toISOString()
        };

        // Définir un titre automatique sur le premier message
        const autoTitle = currentConv.messages.length === 0
            ? (queryText ? queryText.slice(0, 32) + (queryText.length > 32 ? '...' : '') : "Message vocal")
            : undefined;

        appendMessageToConversation(currentConv.id, userMsg, autoTitle);
        setConversations(loadAiConversations());
        setInput("");
        setIsLoading(true);

        const prevSynthese = synthese;
        const prevPatientName = patientName;
        const currentConvMode = currentConv.mode || (synthese ? "clinique" : "studio");

        try {
            const conversationHistory = currentConv.messages.slice(-6).map((m) => ({
                role: m.role,
                content: m.content
            }));

            if (currentConvMode === "clinique") {
                const res = await fetch("/api/copilot", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        instruction: queryText,
                        synthese,
                        transcription,
                        patientName,
                        audioBase64,
                        mimeType,
                        conversationHistory
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de traitement Copilot");

                if (onUpdateSynthese && data.synthese) {
                    await onUpdateSynthese(
                        data.synthese,
                        data.patientName,
                        data.summaryOfChanges || `Correction: "${data.recognizedInstruction || queryText}"`
                    );
                }

                const assistantMsg: Omit<AiChatMessage, "id" | "timestamp"> = {
                    role: "assistant",
                    content: data.summaryOfChanges || "Bilan réajusté avec succès.",
                    summaryOfChanges: data.summaryOfChanges,
                    previousSynthese: prevSynthese,
                    previousPatientName: prevPatientName,
                    learnedRule: data.learnedRule
                };

                appendMessageToConversation(currentConv.id, assistantMsg);
                setConversations(loadAiConversations());

                if (data.learnedRule) {
                    fetchRules();
                    toast({
                        title: "🧠 Règle mémorisée",
                        description: data.learnedRule
                    });
                }
            } else {
                // Mode Studio (Code)
                const res = await fetch("/api/studio", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        instruction: queryText,
                        audioBase64,
                        mimeType,
                        currentPath
                    })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur Studio");

                const assistantMsg: Omit<AiChatMessage, "id" | "timestamp"> = {
                    role: "assistant",
                    content: data.summary || "Application modifiée avec succès.",
                    summaryOfChanges: data.summary,
                    backupId: data.backupId
                };

                appendMessageToConversation(currentConv.id, assistantMsg);
                setConversations(loadAiConversations());

                toast({
                    title: "Modification Studio appliquée !",
                    description: `${data.summary || 'Code mis à jour.'} (${data.appliedFiles?.join(', ') || ''})`
                });
            }
        } catch (e: any) {
            toast({
                title: "Erreur",
                description: e?.message || "Une erreur est survenue.",
                variant: "destructive"
            });
            appendMessageToConversation(currentConv.id, {
                role: "assistant",
                content: `⚠️ Erreur : ${e?.message || "Impossible d'appliquer la consigne."}`
            });
            setConversations(loadAiConversations());
        } finally {
            setIsLoading(false);
        }
    };

    // Annuler / Revert d'une action passée
    const handleRevert = async (msg: AiChatMessage) => {
        if (msg.previousSynthese && onUpdateSynthese) {
            try {
                await onUpdateSynthese(
                    msg.previousSynthese,
                    msg.previousPatientName,
                    `Annulation de : "${msg.summaryOfChanges || 'retouche'}"`
                );
                toast({
                    title: "Annulation effectuée",
                    description: "Le bilan a été restauré dans son état précédant cette retouche."
                });
            } catch (e: any) {
                toast({ title: "Erreur", description: e?.message, variant: "destructive" });
            }
        } else if (msg.backupId) {
            try {
                const res = await fetch("/api/studio", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "rollback", backupId: msg.backupId })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Erreur de rollback");
                toast({
                    title: "Code restauré",
                    description: data.message || "Fichiers d'origine rétablis."
                });
            } catch (e: any) {
                toast({ title: "Erreur", description: e?.message, variant: "destructive" });
            }
        }
    };

    // Mémoriser une règle
    const handleMemorizeCustomRule = async (ruleText: string) => {
        try {
            const res = await fetch("/api/learn-rule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rule: ruleText })
            });
            const d = await res.json();
            if (res.ok) {
                fetchRules();
                toast({
                    title: "🧠 Règle enregistrée dans votre ADN Thérapeute",
                    description: `"${ruleText}" sera appliquée automatiquement sur vos futurs bilans.`
                });
            }
        } catch (e: any) {
            toast({ title: "Erreur", description: e?.message, variant: "destructive" });
        }
    };

    const filteredConversations = conversations.filter(c => 
        !searchConv || c.title.toLowerCase().includes(searchConv.toLowerCase())
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Overlay de fond */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/25 backdrop-blur-xs z-50 transition-opacity"
                    />

                    {/* Volet Latéral Principal */}
                    <motion.div
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "spring", damping: 28, stiffness: 280 }}
                        className="fixed top-0 right-0 bottom-0 w-full sm:w-[500px] bg-[#fdfbf6] border-l border-[#ebd9c8] shadow-2xl z-50 flex flex-col overflow-hidden"
                    >
                        {/* En-tête du Tchat */}
                        <div className="px-4 py-3.5 bg-white/90 border-b border-[#ebd9c8] flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                    className={`h-8 w-8 rounded-xl ${isSidebarOpen ? "bg-[#bd613c] text-white" : "text-[#594c42] hover:bg-[#ebd9c8]/30"}`}
                                    title="Historique des discussions avec l'IA"
                                >
                                    <History className="w-4 h-4" />
                                </Button>

                                <div className="min-w-0">
                                    <h3 className="font-bebas text-xl text-[#594c42] leading-tight tracking-wide truncate">
                                        {activeConversation?.title || "Conversation IA"}
                                    </h3>
                                    <span className="text-[10px] text-[#8c7b6d] flex items-center gap-1">
                                        {activeConversation?.mode === "clinique" ? "🩺 Copilote Bilan" : "💻 Mode Studio (App)"}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleNewChat()}
                                    className="h-8 px-2.5 rounded-xl border-[#ebd9c8] text-[#bd613c] hover:bg-[#ebd9c8]/30 gap-1 text-xs"
                                    title="Démarrer une nouvelle discussion"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Nouveau</span>
                                </Button>

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onClose}
                                    className="h-8 w-8 rounded-xl text-slate-400 hover:text-[#bd613c]"
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Corps principal : Tchat ou Volet Historique des Conversations */}
                        <div className="flex-1 relative overflow-hidden flex flex-col">
                            {/* Volet Tiroir : Historique des discussions */}
                            <AnimatePresence>
                                {isSidebarOpen && (
                                    <motion.div
                                        initial={{ x: "-100%", opacity: 0 }}
                                        animate={{ x: 0, opacity: 1 }}
                                        exit={{ x: "-100%", opacity: 0 }}
                                        transition={{ type: "spring", damping: 26, stiffness: 300 }}
                                        className="absolute inset-0 bg-[#fdfbf6] z-20 flex flex-col p-4 border-r border-[#ebd9c8]"
                                    >
                                        <div className="flex items-center justify-between pb-3 border-b border-[#ebd9c8]">
                                            <div className="flex items-center gap-2">
                                                <History className="w-4 h-4 text-[#bd613c]" />
                                                <h4 className="font-bebas text-lg text-[#594c42] tracking-wide">
                                                    Mes Conversations ({conversations.length})
                                                </h4>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setIsSidebarOpen(false)}
                                                className="h-7 text-xs text-[#8c7b6d] hover:text-[#594c42]"
                                            >
                                                Fermer
                                            </Button>
                                        </div>

                                        {/* Recherche de conversation */}
                                        <div className="my-3 relative">
                                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8c7b6d]" />
                                            <input
                                                type="text"
                                                value={searchConv}
                                                onChange={(e) => setSearchConv(e.target.value)}
                                                placeholder="Rechercher une discussion..."
                                                className="w-full bg-white border border-[#ebd9c8] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#4a3f35] placeholder:text-[#8c7b6d]/60 focus:outline-none focus:border-[#bd613c]"
                                            />
                                        </div>

                                        {/* Liste des conversations */}
                                        <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                                            {filteredConversations.length === 0 ? (
                                                <div className="py-12 text-center text-xs text-[#8c7b6d]">
                                                    Aucune discussion trouvée.
                                                </div>
                                            ) : (
                                                filteredConversations.map((c) => {
                                                    const isSelected = c.id === activeConvId;
                                                    return (
                                                        <div
                                                            key={c.id}
                                                            onClick={() => {
                                                                setActiveConvId(c.id);
                                                                setIsSidebarOpen(false);
                                                            }}
                                                            className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                                                                isSelected
                                                                    ? "bg-white border-[#bd613c] shadow-xs ring-1 ring-[#bd613c]/30"
                                                                    : "bg-white/70 border-[#ebd9c8]/70 hover:bg-white hover:border-[#bd613c]/40"
                                                            }`}
                                                        >
                                                            <div className="min-w-0 flex-1 pr-2">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className={`w-1.5 h-1.5 rounded-full ${c.mode === 'clinique' ? 'bg-[#bd613c]' : 'bg-slate-700'}`} />
                                                                    <p className="text-xs font-semibold text-[#594c42] truncate">
                                                                        {c.title}
                                                                    </p>
                                                                </div>
                                                                <p className="text-[10px] text-[#8c7b6d] mt-0.5">
                                                                    {format(new Date(c.updatedAt), "dd MMM HH:mm", { locale: fr })} • {c.messages.length} message{c.messages.length > 1 ? "s" : ""}
                                                                </p>
                                                            </div>

                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleDeleteChat(e, c.id)}
                                                                className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-all"
                                                                title="Supprimer cette discussion"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>

                                        {/* Bouton nouvelle discussion en bas */}
                                        <div className="pt-3 border-t border-[#ebd9c8]">
                                            <Button
                                                onClick={() => handleNewChat()}
                                                className="w-full bg-[#bd613c] hover:bg-[#a55231] text-white rounded-xl text-xs h-9 gap-1.5"
                                            >
                                                <Plus className="w-4 h-4" />
                                                Nouvelle Discussion
                                            </Button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Fil des messages du tchat */}
                            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                                {activeConversation?.messages.length === 0 ? (
                                    <div className="my-auto py-8 px-4 text-center text-[#8c7b6d] flex flex-col items-center gap-3">
                                        <div className="w-12 h-12 rounded-2xl bg-[#bd613c]/10 text-[#bd613c] flex items-center justify-center shadow-xs">
                                            <Bot className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <p className="font-medium text-sm text-[#594c42]">
                                                {activeConversation.mode === "clinique" ? "Copilote Bilan Consultation" : "Copilote Studio (Code App)"}
                                            </p>
                                            <p className="text-xs text-[#8c7b6d] mt-1 max-w-[280px] leading-relaxed">
                                                Vous pouvez converser en continu, affiner un point, demander à l'IA de revoir sa correction ou mémoriser une règle de style.
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap gap-2 justify-center mt-2 max-w-sm">
                                            <button
                                                type="button"
                                                onClick={() => setInput("Ajoute que la flexion de cheville est libre")}
                                                className="text-[11px] bg-white border border-[#ebd9c8] px-2.5 py-1.5 rounded-lg text-[#594c42] hover:border-[#bd613c] transition-all"
                                            >
                                                "Ajoute que la flexion..."
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setInput("Mémorise que je veux toujours la date en gris sous le titre")}
                                                className="text-[11px] bg-white border border-[#ebd9c8] px-2.5 py-1.5 rounded-lg text-[#594c42] hover:border-[#bd613c] transition-all"
                                            >
                                                "Mémorise que..."
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    activeConversation?.messages.map((m) => (
                                        <div
                                            key={m.id}
                                            className={`flex flex-col gap-1 ${
                                                m.role === "user" ? "items-end" : "items-start"
                                            }`}
                                        >
                                            <div
                                                className={`max-w-[88%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                                                    m.role === "user"
                                                        ? "bg-[#bd613c] text-white rounded-br-xs shadow-xs"
                                                        : "bg-white border border-[#ebd9c8] text-[#4a3f35] rounded-bl-xs shadow-xs"
                                                }`}
                                            >
                                                <p>{m.content}</p>

                                                {m.learnedRule && (
                                                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-[10px] text-amber-800 font-semibold">
                                                        <Brain className="w-3 h-3 text-amber-600" />
                                                        <span>{m.learnedRule}</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions sous le message assistant */}
                                            {m.role === "assistant" && (m.previousSynthese || m.backupId) && (
                                                <div className="flex items-center gap-3 pl-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRevert(m)}
                                                        className="text-[10px] text-[#8c7b6d] hover:text-[#bd613c] flex items-center gap-1 transition-colors"
                                                    >
                                                        <Undo2 className="w-3 h-3" />
                                                        Annuler cette retouche
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}

                                {isLoading && (
                                    <div className="flex items-center gap-2 text-xs text-[#8c7b6d] bg-white border border-[#ebd9c8] p-3 rounded-2xl max-w-[70%] shadow-xs">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#bd613c]" />
                                        <span>L'IA analyse et applique votre consigne...</span>
                                    </div>
                                )}

                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* Zone de saisie & Micro */}
                        <div className="p-3 bg-white/90 border-t border-[#ebd9c8] shrink-0">
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleSendMessage();
                                }}
                                className="flex items-center gap-2 bg-[#fdfbf6] border border-[#ebd9c8] rounded-xl p-1.5 shadow-inner"
                            >
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder="Posez une question, corrigez ou dites 'Mémorise que...'"
                                    className="flex-1 bg-transparent text-xs text-[#4a3f35] placeholder:text-[#8c7b6d]/60 focus:outline-none px-2 py-1"
                                    disabled={isLoading || isRecording}
                                />

                                <button
                                    type="button"
                                    onClick={toggleRecording}
                                    className={`relative p-2 rounded-lg transition-all ${
                                        isRecording
                                            ? "bg-red-500 text-white animate-pulse"
                                            : "bg-[#f5f2eb] text-[#8c7b6d] hover:text-[#bd613c] hover:bg-[#ede8df]"
                                    }`}
                                    title="Dicter la consigne à la voix"
                                >
                                    {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                </button>

                                <button
                                    type="submit"
                                    disabled={isLoading || (!input.trim() && !isRecording)}
                                    className={`p-2 rounded-lg transition-all ${
                                        input.trim()
                                            ? "bg-[#bd613c] text-white hover:bg-[#a55231] shadow-xs"
                                            : "bg-transparent text-[#8c7b6d]/40"
                                    }`}
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </form>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
