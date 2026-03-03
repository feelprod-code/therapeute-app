"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AudioRecorder } from "@/components/AudioRecorder";
import { db, Consultation } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, ArrowRight, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Home() {
  const { toast } = useToast();
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

      if (!analyzeRes.ok) throw new Error("Erreur pendant l'analyse Gemini");
      const analyzeData = await analyzeRes.json();

      // Mettre à jour avec le compte-rendu brut et la synthèse (Gemini renvoie un texte structuré)
      await db.consultations.update(newConsultationId, {
        patientName: analyzeData.patientName && analyzeData.patientName.trim() !== "" ? analyzeData.patientName : "Patient Anonyme",
        synthese: analyzeData.synthese,
        transcription: "Analyse multimodale unique (cf. Synthese)",
        isProcessing: false,
      });

      toast({
        title: "Bilan terminé",
        description: "Le bilan a été généré avec succès.",
      });

    } catch (error: any) {
      console.error(error);
      await db.consultations.update(newConsultationId, {
        isProcessing: false,
      });
      toast({
        title: "Erreur",
        description: "Une erreur est survenue lors du traitement audio.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    if (confirm("Supprimer ce bilan définitivement ?")) {
      await db.consultations.delete(id);
      toast({
        title: "Bilan supprimé",
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
      <Card key={consult.id} className="hover:shadow-md transition-shadow relative overflow-hidden group flex flex-col justify-between border-[#bd613c]/20">
        {consult.isProcessing && (
          <div className="absolute top-0 left-0 w-full h-1 bg-[#e25822] animate-pulse" />
        )}
        <CardHeader className="pb-3 flex-1 relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => consult.id && handleDelete(e, consult.id)}
            title="Supprimer"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <div className="flex flex-col gap-1 pr-6">
            <CardTitle className="text-lg font-bebas tracking-wide text-[#bd613c] uppercase">
              {consult.patientName || `Patient #${consult.id}`}
            </CardTitle>
            <CardDescription className="text-[#4a3f35]/70">
              {format(new Date(consult.date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="mt-auto">
          {consult.isProcessing ? (
            <div className="flex items-center gap-2 text-sm text-[#e25822]">
              <Loader2 className="w-4 h-4 animate-spin" />
              Traitement IA en cours...
            </div>
          ) : (
            <Button asChild variant="ghost" className="w-full justify-between bg-[#ebd9c8]/30 hover:bg-[#ebd9c8]/70 text-[#4a3f35] hover:text-[#bd613c]" size="sm">
              <Link href={`/consultation/${consult.id}`}>
                Voir le bilan
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <main className="min-h-screen py-8 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto space-y-12">

        {/* En-tête de l'application (Identité TDT) */}
        <div className="text-center mt-8 mb-12">
          <h1 className="font-bebas text-6xl md:text-7xl text-[#bd613c] tracking-widest uppercase leading-none mb-2">
            Techniques Douces
          </h1>
          <div className="flex items-center justify-center gap-6 font-bebas text-5xl md:text-6xl text-[#bd613c] tracking-widest uppercase leading-none">
            <span className="h-[3px] w-12 md:w-20 bg-[#bd613c]"></span>
            Tissulaires
            <span className="h-[3px] w-12 md:w-20 bg-[#bd613c]"></span>
          </div>
          <p className="mt-8 text-xl md:text-2xl tracking-[0.2em] text-[#4a3f35] uppercase font-light">
            Consultation Bilan
          </p>
        </div>

        {/* Composant principal d'enregistrement */}
        <AudioRecorder onRecordingComplete={handleRecordingComplete} />

        {/* Historique des consultations */}
        <div className="space-y-6 pt-8">
          <h2 className="text-2xl font-bold text-slate-800 border-b pb-2">
            Historique des bilans
          </h2>

          <Tabs defaultValue="date" className="w-full">
            <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center border-b border-[#bd613c]/20 pb-4">
              <h2 className="text-2xl font-bold font-inter">
                Historique des bilans
              </h2>
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

              <TabsContent value="date" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 focus-visible:outline-none">
                {sortByDate?.map((consult) => (
                  <ConsultationCard key={consult.id} consult={consult} />
                ))}
              </TabsContent>

              <TabsContent value="name" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 focus-visible:outline-none">
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
