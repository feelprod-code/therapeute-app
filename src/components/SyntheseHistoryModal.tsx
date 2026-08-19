"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react/no-unescaped-entities */

import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { 
    History, Eye, Undo2, Trash2, X, Check, FileText, Sparkles, 
    ChevronRight, Calendar, AlertCircle, MessageSquare, Bot, ArrowLeft 
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export interface SyntheseVersionItem {
    id: string;
    type: "synthese_version";
    date: string;
    label: string;
    userPrompt?: string;
    aiResponseSummary?: string;
    synthese: string;
    patient_name?: string;
}

interface SyntheseHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    versions: SyntheseVersionItem[];
    currentSynthese: string;
    currentPatientName?: string;
    onRestoreVersion: (version: SyntheseVersionItem) => Promise<void>;
    onDeleteVersion: (versionId: string) => Promise<void>;
}

export function SyntheseHistoryModal({
    isOpen,
    onClose,
    versions,
    currentSynthese,
    currentPatientName,
    onRestoreVersion,
    onDeleteVersion
}: SyntheseHistoryModalProps) {
    const [selectedVersion, setSelectedVersion] = useState<SyntheseVersionItem | null>(null);
    const [isRestoring, setIsRestoring] = useState(false);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const { toast } = useToast();

    const sortedVersions = [...versions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const activePreview = selectedVersion || sortedVersions[0] || null;

    const handleRestore = async (v: SyntheseVersionItem) => {
        setIsRestoring(true);
        try {
            await onRestoreVersion(v);
            toast({
                title: "Version restaurée avec succès",
                description: `Bilan rétabli à l'état du ${format(new Date(v.date), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}.`
            });
            onClose();
        } catch (e: any) {
            toast({
                title: "Erreur de restauration",
                description: e?.message || "Impossible de restaurer la version.",
                variant: "destructive"
            });
        } finally {
            setIsRestoring(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, vId: string) => {
        e.stopPropagation();
        if (!confirm("Voulez-vous vraiment supprimer cette version de votre historique ?")) return;
        setIsDeleting(vId);
        try {
            await onDeleteVersion(vId);
            if (selectedVersion?.id === vId) {
                setSelectedVersion(null);
            }
            toast({
                title: "Version supprimée",
                description: "La révision a été retirée de votre historique."
            });
        } catch (e: any) {
            toast({
                title: "Erreur de suppression",
                description: e?.message || "Impossible de supprimer la révision.",
                variant: "destructive"
            });
        } finally {
            setIsDeleting(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="w-full h-full sm:h-[90vh] sm:max-w-4xl p-0 flex flex-col bg-[#fdfbf6] border-[#ebd9c8] overflow-hidden sm:rounded-2xl shadow-2xl max-h-[100dvh]">
                
                {/* En-tête Adaptatif Mobile & Desktop */}
                <div className="px-4 sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-3.5 border-b border-[#ebd9c8] bg-white/95 backdrop-blur flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {/* Sur mobile : Si une version est ouverte, bouton Retour à la liste */}
                        {selectedVersion && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedVersion(null)}
                                className="sm:hidden -ml-2 h-9 px-2 text-[#bd613c] hover:bg-[#ebd9c8]/30 gap-1 font-medium text-xs"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span>Liste</span>
                            </Button>
                        )}

                        <div className="w-8 h-8 rounded-lg bg-[#bd613c]/10 text-[#bd613c] flex items-center justify-center shrink-0">
                            <History className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="font-bebas text-xl sm:text-2xl tracking-wide text-[#594c42] leading-none truncate">
                                {selectedVersion ? "Détail de la Révision" : "Historique des Révisions"}
                            </DialogTitle>
                            <p className="text-[11px] sm:text-xs text-[#8c7b6d] mt-0.5 truncate">
                                {sortedVersions.length} version{sortedVersions.length > 1 ? "s" : ""} archivée{sortedVersions.length > 1 ? "s" : ""}
                            </p>
                        </div>
                    </div>

                    {/* Bouton Fermer bien tactile */}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClose}
                        className="h-9 px-3 rounded-xl text-slate-500 hover:text-[#bd613c] hover:bg-[#ebd9c8]/30 font-medium text-xs gap-1"
                    >
                        <X className="w-4 h-4" />
                        <span className="hidden sm:inline">Fermer</span>
                    </Button>
                </div>

                {/* Corps Principal : Vue Liste sur Mobile ou 2 colonnes sur Desktop */}
                <div className="flex-1 flex flex-col sm:flex-row overflow-hidden pb-[env(safe-area-inset-bottom,0px)]">
                    
                    {/* Colonne de Gauche (Liste des Révisions) : Masquée sur mobile si une version est sélectionnée */}
                    <div className={`w-full sm:w-80 border-r border-[#ebd9c8] bg-white/60 overflow-y-auto p-3 flex flex-col gap-2 shrink-0 ${selectedVersion ? "hidden sm:flex" : "flex"}`}>
                        {sortedVersions.length === 0 ? (
                            <div className="py-16 px-4 text-center text-[#8c7b6d] flex flex-col items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-[#bd613c]/10 flex items-center justify-center text-[#bd613c]">
                                    <History className="w-6 h-6" />
                                </div>
                                <p className="text-sm font-semibold text-[#594c42]">Aucune version archivée</p>
                                <p className="text-xs text-slate-400 max-w-xs">
                                    Une capture automatique est créée à chaque retouche effectuée par le Copilote ou en édition manuelle.
                                </p>
                            </div>
                        ) : (
                            sortedVersions.map((v, idx) => {
                                const isSelected = activePreview?.id === v.id;
                                const isCurrent = v.synthese.trim() === currentSynthese?.trim();

                                return (
                                    <div
                                        key={v.id}
                                        onClick={() => setSelectedVersion(v)}
                                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 text-left relative group ${
                                            isSelected
                                                ? "bg-white border-[#bd613c] shadow-sm ring-1 ring-[#bd613c]/30"
                                                : "bg-white/80 border-[#ebd9c8]/80 hover:bg-white hover:border-[#bd613c]/50 shadow-xs"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-semibold text-[#bd613c] uppercase tracking-wider flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                {format(new Date(v.date), "dd MMM yyyy 'à' HH:mm", { locale: fr })}
                                            </span>
                                            {isCurrent && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                                    Actuel
                                                </span>
                                            )}
                                        </div>

                                        {/* Demande du praticien */}
                                        <p className="text-xs text-[#594c42] font-semibold line-clamp-2 mt-0.5 leading-snug">
                                            {v.userPrompt ? `🗣️ "${v.userPrompt}"` : (v.label || `Version #${sortedVersions.length - idx}`)}
                                        </p>

                                        {/* Réponse courte IA */}
                                        {v.aiResponseSummary && (
                                            <p className="text-[11px] text-[#8c7b6d] line-clamp-1 italic">
                                                🤖 {v.aiResponseSummary}
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-slate-100">
                                            <span className="text-[10px] text-slate-400">
                                                {v.synthese.length} caractères
                                            </span>
                                            
                                            <div className="flex items-center gap-2">
                                                <span className="sm:hidden text-[11px] text-[#bd613c] font-medium flex items-center">
                                                    Consulter <ChevronRight className="w-3 h-3 ml-0.5" />
                                                </span>

                                                {/* Bouton Supprimer tactile accessible directement */}
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleDelete(e, v.id)}
                                                    disabled={isDeleting === v.id}
                                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                    title="Supprimer cette version de l'historique"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Colonne de Droite (Détail de la version) : Plein écran sur mobile si sélectionnée */}
                    <div className={`flex-1 flex flex-col bg-[#fdfbf6] overflow-hidden ${!selectedVersion ? "hidden sm:flex" : "flex"}`}>
                        {activePreview ? (
                            <>
                                {/* Encart Demande et Réponse IA */}
                                <div className="p-3.5 sm:p-4 bg-white/95 border-b border-[#ebd9c8] flex flex-col gap-2.5 shrink-0 shadow-xs">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[11px] text-[#8c7b6d] font-medium flex items-center gap-1.5 truncate">
                                            <Calendar className="w-3.5 h-3.5 text-[#bd613c] shrink-0" />
                                            {format(new Date(activePreview.date), "dd MMMM yyyy 'à' HH:mm:ss", { locale: fr })}
                                        </span>
                                        <Button
                                            size="sm"
                                            onClick={() => handleRestore(activePreview)}
                                            disabled={isRestoring || activePreview.synthese.trim() === currentSynthese?.trim()}
                                            className="bg-[#bd613c] hover:bg-[#a55231] text-white rounded-xl text-xs h-8 px-3 gap-1.5 shadow-sm shrink-0 font-medium"
                                        >
                                            <Undo2 className="w-3.5 h-3.5" />
                                            {activePreview.synthese.trim() === currentSynthese?.trim() ? "Version actuelle" : "Restaurer cet état"}
                                        </Button>
                                    </div>

                                    {/* Bloc Demande */}
                                    <div className="p-2.5 sm:p-3 bg-[#fbf6f0] border border-[#ebd9c8]/70 rounded-xl flex flex-col gap-1">
                                        <span className="text-[10px] font-bold text-[#bd613c] uppercase tracking-wide">
                                            🗣️ Ce que vous avez demandé :
                                        </span>
                                        <p className="text-xs text-[#594c42] font-medium leading-relaxed">
                                            {activePreview.userPrompt || activePreview.label || "Demande du praticien"}
                                        </p>
                                    </div>

                                    {/* Bloc Réponse IA */}
                                    {activePreview.aiResponseSummary && (
                                        <div className="p-2.5 sm:p-3 bg-emerald-50/80 border border-emerald-200/70 rounded-xl flex flex-col gap-1">
                                            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wide">
                                                🤖 Réponse & Action appliquée par l'IA :
                                            </span>
                                            <p className="text-xs text-emerald-950 leading-relaxed">
                                                {activePreview.aiResponseSummary}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Contenu Markdown résultant */}
                                <div className="flex-1 p-4 sm:p-6 overflow-y-auto prose prose-stone max-w-none text-xs sm:text-sm leading-relaxed bg-[#fdfbf6]">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeRaw]}
                                    >
                                        {activePreview.synthese}
                                    </ReactMarkdown>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm p-6 text-center">
                                Sélectionnez une version dans la liste pour l'examiner.
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
