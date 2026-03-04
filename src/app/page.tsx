"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AudioRecorder } from "@/components/AudioRecorder";
import BilingualRecorder from '@/components/BilingualRecorder';
import { db, Consultation } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Trash2 } from "lucide-react";
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
import { useState } from "react";

export default function Home() {
  const { toast } = useToast();
  const [recorderMode, setRecorderMode] = useState('standard');
  // On récupère les consultations triées par date (la plus récente d'abord)
  const consultations = useLiveQuery(() => db.consultations.orderBy("createdAt").reverse().toArray());

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
        transcription: "Analyse multimodale unique (cf. Synthese)",
        isProcessing: false,
      });

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
              </div>
            ) : (
              <Button asChild variant="ghost" className="bg-[#ebd9c8]/30 hover:bg-[#ebd9c8]/70 text-[#4a3f35] hover:text-[#bd613c] h-9 px-3" size="sm">
                <Link href={`/consultation/${consult.id}`}>
                  Voir
                  <ArrowRight className="hidden sm:inline-block w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
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

        {/* Composant principal d'enregistrement */}
        {/* <AudioRecorder onRecordingComplete={handleRecordingComplete} /> */} {/* Original */}
        {/* Sélection du Mode d'Enregistrement */} {/* Added */}
        <Tabs value={recorderMode} onValueChange={setRecorderMode} className="w-full"> {/* Added */}
          <TabsList className="grid w-full grid-cols-2 mb-6"> {/* Added */}
            <TabsTrigger value="standard">Mode Standard</TabsTrigger> {/* Added */}
            <TabsTrigger value="bilingual">Mode Bilingue (Interprète)</TabsTrigger> {/* Added */}
          </TabsList>

          <TabsContent value="standard"> {/* Added */}
            <AudioRecorder onRecordingComplete={handleRecordingComplete} /> {/* Added */}
          </TabsContent>

          <TabsContent value="bilingual"> {/* Added */}
            <BilingualRecorder onRecordingComplete={handleBilingualComplete} /> {/* Added */}
          </TabsContent>
        </Tabs> {/* Added */}

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
