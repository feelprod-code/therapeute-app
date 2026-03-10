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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ConsultationPage() {
    const params = useParams();
    const router = useRouter();
    const { toast } = useToast();
    const [consultation, setConsultation] = useState<Consultation | null>(null);
    const [viewMode, setViewMode] = useState<"bilan" | "resume" | "transcript">("bilan");

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
        let textToCopy = "";

        switch (viewMode) {
            case "resume":
                textToCopy = consultation?.resume || "";
                break;
            case "transcript":
                textToCopy = consultation?.transcription || "";
                break;
            case "bilan":
            default:
                textToCopy = consultation?.synthese || "";
                break;
        }

        if (textToCopy) {
            await navigator.clipboard.writeText(textToCopy);
            toast({
                title: "Texte copié",
                description: "Le texte a été copié dans le presse-papiers.",
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

    const handleExportArchive = async () => {
        if (!consultation || !consultation.audioBlob || !targetRef.current) return;

        try {
            toast({
                title: "Création de l'archive...",
                description: "Le téléchargement va commencer (Audio + Bilan)",
            });

            // 1. Charger JSZip dynamiquement pour éviter les soucis de SSR
            const JSZip = (await import('jszip')).default;
            const { saveAs } = (await import('file-saver')).default;

            const zip = new JSZip();
            const dateStr = format(new Date(consultation.date), "dd-MM-yyyy");
            const folderName = `Bilan_TDT_${consultation.patientName?.replace(/\s+/g, '_') || 'Anonyme'}_${dateStr}`;

            // 2. Ajouter l'audio original
            // On sauvegarde en .webm (le format de capture natif Safari/Chrome pour l'espace). S'il y a un type spécifique, on l'utilise.
            const audioExt = consultation.audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
            zip.file(`${folderName}/audio_consultation.${audioExt}`, consultation.audioBlob);

            // 3. Ajouter les notes textuelles Markdown
            let textContent = `# Bilan : ${consultation.patientName || 'Anonyme'}\nDate: ${dateStr}\n\n`;
            textContent += `## Résumé Narrative\n${consultation.resume || 'Non généré'}\n\n`;
            textContent += `## Synthèse Structurée\n${consultation.synthese || 'Non généré'}\n\n`;
            textContent += `## Transcription Brute\n${consultation.transcription || 'Non généré'}`;
            zip.file(`${folderName}/notes_cliniques.md`, textContent);

            // 4. Générer le PDF (on force le mode bilan le temps de la capture)
            if (viewMode !== 'bilan') {
                setViewMode('bilan');
                // Petit délai pour laisser React faire le rendu du Dom
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const html2pdf = (await import('html2pdf.js')).default;
            const element = targetRef.current;
            const opt = {
                margin: 0,
                filename: `${folderName}/TDT_${viewMode}.pdf`,
                image: { type: 'jpeg' as const, quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const }
            };

            // html2pdf peut sortit un Blob directement via `output`
            const pdfBlob = await html2pdf().from(element).set(opt).output('blob');
            zip.file(`${folderName}/TDT_${viewMode}.pdf`, pdfBlob);

            // 5. Mettre tout en paquet et télécharger
            const zipBlob = await zip.generateAsync({ type: "blob" });
            saveAs(zipBlob, `${folderName}.zip`);

            toast({
                title: "Archive téléchargée !",
                description: "Vérifiez votre dossier de téléchargements.",
            });

        } catch (err) {
            console.error(err);
            toast({
                title: "Erreur",
                description: "Impossible de créer l'archive.",
                variant: 'destructive'
            });
        }
    };

    if (!consultation) {
        return <div className="p-8 text-center font-inter">Chargement...</div>;
    }

    return (
        <main className="min-h-screen py-8 px-4 sm:px-6">
            <div className="max-w-4xl mx-auto space-y-6 mt-12 mb-12">

                {/* Navigation et Actions (Export/Vue) */}
                <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4">

                    <div className="flex flex-wrap items-center gap-4">
                        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "bilan" | "resume" | "transcript")} className="w-[300px]">
                            <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="bilan">Bilan</TabsTrigger>
                                <TabsTrigger value="resume">Résumé</TabsTrigger>
                                <TabsTrigger value="transcript">Brut</TabsTrigger>
                            </TabsList>
                        </Tabs>

                        {consultation.audioBlob && (
                            <Button
                                variant="outline"
                                className="gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                                onClick={() => {
                                    const url = URL.createObjectURL(consultation.audioBlob!);
                                    const a = document.createElement('a');
                                    a.style.display = 'none';
                                    a.href = url;
                                    a.download = `audio_${consultation.patientName?.replace(/\s+/g, '_') || 'brut'}.webm`;
                                    document.body.appendChild(a);
                                    a.click();
                                    window.URL.revokeObjectURL(url);
                                }}
                            >
                                <Download className="w-4 h-4" />
                                Audio Brut
                            </Button>
                        )}

                        <Button variant="secondary" onClick={handleCopyText} className="gap-2">
                            <Copy className="w-4 h-4" />
                            Copier
                        </Button>
                        <Button onClick={handleExportPDF} className="gap-2 bg-[#bd613c] hover:bg-[#a05232]">
                            <Download className="w-4 h-4" />
                            PDF
                        </Button>
                        <Button variant="outline" onClick={handleExportArchive} className="gap-2 border-[#bd613c] text-[#bd613c] hover:bg-[#bd613c] hover:text-white transition-colors" title="Télécharger l&apos;Audio + PDF + Texte">
                            💾 Archiver
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} className="gap-2">
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* Lecteur Audio */}
                {consultation.audioBlob && (
                    <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200 w-full md:max-w-3xl mx-auto flex flex-col gap-2">
                        <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-widest">Enregistrement</h4>
                        <audio
                            controls
                            className="w-full h-10 outline-none"
                            src={URL.createObjectURL(consultation.audioBlob)}
                        >
                            Votre navigateur ne supporte pas l&apos;élément audio.
                        </audio>
                    </div>
                )}

                {/* Cible pour le PDF */}
                <div className="bg-white mx-auto shadow-sm border border-slate-200 max-w-full overflow-hidden md:overflow-visible w-full md:max-w-3xl min-h-[50vh]">
                    <div ref={targetRef} className="p-6 md:p-12 text-[#4a3f35] font-inter">

                        {/* En-tête TDT pour le PDF */}
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b-[3px] border-[#bd613c] pb-6 mb-8 mt-4 gap-4">
                            <div>
                                <h1 className="font-bebas text-2xl sm:text-3xl md:text-4xl text-[#bd613c] tracking-widest uppercase leading-none">
                                    Techniques Douces
                                </h1>
                                <div className="flex items-center gap-2 mt-1 mb-2">
                                    <span className="h-[2px] w-4 sm:w-6 bg-[#bd613c]"></span>
                                    <h2 className="font-bebas text-xl sm:text-2xl md:text-3xl text-[#bd613c] tracking-widest uppercase leading-none">
                                        Tissulaires
                                    </h2>
                                    <span className="h-[2px] w-4 sm:w-6 bg-[#bd613c]"></span>
                                </div>
                                <p className="text-xs sm:text-sm font-semibold tracking-wider text-slate-500 uppercase mt-2">
                                    Guillaume Philippe<br />
                                    <span className="text-[10px] sm:text-xs font-normal">Kinésithérapeute</span>
                                </p>
                            </div>
                            <div className="self-start sm:text-right mt-2 sm:mt-0">
                                <p className="text-lg sm:text-xl font-bold">Bilan de Consultation</p>
                                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                                    {format(new Date(consultation.date), "EEEE d MMMM yyyy", { locale: fr })}
                                </p>
                            </div>
                        </div>

                        {/* Contenu dynamique en fonction du choix utilisateur */}
                        {viewMode === "resume" && (
                            <div className="text-[#4a3f35] leading-relaxed text-lg whitespace-pre-wrap font-inter">
                                {consultation.resume ? consultation.resume : <span className="italic text-slate-400">Aucun résumé généré.</span>}
                            </div>
                        )}

                        {viewMode === "bilan" && (
                            <div className="prose max-w-none prose-headings:text-[#1a2f4c] prose-h3:text-xl prose-h3:font-bold prose-h3:border-b prose-h3:pb-2 prose-h3:mb-4 prose-p:text-[#4a3f35] prose-li:text-[#4a3f35]">
                                {consultation.synthese ? (
                                    <ReactMarkdown>{consultation.synthese}</ReactMarkdown>
                                ) : (
                                    <p className="italic text-slate-400">Le bilan n&apos;a pas pu être généré ou est en cours...</p>
                                )}
                            </div>
                        )}

                        {viewMode === "transcript" && (
                            <div className="text-[#4a3f35] whitespace-pre-wrap font-mono text-sm leading-relaxed p-4 bg-slate-50 border border-slate-200 rounded-md">
                                {consultation.transcription ? consultation.transcription : <span className="italic text-slate-400">Aucune retranscription disponible.</span>}
                            </div>
                        )}

                        {/* Note de bas de page PDF */}
                        <div className="mt-16 pt-4 border-t border-slate-100 text-[10px] text-slate-400 text-center pb-8">
                            Centre Via Sana - 28 Bis Boulevard Sébastopol, 75004 Paris | Document généré le {format(new Date(), "dd/MM/yyyy")}
                        </div>

                    </div>
                </div>

                {/* Bouton retour en bas (Esthétique Marron TDT) */}
                <div className="flex justify-center mt-8 pb-8">
                    <Button onClick={() => router.push("/")} className="gap-2 bg-[#bd613c] hover:bg-[#a05232] text-white px-8 py-6 text-lg rounded-full shadow-md transition-all hover:scale-105 active:scale-95">
                        <ArrowLeft className="w-5 h-5" />
                        Retour à l&apos;accueil
                    </Button>
                </div>

            </div>
        </main>
    );
}
