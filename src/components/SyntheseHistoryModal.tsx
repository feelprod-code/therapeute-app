"use client";

import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { History, Eye, Undo2, Trash2, X, Check, FileText, Sparkles, ChevronRight, Calendar, AlertCircle, MessageSquare, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
            <DialogContent className="max-w-4xl max-h-[85vh] h-[85vh] p-0 flex flex-col bg-[#fdfbf6] border-[#ebd9c8] overflow-hidden rounded-2xl shadow-2xl">
                {/* En-tête */}
                <div className="px-6 py-4 border-b border-[#ebd9c8] bg-white/80 backdrop-blur flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-[#bd613c]/10 text-[#bd613c] flex items-center justify-center">
                            <History className="w-4 h-4" />
                        </div>
                        <div>
                            <DialogTitle className="font-bebas text-2xl tracking-wide text-[#594c42] leading-none">
                                Historique des révisions & demandes archivées
                            </DialogTitle>
                            <p className="text-xs text-[#8c7b6d] mt-0.5">
                                {sortedVersions.length} version{sortedVersions.length > 1 ? "s" : ""} archivée{sortedVersions.length > 1 ? "s" : ""} (demandes du praticien et réponses de l'IA)
                            </p>
                        </div>
                    </div>
                </div>

                {/* Corps à 2 colonnes */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                    {/* Colonne de gauche : Liste des versions */}
                    <div className="w-full md:w-80 border-r border-[#ebd9c8] bg-white/50 overflow-y-auto p-3 flex flex-col gap-2 shrink-0">
                        {sortedVersions.length === 0 ? (
                            <div className="py-12 px-4 text-center text-[#8c7b6d] flex flex-col items-center gap-2">
                                <History className="w-8 h-8 opacity-30 text-[#bd613c]" />
                                <p className="text-sm font-medium">Aucune version archivée</p>
                                <p className="text-xs text-slate-400">
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
                                        className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 text-left relative group ${
                                            isSelected
                                                ? "bg-white border-[#bd613c] shadow-sm ring-1 ring-[#bd613c]/30"
                                                : "bg-white/70 border-[#ebd9c8]/70 hover:bg-white hover:border-[#bd613c]/50"
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

                                        {/* Titre / Consigne */}
                                        <p className="text-xs text-[#594c42] font-semibold line-clamp-2 mt-0.5">
                                            {v.userPrompt ? `🗣️ "${v.userPrompt}"` : (v.label || `Version #${sortedVersions.length - idx}`)}
                                        </p>

                                        {/* Réponse courte */}
                                        {v.aiResponseSummary && (
                                            <p className="text-[11px] text-[#8c7b6d] line-clamp-1 italic">
                                                🤖 {v.aiResponseSummary}
                                            </p>
                                        )}

                                        <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-100/80">
                                            <span className="text-[10px] text-slate-400">
                                                {v.synthese.length} caractères
                                            </span>
                                            <button
                                                type="button"
                                                onClick={(e) => handleDelete(e, v.id)}
                                                disabled={isDeleting === v.id}
                                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 rounded transition-all"
                                                title="Supprimer cette version de l'historique"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Colonne de droite : Prévisualisation & Actions */}
                    <div className="flex-1 flex flex-col bg-[#fdfbf6] overflow-hidden">
                        {activePreview ? (
                            <>
                                {/* Encart : Ce que vous avez demandé et la réponse de l'IA */}
                                <div className="p-4 bg-white/90 border-b border-[#ebd9c8] flex flex-col gap-2 shrink-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[11px] text-[#8c7b6d] font-medium flex items-center gap-1.5">
                                            <Calendar className="w-3 h-3 text-[#bd613c]" />
                                            Enregistré le {format(new Date(activePreview.date), "dd MMMM yyyy 'à' HH:mm:ss", { locale: fr })}
                                        </span>
                                        <Button
                                            size="sm"
                                            onClick={() => handleRestore(activePreview)}
                                            disabled={isRestoring || activePreview.synthese.trim() === currentSynthese?.trim()}
                                            className="bg-[#bd613c] hover:bg-[#a55231] text-white rounded-xl text-xs h-7 px-3 gap-1.5 shadow-sm shrink-0"
                                        >
                                            <Undo2 className="w-3 h-3" />
                                            {activePreview.synthese.trim() === currentSynthese?.trim() ? "Version actuelle" : "Restaurer cet état"}
                                        </Button>
                                    </div>

                                    {/* Bloc Demande */}
                                    <div className="p-2.5 bg-[#fbf6f0] border border-[#ebd9c8]/70 rounded-lg flex items-start gap-2">
                                        <span className="text-[11px] font-bold text-[#bd613c] uppercase shrink-0 mt-0.5">
                                            🗣️ Ce que vous avez demandé :
                                        </span>
                                        <span className="text-xs text-[#594c42] font-medium">
                                            {activePreview.userPrompt || activePreview.label || "Demande du praticien"}
                                        </span>
                                    </div>

                                    {/* Bloc Réponse IA */}
                                    {activePreview.aiResponseSummary && (
                                        <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/60 rounded-lg flex items-start gap-2">
                                            <span className="text-[11px] font-bold text-emerald-800 uppercase shrink-0 mt-0.5">
                                                🤖 Réponse & Action de l'IA :
                                            </span>
                                            <span className="text-xs text-emerald-900">
                                                {activePreview.aiResponseSummary}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Contenu Markdown résultant */}
                                <div className="flex-1 p-6 overflow-y-auto prose prose-stone max-w-none text-sm leading-relaxed">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeRaw]}
                                    >
                                        {activePreview.synthese}
                                    </ReactMarkdown>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                                Sélectionnez une version à gauche pour l'examiner.
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
