"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AudioRecorder } from "@/components/AudioRecorder";
import BilingualRecorder from '@/components/BilingualRecorder';
import { db, Consultation } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Trash2, Paperclip, X, FileText, Image as ImageIcon, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState, useRef } from "react";

export default function Home() {
  const { toast } = useToast();
  const [recorderMode, setRecorderMode] = useState('standard');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // On récupère les consultations triées par date (la plus récente d'abord)
  const consultations = useLiveQuery(() => db.consultations.orderBy("createdAt").reverse().toArray());

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleRecordingComplete = async (audioBlob: Blob) => {
    // 1. Créer une nouvelle entrée dans IndexedDB
    const newConsultationId = await db.consultations.add({
      date: new Date(),
      audioBlob,
      isProcessing: true,
      createdAt: new Date(),
    });

    try {
      // Analyse globale avec Gemini (Transcription + Synthèse structurée)
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      attachedFiles.forEach(file => formData.append("files", file));

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!analyzeRes.ok) {
        const errText = await analyzeRes.text();
        throw new Error(`Erreur API (${analyzeRes.status}): ${errText}`);
      }

      const analyzeData = await analyzeRes.json();

      // Mettre à jour avec le compte-rendu brut et la synthèse (Gemini renvoie un texte structuré)
      await db.consultations.update(newConsultationId, {
        patientName: analyzeData.patientName && analyzeData.patientName.trim() !== "" ? analyzeData.patientName : "Patient Anonyme",
        resume: analyzeData.resume || "",
        synthese: analyzeData.synthese,
        transcription: "Analyse multimodale unique (cf. Synthese).",
        isProcessing: false,
      });

      setAttachedFiles([]); // On vide les fichiers après succès

      toast({
        title: "Bilan terminé",
        description: "Le bilan a été généré avec succès.",
      });

    } catch (error: unknown) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : "Une erreur est survenue lors du traitement audio.";

      await db.consultations.update(newConsultationId, {
        isProcessing: false,
      });
      toast({
        title: "Erreur Génération",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleBilingualComplete = async (audioBlob: Blob, result: Record<string, string>) => {
    const defaultName = result.patientName && result.patientName.trim() !== "" ? result.patientName : "Patient(e) Anglophone";

    // On passe un Blob vide car l'audio est découpé dans l'historique
    await db.consultations.add({
      date: new Date(),
      patientName: defaultName,
      audioBlob: audioBlob,
      synthese: result.synthese,
      transcription: result.transcription,
      resume: result.resume,
      isProcessing: false,
      createdAt: new Date(),
    });

    setAttachedFiles([]); // On vide les fichiers après succès

    toast({
      title: "Bilan terminé",
      description: "Le bilan bilingue a été généré avec succès.",
    });
  };

  const handleDelete = async (id: number) => {
    await db.consultations.delete(id);
    toast({
      title: "Bilan supprimé",
    });
  };

  const recoverStuckConsultation = async (id: number) => {
    await db.consultations.update(id, { isProcessing: false });
    toast({
      title: "Statut réinitialisé",
      description: "Vous pouvez retenter l'analyse ou télécharger l'audio brut.",
    });
  };

  const downloadRawAudio = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `audio_${name.replace(/\s+/g, '_')}_brut.webm`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const retryAnalysis = async (consult: Consultation) => {
    if (!consult.id || !consult.audioBlob) return;

    await db.consultations.update(consult.id, { isProcessing: true });

    try {
      const formData = new FormData();
      formData.append("audio", consult.audioBlob, "recording.webm");

      toast({
        title: "Analyse relancée...",
        description: "Traitement de l'audio en cours. Ne quittez pas la page.",
      });

      // Timeout manual of 120 seconds to prevent silent local hangs
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!analyzeRes.ok) {
        const errText = await analyzeRes.text();
        throw new Error(`Erreur API (${analyzeRes.status}): ${errText}`);
      }

      const analyzeData = await analyzeRes.json();

      await db.consultations.update(consult.id, {
        patientName: analyzeData.patientName || consult.patientName,
        resume: analyzeData.resume || "",
        synthese: analyzeData.synthese,
        transcription: "Analyse re-tentée (locale)",
        isProcessing: false,
      });

      toast({
        title: "Bilan récupéré !",
        description: "La consultation a été traitée avec succès.",
      });

    } catch (error: unknown) {
      console.error(error);
      let errorMessage = "Erreur inattendue.";
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = "Temps d'attente dépassé (2 min). Le fichier est peut-être trop gros ou Gemini surchargé.";
        } else {
          errorMessage = error.message;
        }
      }

      await db.consultations.update(consult.id, { isProcessing: false });
      toast({
        title: "Échec de l'analyse",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const sortByDate = [...(consultations || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const sortByName = [...(consultations || [])].sort((a, b) => {
    const nameA = a.patientName || `Patient #${a.id}`;
    const nameB = b.patientName || `Patient #${b.id}`;
    return nameA.localeCompare(nameB);
  });

  const ConsultationCard = ({ consult }: { consult: Consultation }) => {
    if (!consult) return null;
    return (
      <Card key={consult.id} className="hover:shadow-md transition-shadow relative overflow-hidden group border-[#bd613c]/20">
        {consult.isProcessing && (
          <div className="absolute top-0 left-0 w-full h-1 bg-[#e25822] animate-pulse" />
        )}
        <div className="flex flex-row items-center justify-between p-4 gap-4">
          <div className="flex-1 min-w-0 pr-2">
            <h3 className="text-lg font-bebas tracking-wide text-[#bd613c] uppercase mb-1 truncate">
              {consult.patientName || `Patient #${consult.id}`}
            </h3>
            <p className="text-xs sm:text-sm text-[#4a3f35]/70 truncate">
              {format(new Date(consult.date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
            </p>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {consult.isProcessing ? (
              <div className="flex items-center gap-2 text-sm text-[#e25822]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Traitement...</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs ml-2 text-red-500 border-red-200 hover:bg-red-50"
                  onClick={() => consult.id && recoverStuckConsultation(consult.id)}
                >
                  Débloquer
                </Button>
              </div>
            ) : (
              <>
                {!consult.synthese && consult.audioBlob && (
                  <>
                    <Button
                      variant="outline"
                      className="text-xs h-9"
                      onClick={() => retryAnalysis(consult)}
                    >
                      Relancer l&apos;IA
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-xs h-9 text-blue-600 hover:bg-blue-50"
                      onClick={() => consult.audioBlob && downloadRawAudio(consult.audioBlob, consult.patientName || 'Patient')}
                      title="Télécharger l'audio brut"
                    >
                      Sauver Audio
                    </Button>
                  </>
                )}
                {consult.synthese && (
                  <Button asChild variant="ghost" className="bg-[#ebd9c8]/30 hover:bg-[#ebd9c8]/70 text-[#4a3f35] hover:text-[#bd613c] h-9 px-3" size="sm">
                    <Link href={`/consultation/${consult.id}`}>
                      Voir
                      <ArrowRight className="hidden sm:inline-block w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                    </Link>
                  </Button>
                )}
              </>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-400 hover:text-red-500 hover:bg-red-50 h-9 w-9"
                  title="Supprimer"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="w-[90vw] rounded-xl sm:w-[400px]">
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer ce bilan ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cette action est irréversible. Toutes les données seront supprimées définitivement de votre appareil.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={() => consult.id && handleDelete(consult.id)} className="bg-red-500 text-white hover:bg-red-600 border-0 focus:ring-red-500">
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <main className="min-h-screen py-4 sm:py-8 px-4 sm:px-6 mb-12">
      <div className="max-w-5xl mx-auto space-y-8 sm:space-y-12">

        {/* En-tête de l'application (Identité TDT) */}
        <div className="text-center mt-2 sm:mt-4 mb-8 sm:mb-10">
          <h1 className="font-bebas text-3xl sm:text-5xl md:text-6xl text-[#bd613c] tracking-wide uppercase leading-none mb-1 text-balance">
            Techniques Douces Tissulaires
          </h1>
          <p className="mt-2 text-lg sm:text-xl md:text-2xl tracking-[0.2em] text-[#4a3f35] uppercase font-light">
            Consultation Bilan
          </p>
        </div>

        {/* Upload de documents locaux (IRM, Radio, etc.) */}
        <div
          className="bg-white/60 p-4 rounded-xl border border-[#bd613c]/20 shadow-sm mb-6 max-w-2xl mx-auto flex flex-col gap-3 transition-colors duration-200"
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('bg-[#ebd9c8]/20', 'border-[#bd613c]');
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('bg-[#ebd9c8]/20', 'border-[#bd613c]');
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('bg-[#ebd9c8]/20', 'border-[#bd613c]');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              setAttachedFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
            }
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[#4a3f35] font-semibold text-sm flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-[#bd613c]" />
              Ajouter des documents au bilan
            </h3>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
              Parcourir...
            </Button>
            <input
              type="file"
              className="hidden"
              multiple
              onChange={handleFileChange}
              ref={fileInputRef}
              accept=".pdf,image/*"
            />
          </div>
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {attachedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 bg-[#ebd9c8]/40 border border-[#bd613c]/30 rounded-full px-3 py-1.5 text-xs text-[#4a3f35] max-w-full">
                  {f.type.includes('pdf') ? <FileText className="w-3 h-3 text-red-500 shrink-0" /> : <ImageIcon className="w-3 h-3 text-blue-500 shrink-0" />}
                  <span className="truncate max-w-[150px]">{f.name}</span>
                  <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 ml-1 shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-500 leading-tight">
            Les documents importés seront analysés conjointement avec la transcription audio afin de générer un compte-rendu enrichi (ex: inclure les résultats de l&apos;IRM ou de la radio). Vous pouvez déposer vos fichiers ici.
          </p>
        </div>

        {/* Sélection du Mode d'Enregistrement */}
        <Tabs value={recorderMode} onValueChange={setRecorderMode} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="standard" className="text-xs sm:text-sm">Mode Standard</TabsTrigger>
            <TabsTrigger value="bilingual" className="text-xs sm:text-sm">Mode Bilingue</TabsTrigger>
            <TabsTrigger value="import" className="text-xs sm:text-sm">Importer Audio</TabsTrigger>
          </TabsList>

          <TabsContent value="standard">
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
          </TabsContent>

          <TabsContent value="bilingual">
            <BilingualRecorder onRecordingComplete={handleBilingualComplete} attachedFiles={attachedFiles} />
          </TabsContent>

          <TabsContent value="import">
            <Card className="border-[#bd613c]/30 shadow-none bg-white/50">
              <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center">
                <div className="w-16 h-16 bg-[#ebd9c8]/50 rounded-full flex items-center justify-center mb-4 text-[#bd613c]">
                  <Download className="w-8 h-8" />
                </div>
                <h3 className="font-bebas text-2xl tracking-widest text-[#bd613c] mb-2 uppercase">
                  Importer un vieil Enregistrement
                </h3>
                <p className="text-slate-500 mb-6 max-w-md mx-auto">
                  Si un enregistrement a échoué sur mobile, récupérez-le et importez le fichier audio brut (.webm, .mp3, .m4a) ici pour lancer l&apos;analyse manuellement.
                </p>
                <Button
                  onClick={() => {
                    const el = document.getElementById('audio-import') as HTMLInputElement;
                    if (el) el.click();
                  }}
                  className="bg-[#bd613c] hover:bg-[#a05232] text-white px-8 py-6 rounded-full text-lg shadow-md transition-transform hover:scale-105"
                >
                  <Paperclip className="w-5 h-5 mr-2" />
                  Sélectionner l&apos;Audio
                </Button>
                <input
                  id="audio-import"
                  type="file"
                  accept="audio/*,video/mp4,video/webm"
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      toast({
                        title: "Importation...",
                        description: "L'audio va être analysé. Patientez...",
                      });
                      handleRecordingComplete(files[0]);
                    }
                  }}
                />
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Historique des consultations */}
        <div className="space-y-6 pt-8">

          <Tabs defaultValue="date" className="w-full">
            <div className="flex justify-start sm:justify-end border-[#bd613c]/20 pb-4">
              <TabsList className="bg-[#ebd9c8] text-[#4a3f35] p-1">
                <TabsTrigger value="date" className="data-[state=active]:bg-[#bd613c] data-[state=active]:text-white">Par date</TabsTrigger>
                <TabsTrigger value="name" className="data-[state=active]:bg-[#bd613c] data-[state=active]:text-white">Par nom</TabsTrigger>
              </TabsList>
            </div>

            <div className="mt-6">
              {!consultations && (
                <div className="col-span-full flex justify-center py-10 text-[#bd613c]">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              )}

              {consultations?.length === 0 && (
                <div className="col-span-full text-center py-12 bg-white rounded-xl border border-dashed border-[#bd613c]/30">
                  <p className="text-slate-500">Aucun bilan pour le moment.</p>
                  <p className="text-sm text-slate-400 mt-1">
                    Démarrez un enregistrement pour créer votre premier dossier.
                  </p>
                </div>
              )}

              <TabsContent value="date" className="flex flex-col gap-3 focus-visible:outline-none">
                {sortByDate?.map((consult) => (
                  <ConsultationCard key={consult.id} consult={consult} />
                ))}
              </TabsContent>

              <TabsContent value="name" className="flex flex-col gap-3 focus-visible:outline-none">
                {sortByName?.map((consult) => (
                  <ConsultationCard key={consult.id} consult={consult} />
                ))}
              </TabsContent>
            </div>
          </Tabs>
        </div>

      </div>
    </main>
  );
}

