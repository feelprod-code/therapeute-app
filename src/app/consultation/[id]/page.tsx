"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { db, Consultation } from "@/lib/db";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import ReactMarkdown from "react-markdown";
import generatePDF from "react-to-pdf";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, Download, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function ConsultationPage() {
    const params = useParams();
    const router = useRouter();
    const { toast } = useToast();
    const [consultation, setConsultation] = useState<Consultation | null>(null);
    const [includeTranscript, setIncludeTranscript] = useState(false);

    const targetRef = useRef<HTMLDivElement>(null);
    const id = Number(params.id);

    useEffect(() => {
        async function fetchConsultation() {
            if (id) {
                const data = await db.consultations.get(id);
                if (data) {
                    setConsultation(data);
                } else {
                    router.push("/");
                }
            }
        }
        fetchConsultation();
    }, [id, router]);

    const handleCopyText = async () => {
        if (consultation?.synthese) {
            const textToCopy = includeTranscript && consultation.transcription
                ? `${consultation.synthese}\n\n---\n\nRetranscription brute :\n${consultation.transcription}`
                : consultation.synthese;
            await navigator.clipboard.writeText(textToCopy);
            toast({
                title: "Texte copié",
                description: "Le bilan a été copié dans le presse-papiers.",
            });
        }
    };

    const handleExportPDF = () => {
        if (targetRef.current) {
            const filename = `Bilan_${consultation?.patientName || "Patient"}_${format(
                new Date(consultation?.date || new Date()),
                "dd-MM-yyyy"
            )}.pdf`;
            generatePDF(targetRef, {
                filename,
                page: { format: 'A4', margin: 15 }
            });
        }
    };

    const handleDelete = async () => {
        if (confirm("Êtes-vous sûr de vouloir supprimer cette consultation ?")) {
            await db.consultations.delete(id);
            toast({
                title: "Consultation supprimée",
            });
            router.push("/");
        }
    };

    if (!consultation) {
        return <div className="p-8 text-center font-inter">Chargement...</div>;
    }

    return (
        <main className="min-h-screen py-8 px-4 sm:px-6">
            <div className="max-w-4xl mx-auto space-y-6">

                {/* Navigation et Actions */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <Button variant="outline" onClick={() => router.push("/")} className="gap-2">
                        <ArrowLeft className="w-4 h-4" />
                        Retour au tableau de bord
                    </Button>

                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center space-x-2 bg-white px-3 py-1.5 rounded-md border shadow-sm">
                            <Switch
                                id="include-transcript"
                                checked={includeTranscript}
                                onCheckedChange={setIncludeTranscript}
                            />
                            <Label htmlFor="include-transcript" className="text-sm text-slate-600 cursor-pointer">
                                Inclure la retranscription littérale
                            </Label>
                        </div>
                        <Button variant="secondary" onClick={handleCopyText} className="gap-2">
                            <Copy className="w-4 h-4" />
                            Copier
                        </Button>
                        <Button onClick={handleExportPDF} className="gap-2 bg-[#bd613c] hover:bg-[#a05232]">
                            <Download className="w-4 h-4" />
                            Export A4
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} className="gap-2">
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* Cible pour le PDF (Format A4 simulé) */}
                <div className="bg-white mx-auto shadow-sm border border-slate-200" style={{ width: '210mm', minHeight: '297mm' }}>
                    <div ref={targetRef} className="p-12 text-[#4a3f35] font-inter">

                        {/* En-tête TDT pour le PDF */}
                        <div className="flex justify-between items-start border-b-[3px] border-[#bd613c] pb-6 mb-8 mt-4">
                            <div>
                                <h1 className="font-bebas text-4xl text-[#bd613c] tracking-widest uppercase leading-none">
                                    Techniques Douces
                                </h1>
                                <div className="flex items-center gap-2 mt-1 mb-2">
                                    <span className="h-[2px] w-6 bg-[#bd613c]"></span>
                                    <h2 className="font-bebas text-3xl text-[#bd613c] tracking-widest uppercase leading-none">
                                        Tissulaires
                                    </h2>
                                    <span className="h-[2px] w-6 bg-[#bd613c]"></span>
                                </div>
                                <p className="text-sm font-semibold tracking-wider text-slate-500 uppercase mt-2">
                                    Guillaume Philippe<br />
                                    <span className="text-xs font-normal">Kinésithérapeute</span>
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-xl font-bold">Bilan de Consultation</p>
                                <p className="text-sm text-slate-500 mt-1">
                                    {format(new Date(consultation.date), "EEEE d MMMM yyyy", { locale: fr })}
                                </p>
                            </div>
                        </div>

                        {/* Contenu IA en Markdown */}
                        <div className="prose max-w-none prose-headings:text-[#1a2f4c] prose-h3:text-xl prose-h3:font-bold prose-h3:border-b prose-h3:pb-2 prose-h3:mb-4 prose-p:text-[#4a3f35] prose-li:text-[#4a3f35]">
                            {consultation.synthese ? (
                                <ReactMarkdown>{consultation.synthese}</ReactMarkdown>
                            ) : (
                                <p className="italic text-slate-400">Le bilan n'a pas pu être généré ou est en cours...</p>
                            )}
                        </div>

                        {/* Retranscription brute (Optionnelle) */}
                        {includeTranscript && consultation.transcription && (
                            <div className="mt-12 pt-8 border-t-2 border-dashed border-slate-200">
                                <h3 className="text-lg font-bold text-slate-400 mb-4 bg-slate-50 p-2 rounded inline-block">
                                    Retranscription littérale (Brouillon)
                                </h3>
                                <p className="text-[11px] leading-relaxed text-slate-500 font-normal whitespace-pre-wrap">
                                    {consultation.transcription}
                                </p>
                            </div>
                        )}

                        {/* Note de bas de page PDF */}
                        <div className="mt-16 pt-4 border-t border-slate-100 text-[10px] text-slate-400 text-center pb-8">
                            Centre Via Sana - 28 Bis Boulevard Sébastopol, 75004 Paris | Document généré le {format(new Date(), "dd/MM/yyyy")}
                        </div>

                    </div>
                </div>

            </div>
        </main>
    );
}
