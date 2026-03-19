"use client";

import { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AudioRecorder } from "@/components/AudioRecorder";
import BilingualRecorder from '@/components/BilingualRecorder';
import { compressAudio } from '@/lib/compress-audio';
import { supabase, SupabaseConsultation } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Trash2, Paperclip, X, FileText, Image as ImageIcon, Download, Folder as FolderIcon, ChevronDown, Mic, Combine, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import ProtectedRoute from "@/components/ProtectedRoute";

export default function HomeWrapper() {
  return (
    <ProtectedRoute>
      <Home />
    </ProtectedRoute>
  );
}

function Folder({ title, defaultOpen = false, children }: { title: React.ReactNode, defaultOpen?: boolean, children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group mb-4 bg-white/50 border border-[#bd613c]/20 rounded-xl overflow-hidden [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer px-4 py-3 font-bebas text-xl text-[#bd613c] flex items-center justify-between hover:bg-[#ebd9c8]/30 transition-colors list-none">
        <div className="flex items-center gap-2">
          <FolderIcon className="w-5 h-5" />
          {title}
        </div>
        <ChevronDown className="w-5 h-5 transition-transform group-open:-rotate-180" />
      </summary>
      <div className="p-4 bg-white/30 border-t border-[#bd613c]/10">
        {children}
      </div>
    </details>
  );
}

function Home() {
  const { toast } = useToast();
  const [recorderMode, setRecorderMode] = useState('standard');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [activeProcessingIds, setActiveProcessingIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [consultations, setConsultations] = useState<SupabaseConsultation[] | null>(null);

  useEffect(() => {
    const fetchConsultations = async () => {
      const { data, error } = await supabase
        .from('consultations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error("Supabase fetch error:", error);
        // On évite le chargement infini si RLS bloque l'accès
        setConsultations([]);
        return;
      }

      if (data) {
        // Formater les données pour correspondre à l'ancien format local attendu
        const formatted = data.map(d => ({
          id: d.id,
          date: new Date(d.date),
          patientName: d.patient_name,
          resume: d.resume,
          synthese: d.synthese,
          transcription: d.transcription,
          audioPath: d.audio_path,
          isProcessing: false, // Override dynamically in ConsultationCard
          createdAt: new Date(d.created_at)
        }));
        setConsultations(formatted);
      }
    };

    fetchConsultations();

    const subscription = supabase
      .channel('public:consultations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultations' }, () => {
        fetchConsultations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleRecordingComplete = async (inputBlob: Blob | File) => {
    let newConsultationId: string | undefined = undefined;

    try {
      console.log("Début du traitement audio. Taille:", inputBlob.size);

      // On s'assure que c'est un pur Blob (Safari peut planter si on essaie de stocker un objet `File` direct dans IndexedDB)
      const buffer = await inputBlob.arrayBuffer();
      const audioBlob = new Blob([buffer], { type: inputBlob.type });

      const { data: { user } } = await supabase.auth.getUser();

      // 1. CREATION DE LA consultation dans la DB (elle apparaîtra en temps réel grâce au websocket)
      toast({ title: "⏳ Étape 1/3", description: "Création du dossier patient..." });
      const { data: newConsultation, error: insertError } = await supabase.from('consultations').insert({
        user_id: user?.id || "00000000-0000-0000-0000-000000000000",
        date: new Date().toISOString(),
        patient_name: "Patient Anonyme", // Temporaire
        synthese: "",
        transcription: "",
        resume: "",
        created_at: new Date().toISOString(),
      }).select().single();

      if (insertError || !newConsultation) throw new Error("Impossible de créer l'entrée en base " + insertError?.message);
      newConsultationId = newConsultation.id;

      setActiveProcessingIds(prev => [...prev, newConsultation.id]);

      // --- 2. UPLOAD VERS SUPABASE STORAGE POUR CONTOURNER LA LIMITE VERCEL (4.5 MO) ---
      toast({ title: "⏳ Étape 2/3", description: `Upload fichier audio (${(audioBlob.size / 1024 / 1024).toFixed(2)} MB)...` });
      console.log("Upload audio vers Supabase Storage...");
      let extension = "webm";
      if (inputBlob instanceof File && inputBlob.name) {
        extension = inputBlob.name.split('.').pop() || "webm";
      } else if (inputBlob.type) {
        extension = inputBlob.type.split('/')[1]?.split(';')[0] || "webm";
      }
      const audioFileName = `audio_${Date.now()}_${newConsultationId}.${extension}`;
      const { error: audioUploadError } = await supabase.storage
        .from('tdt_uploads')
        .upload(audioFileName, audioBlob, { contentType: audioBlob.type });

      if (audioUploadError) {
        throw new Error("Erreur lors de l'upload audio : " + audioUploadError.message);
      }

      await supabase.from('consultations').update({ audio_path: audioFileName }).eq('id', newConsultationId);

      console.log("Upload des fichiers attachés...");
      const uploadedAttachedFiles = [];
      for (const file of attachedFiles) {
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const fileName = `doc_${Date.now()}_${newConsultationId}_${safeName}`;
        const { error: fileError } = await supabase.storage
          .from('tdt_uploads')
          .upload(fileName, file, { contentType: file.type });

        if (fileError) {
          console.error("Erreur upload fichier", file.name, fileError);
          // On continue, on ne bloque pas tout pour un fichier
        } else {
          uploadedAttachedFiles.push({ fileName, mimeType: file.type });
        }
      }

      // --- 3. ANALYSE GLOBALE AVEC GEMINI ---
      toast({ title: "⏳ Étape 3/3", description: "Analyse IA Gemini (cela peut prendre 1 à 2 minutes)..." });
      console.log("Déclenchement de l'analyse sur /api/analyze...");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 900000); // 15 min

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioFile: { fileName: audioFileName, mimeType: audioBlob.type },
          attachedFiles: uploadedAttachedFiles
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!analyzeRes.ok) {
        const errText = await analyzeRes.text();
        throw new Error(`Erreur API (${analyzeRes.status}): ${errText}`);
      }

      console.log("Réponse de l'API reçue");
      const analyzeData = await analyzeRes.json();

      // Mettre à jour avec le compte-rendu brut et la synthèse (Gemini renvoie un texte structuré)
      await supabase.from('consultations').update({
        patient_name: analyzeData.patientName && analyzeData.patientName.trim() !== "" ? analyzeData.patientName : "Patient Anonyme",
        resume: analyzeData.resume || "",
        synthese: analyzeData.synthese,
        transcription: analyzeData.transcription || "",
      }).eq('id', newConsultationId);

      setActiveProcessingIds(prev => prev.filter(id => id !== newConsultationId));

      setAttachedFiles([]); // On vide les fichiers après succès

      // Cleanup: on supprime les fichiers lourds (audio, pdf, doc) pour économiser l'espace Supabase
      const filesToDelete = [audioFileName];
      if (uploadedAttachedFiles.length > 0) {
        filesToDelete.push(...uploadedAttachedFiles.filter(f => !f.mimeType.startsWith('image/')).map(f => f.fileName));
      }
      try {
        await supabase.storage.from('tdt_uploads').remove(filesToDelete);
        console.log("Fichiers temporaires supprimés de Supabase Storage:", filesToDelete);
      } catch (e) {
        console.error("Erreur suppression fichiers:", e);
      }

      toast({
        title: "Bilan terminé",
        description: "Le bilan a été généré avec succès.",
      });

    } catch (error: unknown) {
      console.error("Erreur gérée dans handleRecordingComplete:", error);
      const errorMessage = error instanceof Error ? error.message : "Une erreur est survenue lors du traitement audio.";

      if (newConsultationId !== undefined) {
        setActiveProcessingIds(prev => prev.filter(id => id !== newConsultationId));
        toast({ title: "Erreur détectée", description: errorMessage, variant: "destructive" });
      }

      toast({
        title: "Erreur Traitement",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleBilingualComplete = async (audioBlob: Blob, result: Record<string, string>) => {
    const defaultName = result.patientName && result.patientName.trim() !== "" ? result.patientName : "Patient(e) Anglophone";

    // On insère les données traduites directement
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('consultations').insert({
      user_id: user.id,
      date: new Date().toISOString(),
      patient_name: defaultName,
      synthese: result.synthese,
      transcription: result.transcription,
      resume: result.resume,
      created_at: new Date().toISOString(),
    });

    setAttachedFiles([]); // On vide les fichiers après succès

    toast({
      title: "Bilan terminé",
      description: "Le bilan bilingue a été généré avec succès.",
    });
  };

  const handleDelete = async (id: string) => {
    await supabase.from('consultations').delete().eq('id', id);
    toast({
      title: "Bilan supprimé",
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

  const handleExportAll = () => {
    if (!consultations || consultations.length === 0) {
      toast({
        title: "Export impossible",
        description: "Aucun bilan à exporter.",
        variant: "destructive"
      });
      return;
    }

    const dataStr = JSON.stringify(consultations, null, 2);
    const blob = new Blob([dataStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sauvegarde_bilans_${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Export réussi",
      description: "Toutes vos consultations ont été sauvegardées localement."
    });
  };

  const handleDownloadAudio = async (consult: SupabaseConsultation) => {
    if (consult.audioBlob) {
      downloadRawAudio(consult.audioBlob, consult.patientName || 'Patient');
      return;
    }

    try {
      toast({ title: "Recherche de l'audio...", description: "Recherche du fichier sur le cloud..." });

      const { data } = await supabase.from('consultations').select('audio_path').eq('id', consult.id).maybeSingle();

      let pathToDownload = data?.audio_path;

      if (!pathToDownload) {
        // Fallback: search the bucket
        const { data: listData, error: listError } = await supabase.storage.from('tdt_uploads').list('', { search: consult.id });
        if (listError || !listData || listData.length === 0) {
          throw new Error("Fichier introuvable sur le cloud.");
        }
        pathToDownload = listData[0].name;
      }

      if (!pathToDownload) throw new Error("Impossible de déterminer le chemin audio.");

      const { data: fileData, error: downloadError } = await supabase.storage.from('tdt_uploads').download(pathToDownload);

      if (downloadError || !fileData) {
        throw new Error("Erreur de téléchargement depuis Supabase.");
      }

      downloadRawAudio(fileData, consult.patientName || 'Patient');
      toast({ title: "Succès", description: "Audio récupéré avec succès." });
    } catch (err: unknown) {
      toast({
        title: "Échec de la récupération",
        description: err instanceof Error ? err.message : "Erreur inconnue",
        variant: "destructive",
      });
    }
  };

  const retryAnalysis = async (consult: SupabaseConsultation) => {
    if (!consult.id) return;

    setActiveProcessingIds(prev => [...prev, consult.id]);

    try {
      console.log("Tentative de relance de l'analyse pour la consultation:", consult.id);
      toast({ title: "Préparation de l'audio...", description: "Recherche du fichier cloud pour analyse..." });

      // Find the file path
      const { data } = await supabase.from('consultations').select('audio_path').eq('id', consult.id).maybeSingle();
      let pathToAnalyze = data?.audio_path;

      if (!pathToAnalyze) {
        // Fallback: search the bucket
        const { data: listData, error: listError } = await supabase.storage.from('tdt_uploads').list('', { search: consult.id });
        if (listError || !listData || listData.length === 0) {
          throw new Error("Impossible de relancer : fichier audio introuvable sur le cloud.");
        }
        pathToAnalyze = listData[0].name;
      }

      if (!pathToAnalyze) throw new Error("Nom de fichier introuvable.");

      // Now call /api/analyze with exactly what it expects
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 900000); // 15 min

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioFile: { fileName: pathToAnalyze, mimeType: "audio/webm" } // Let backend infer type or assume webm
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!analyzeRes.ok) {
        throw new Error("Erreur de l'API lors de l'analyse.");
      }

      const analyzeData = await analyzeRes.json();

      await supabase.from('consultations').update({
        patient_name: analyzeData.patientName && analyzeData.patientName.trim() !== "" ? analyzeData.patientName : "Patient Anonyme",
        resume: analyzeData.resume || "",
        synthese: analyzeData.synthese,
        transcription: analyzeData.transcription || "Transcription introuvable.",
      }).eq('id', consult.id);

      toast({
        title: "Bilan terminé",
        description: "L'IA a régénéré le bilan avec succès.",
      });

    } catch (error: unknown) {
      console.log(error);
      toast({
        title: "Échec de l'analyse",
        description: error instanceof Error ? error.message : "Erreur inattendue",
        variant: "destructive",
      });
    } finally {
      setActiveProcessingIds(prev => prev.filter(id => id !== consult.id));
    }
  };

  const sortByDate = [...(consultations || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const sortByName = [...(consultations || [])].sort((a, b) => {
    const nameA = a.patientName || `Patient #${a.id}`;
    const nameB = b.patientName || `Patient #${b.id}`;
    return nameA.localeCompare(nameB);
  });

  const ConsultationCard = ({ consult }: { consult: SupabaseConsultation }) => {
    const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
    const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
    const [isAppending, setIsAppending] = useState(false);

    if (!consult) return null;
    const isProcessing = activeProcessingIds.includes(consult.id) || isAppending;

    const handleMerge = async (targetConsultationId: string) => {
      setIsAppending(true);
      setIsMergeModalOpen(false);
      try {
        const targetConsult = consultations?.find(c => c.id === targetConsultationId);
        if (!targetConsult) throw new Error("Consultation cible introuvable");

        toast({ title: "Fusion en cours...", description: "L'IA fusionne intelligemment les deux dossiers. Cela peut prendre quelques instants." });

        const response = await fetch('/api/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetConsultation: {
              patientName: targetConsult.patientName || targetConsult.patient_name || "",
              transcription: targetConsult.transcription || "",
              synthese: targetConsult.synthese || ""
            },
            sourceConsultation: {
              transcription: consult.transcription || "",
              synthese: consult.synthese || ""
            }
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Erreur lors de la fusion IA.");
        }

        const result = await response.json();

        // 1. Mettre à jour la cible
        const { error: updateError } = await supabase.from('consultations').update({
          synthese: result.synthese,
          transcription: result.transcription,
          resume: result.resume,
          patient_name: result.patientName || targetConsult.patientName || targetConsult.patient_name
        }).eq('id', targetConsult.id);

        if (updateError) throw updateError;

        // 2. Supprimer la source
        const { error: deleteError } = await supabase.from('consultations').delete().eq('id', consult.id);

        if (deleteError) throw deleteError;

        toast({ title: "Fusion réussie", description: "Le bilan a été fusionné au dossier cible avec succès." });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error(err);
        toast({ title: "Erreur", description: err.message || "Impossible de fusionner.", variant: "destructive" });
      } finally {
        setIsAppending(false);
      }
    };

    const handleAppendRecording = async (audioBlob: Blob) => {
      setIsAppending(true);
      setIsRecordingModalOpen(false);
      try {
        const fileName = `audio_addendum_${Date.now()}_${consult.id}.webm`;
        const { error: uploadError } = await supabase.storage.from('tdt_uploads').upload(fileName, audioBlob, { contentType: audioBlob.type });

        if (uploadError) throw new Error("Erreur upload audio addendum");

        toast({ title: "Analyse en cours...", description: "Fusion des nouvelles informations avec le bilan existant." });

        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioFile: { fileName, mimeType: audioBlob.type },
            previousContext: {
              synthese: consult.synthese,
              transcription: consult.transcription,
              patientName: consult.patient_name || consult.patientName || ""
            }
          })
        });

        if (!response.ok) throw new Error("Erreur lors de la mise à jour par l'IA.");
        const result = await response.json();

        await supabase.from('consultations').update({
          synthese: result.synthese,
          transcription: result.transcription,
          resume: result.resume,
          patient_name: result.patientName || consult.patient_name
        }).eq('id', consult.id);

        toast({ title: "Bilan mis à jour", description: "L'enregistrement a bien été ajouté au dossier." });

      } catch (err) {
        console.error(err);
        toast({ title: "Erreur", description: "Impossible d'ajouter l'enregistrement.", variant: "destructive" });
      } finally {
        setIsAppending(false);
      }
    };

    return (
      <Card key={consult.id} className="hover:shadow-md transition-shadow relative overflow-hidden group border-[#bd613c]/20">
        {isProcessing && (
          <div className="absolute top-0 left-0 w-full h-1 bg-[#e25822] animate-pulse" />
        )}
        <div className="flex flex-row items-center justify-between p-4 sm:p-5 gap-2 sm:gap-4">
          <div className="flex-1 min-w-0 pr-2">
            <h3 className="text-lg sm:text-xl font-bebas tracking-wide text-[#bd613c] uppercase mb-1 truncate">
              {consult.patientName || `Patient #${consult.id}`}
            </h3>
            <p className="text-xs sm:text-sm text-[#4a3f35]/70 truncate">
              {format(new Date(consult.date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2 shrink-0">
            {isProcessing ? (
              <div className="flex items-center gap-2 text-sm text-[#e25822]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Traitement...</span>
              </div>
            ) : (
              <>
                {!consult.synthese && (
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
                      onClick={() => handleDownloadAudio(consult)}
                      title="Télécharger l'audio"
                    >
                      Récupérer Audio
                    </Button>
                  </>
                )}
                {consult.synthese && (
                  <div className="flex items-center gap-1 sm:gap-2">
                    <Dialog open={isRecordingModalOpen} onOpenChange={setIsRecordingModalOpen}>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[#bd613c] hover:bg-[#bd613c]/10 h-9 px-3"
                          disabled={isAppending}
                        >
                          <Mic className="w-4 h-4 sm:mr-1" />
                          <span className="hidden sm:inline">Ajouter Audio</span>
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-xl bg-white border-[#ebd9c8]/30">
                        <DialogHeader>
                          <DialogTitle className="font-bebas tracking-wide text-3xl text-[#bd613c] uppercase text-center mb-4">
                            Ajout Rapide d'Informations
                          </DialogTitle>
                        </DialogHeader>
                        <div className="py-2">
                          <AudioRecorder onRecordingComplete={handleAppendRecording} isProcessing={isAppending} />
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Button asChild variant="default" className="bg-[#bd613c]/90 hover:bg-[#bd613c] text-white h-9 px-3" size="sm">
                      <Link href={`/consultation/${consult.id}`}>
                        Voir
                        <ArrowRight className="hidden sm:inline-block w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                      </Link>
                    </Button>
                  </div>
                )}
              </>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-blue-500 hover:bg-blue-50 h-9 w-9"
              title="Régénérer le bilan par l'IA (Re-transcription)"
              onClick={() => retryAnalysis(consult)}
              disabled={isAppending || activeProcessingIds.includes(consult.id)}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>

            <Dialog open={isMergeModalOpen} onOpenChange={setIsMergeModalOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-400 hover:text-[#bd613c] hover:bg-[#ebd9c8]/20 h-9 w-9"
                  title="Fusionner vers un autre bilan"
                  disabled={isAppending}
                >
                  <Combine className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-xl bg-white border-[#ebd9c8]/30">
                <DialogHeader>
                  <DialogTitle className="font-bebas tracking-wide text-2xl text-[#bd613c] uppercase mb-2">
                    Fusionner le bilan
                  </DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <p className="text-sm text-[#4a3f35] mb-4">
                    Sélectionnez le dossier patient dans lequel vous souhaitez transférer ces informations. <strong className="text-red-600">Ce bilan-ci sera supprimé</strong> après la fusion.
                  </p>
                  <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2">
                    {consultations?.filter(c => c.id !== consult.id && c.synthese).length === 0 && (
                      <p className="text-sm text-slate-500 italic">Aucun autre bilan disponible pour la fusion.</p>
                    )}
                    {consultations?.filter(c => c.id !== consult.id && c.synthese).map(target => (
                      <Button
                        key={target.id}
                        variant="outline"
                        className="w-full justify-start text-left h-auto py-3 border-[#ebd9c8]/50 hover:bg-[#ebd9c8]/20"
                        onClick={() => handleMerge(target.id)}
                      >
                        <div className="flex flex-col items-start min-w-0">
                          <span className="font-medium text-[#bd613c] truncate w-full">
                            {target.patientName || `Patient #${target.id.slice(0, 4)}`}
                          </span>
                          <span className="text-xs text-slate-500">
                            {format(new Date(target.date), "dd/MM/yyyy 'à' HH:mm")}
                          </span>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

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
      <div className="max-w-7xl mx-auto space-y-8 sm:space-y-12">

        {/* En-tête de l'application (Identité TDT) */}
        <div className="text-center mt-2 sm:mt-4 mb-8 sm:mb-10">
          <h1 className="font-bebas text-3xl sm:text-5xl md:text-6xl text-[#bd613c] tracking-wide uppercase leading-none mb-1 text-balance">
            Techniques Douces Tissulaires
          </h1>
          <p className="mt-2 text-lg sm:text-xl md:text-2xl tracking-[0.2em] text-[#4a3f35] uppercase font-light">
            Consultation Bilan
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start w-full">
          <div className="lg:col-span-5 flex flex-col gap-6 lg:sticky lg:top-8">
            {/* Upload de documents locaux (IRM, Radio, etc.) */}
            {/* Upload de documents externes */}
            <div
              className="bg-white/40 p-2 sm:p-3 rounded-lg border border-[#bd613c]/10 shadow-sm mb-4 flex flex-row justify-between items-center gap-3 transition-colors duration-200 hover:border-[#bd613c]/30 w-full"
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
              <div className="flex-1 flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-[#bd613c]" />
                <span className="text-[#4a3f35] text-xs font-medium">Joindre documents (IRM, Bilans...)</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="file"
                  className="hidden"
                  multiple
                  onChange={handleFileChange}
                  ref={fileInputRef}
                  accept=".pdf,image/*"
                />
                <Button variant="secondary" size="sm" className="h-7 text-xs px-3" onClick={() => fileInputRef.current?.click()}>
                  Parcourir
                </Button>
              </div>
            </div>

            {/* Fichiers attachés (Affichés dynamiquement) */}
            {attachedFiles.length > 0 && (
              <div className="mx-auto flex flex-wrap justify-center gap-2 mb-6">
                {attachedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-[#ebd9c8]/30 border border-[#bd613c]/20 rounded-full px-3 py-1.5 text-xs text-[#4a3f35] shadow-sm">
                    {f.type.includes('pdf') ? <FileText className="w-3.5 h-3.5 text-red-500" /> : <ImageIcon className="w-3.5 h-3.5 text-blue-500" />}
                    <span className="truncate max-w-[200px]">{f.name}</span>
                    <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 ml-1">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Sélection du Mode d'Enregistrement */}
            <Tabs value={recorderMode} onValueChange={setRecorderMode} className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="standard" className="text-xs sm:text-sm">Mode Standard</TabsTrigger>
                <TabsTrigger value="bilingual" className="text-xs sm:text-sm">Mode Bilingue</TabsTrigger>
                <TabsTrigger value="import" className="text-xs sm:text-sm">Importer Audio</TabsTrigger>
              </TabsList>

              <div className="min-h-[350px] lg:min-h-[420px] flex flex-col justify-center">
                <TabsContent value="standard">
                  <AudioRecorder onRecordingComplete={handleRecordingComplete} />
                </TabsContent>

                <TabsContent value="bilingual">
                  <BilingualRecorder onRecordingComplete={handleBilingualComplete} attachedFiles={attachedFiles} />
                </TabsContent>

                <TabsContent value="import">
                  <Card
                    className="relative w-full max-w-4xl mx-auto border-[#bd613c]/30 shadow-none bg-white/50 transition-colors duration-200 min-h-[350px] flex flex-col justify-center items-center p-8 group cursor-pointer"
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.classList.add('bg-[#ebd9c8]/50', 'border-dashed', 'border-[3px]', 'border-[#bd613c]');
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.classList.remove('bg-[#ebd9c8]/50', 'border-dashed', 'border-[3px]', 'border-[#bd613c]');
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.classList.remove('bg-[#ebd9c8]/50', 'border-dashed', 'border-[3px]', 'border-[#bd613c]');
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        const file = e.dataTransfer.files[0];
                        const validExtensions = ['.webm', '.mp3', '.m4a', '.mp4', '.wav', '.ogg'];
                        const isAudioVideoType = file.type ? (file.type.startsWith('audio/') || file.type.startsWith('video/')) : false;
                        const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

                        if (isAudioVideoType || hasValidExtension || !file.type) {
                          toast({
                            title: "Importation...",
                            description: "L'audio (ou vidéo) va être importé et analysé.",
                          });
                          handleRecordingComplete(file);
                        } else {
                          toast({ title: "Format invalide", description: `Veuillez déposer un fichier audio ou vidéo valide. (Détecté: ${file.type || 'Inconnu'})`, variant: "destructive" });
                        }
                      }
                    }}
                  >
                    <input
                      type="file"
                      id="audio-upload"
                      className="hidden"
                      accept=".webm,.mp3,.m4a,.mp4,.wav,.ogg,audio/*,video/*"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          const file = e.target.files[0];
                          toast({
                            title: "Compression en cours...",
                            description: "L'audio sélectionné va être compressé avant analyse...",
                          });
                          compressAudio(file).then((compressedFile) => {
                            toast({
                              title: "Importation...",
                              description: "Compression terminée. L'audio va être analysé.",
                            });
                            handleRecordingComplete(compressedFile);
                          }).catch(err => {
                            toast({ title: "Erreur de compression", description: "Impossible de compresser le fichier.", variant: "destructive" });
                            console.error(err);
                          });
                        }
                      }}
                    />
                    <label htmlFor="audio-upload" className="w-full h-full absolute inset-0 cursor-pointer" aria-label="Importer un fichier audio" />

                    <div className="flex flex-col items-center pointer-events-none text-[#8c7b6c] group-hover:text-[#bd613c] transition-colors">
                      <div className="w-16 h-16 rounded-full bg-[#ebd9c8]/20 flex items-center justify-center mb-4 group-hover:bg-[#ebd9c8]/50 group-hover:scale-110 transition-all">
                        <ArrowRight className="w-8 h-8 rotate-90" />
                      </div>
                      <p className="text-xl font-bebas tracking-widest uppercase mb-2">Glisser-déposer ou Taper ici</p>
                      <p className="text-sm opacity-70 text-center max-w-sm">
                        Formats supportés : m4a, mp3, mp4, wav, webm...<br />
                        Les fichiers seront automatiquement compressés.
                      </p>
                    </div>
                  </Card>
                </TabsContent>
              </div>
            </Tabs>
          </div>

          {/* Historique des consultations */}
          <div className="lg:col-span-7 space-y-6 pt-4 lg:pt-0">

            <Tabs defaultValue="date" className="w-full">
              <div className="flex items-center justify-between border-b border-[#bd613c]/20 mb-6 mt-8 lg:mt-0 gap-4">
                <TabsList className="bg-transparent p-0 w-auto flex items-center gap-6 h-auto">
                  <TabsTrigger value="date" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-[#bd613c] border-b-2 border-transparent data-[state=active]:border-[#bd613c] rounded-none px-1 py-3 text-[#4a3f35]/60 hover:text-[#bd613c] transition-all font-medium text-sm sm:text-base translate-y-[1px]">Par date</TabsTrigger>
                  <TabsTrigger value="name" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-[#bd613c] border-b-2 border-transparent data-[state=active]:border-[#bd613c] rounded-none px-1 py-3 text-[#4a3f35]/60 hover:text-[#bd613c] transition-all font-medium text-sm sm:text-base translate-y-[1px]">Par nom</TabsTrigger>
                </TabsList>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleExportAll}
                  className="shrink-0 text-[#bd613c] hover:bg-[#ebd9c8]/30 h-10 w-10 sm:h-12 sm:w-12 rounded-lg"
                  title="Sauvegarder en local (JSON)"
                >
                  <Download className="w-6 h-6" />
                </Button>
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

                <TabsContent value="date" className="focus-visible:outline-none">
                  {(() => {
                    if (!sortByDate) return null;
                    const groupedByDate = sortByDate.reduce((acc, consult) => {
                      const date = new Date(consult.date);
                      const year = date.getFullYear().toString();
                      const month = format(date, 'MMMM', { locale: fr });
                      const folderKey = `${month.charAt(0).toUpperCase() + month.slice(1)} ${year}`;
                      if (!acc[folderKey]) acc[folderKey] = [];
                      acc[folderKey].push(consult);
                      return acc;
                    }, {} as Record<string, SupabaseConsultation[]>);

                    return Object.entries(groupedByDate).map(([folderName, items], index) => (
                      <Folder key={folderName} title={<span className="flex items-center gap-2">{folderName} <span className="text-slate-400 font-normal text-base sm:text-lg">{items.length}</span></span>} defaultOpen={index === 0}>
                        <div className="flex flex-col gap-3">
                          {items.map((consult) => (
                            <ConsultationCard key={consult.id} consult={consult} />
                          ))}
                        </div>
                      </Folder>
                    ));
                  })()}
                </TabsContent>

                <TabsContent value="name" className="focus-visible:outline-none">
                  {(() => {
                    if (!sortByName) return null;
                    const groupedByName = sortByName.reduce((acc, consult) => {
                      const name = consult.patientName || `Patient #${consult.id}`;
                      const letter = name.charAt(0).toUpperCase();
                      if (!acc[letter]) acc[letter] = [];
                      acc[letter].push(consult);
                      return acc;
                    }, {} as Record<string, SupabaseConsultation[]>);

                    return Object.entries(groupedByName).map(([letter, items], index) => (
                      <Folder key={letter} title={<span className="flex items-center gap-2">{letter} <span className="text-slate-400 font-normal text-base sm:text-lg">{items.length}</span></span>} defaultOpen={index === 0}>
                        <div className="flex flex-col gap-3">
                          {items.map((consult) => (
                            <ConsultationCard key={consult.id} consult={consult} />
                          ))}
                        </div>
                      </Folder>
                    ));
                  })()}
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>

      </div >
    </main >
  );
}

