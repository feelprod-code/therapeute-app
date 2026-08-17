export interface AiChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    summaryOfChanges?: string;
    backupId?: string;
    previousSynthese?: string;
    previousPatientName?: string;
    learnedRule?: string;
}

export interface AiConversation {
    id: string;
    title: string;
    mode: "clinique" | "studio";
    createdAt: string;
    updatedAt: string;
    consultationId?: string;
    patientName?: string;
    messages: AiChatMessage[];
}

const STORAGE_KEY = "tdt_ai_conversations_v1";

export function loadAiConversations(): AiConversation[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error("Erreur chargement conversations IA:", e);
        return [];
    }
}

export function saveAiConversations(conversations: AiConversation[]) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (e) {
        console.error("Erreur sauvegarde conversations IA:", e);
    }
}

export function createNewConversation(
    mode: "clinique" | "studio",
    title?: string,
    consultationId?: string,
    patientName?: string
): AiConversation {
    const newConv: AiConversation = {
        id: `conv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        title: title || (mode === "clinique" ? (patientName ? `Bilan ${patientName}` : "Nouvelle retouche bilan") : "Nouvelle session Studio"),
        mode,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        consultationId,
        patientName,
        messages: []
    };

    const all = loadAiConversations();
    saveAiConversations([newConv, ...all]);
    return newConv;
}

export function appendMessageToConversation(
    conversationId: string,
    message: Omit<AiChatMessage, "id" | "timestamp"> & { id?: string; timestamp?: string },
    autoUpdateTitle?: string
): AiConversation | null {
    const all = loadAiConversations();
    const idx = all.findIndex(c => c.id === conversationId);
    if (idx === -1) return null;

    const fullMsg: AiChatMessage = {
        id: message.id || crypto.randomUUID(),
        role: message.role,
        content: message.content,
        timestamp: message.timestamp || new Date().toISOString(),
        summaryOfChanges: message.summaryOfChanges,
        backupId: message.backupId,
        previousSynthese: message.previousSynthese,
        previousPatientName: message.previousPatientName,
        learnedRule: message.learnedRule
    };

    const updatedConv = {
        ...all[idx],
        updatedAt: new Date().toISOString(),
        messages: [...all[idx].messages, fullMsg],
        ...(autoUpdateTitle && all[idx].messages.length <= 1 ? { title: autoUpdateTitle } : {})
    };

    all[idx] = updatedConv;
    // Trier par date de mise à jour décroissante
    all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    saveAiConversations(all);

    return updatedConv;
}

export function deleteAiConversation(conversationId: string): AiConversation[] {
    const all = loadAiConversations().filter(c => c.id !== conversationId);
    saveAiConversations(all);
    return all;
}

export function clearAllAiConversations() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
}
