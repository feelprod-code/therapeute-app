"use client";

import { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AudioRecorder } from "@/components/AudioRecorder";
import BilingualRecorder from '@/components/BilingualRecorder';
import { supabase, SupabaseConsultation } from "@/lib/supabaseClient";
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
import ProtectedRoute from "@/components/ProtectedRoute";

export default function HomeWrapper() {
  return (
    <ProtectedRoute>
      <Home />
    </ProtectedRoute>
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

      if (!error && data) {
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
      console.log("Déclenchement de l'analyse sur /api/analyze...");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 min

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
        transcription: "Analyse multimodale unique (cf. Synthese).",
      }).eq('id', newConsultationId);

      setActiveProcessingIds(prev => prev.filter(id => id !== newConsultationId));

      setAttachedFiles([]); // On vide les fichiers après succès

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

  const retryAnalysis = async (consult: SupabaseConsultation) => {
    if (!consult.id) return;

    try {
      console.log("Relance impossible pour le moment sans fichier audio stocké.", consult.id);
      toast({
        title: "Relance suspendue",
        description: "L'option de relance n'est plus supportée sans sauvegarde audio sur le cloud.",
        variant: "destructive"
      });
    } catch (error: unknown) {
      toast({
        title: "Échec de l'analyse",
        description: error instanceof Error ? error.message : "Erreur inattendue",
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

  const ConsultationCard = ({ consult }: { consult: SupabaseConsultation }) => {
    if (!consult) return null;
    const isProcessing = activeProcessingIds.includes(consult.id);

    return (
      <Card key={consult.id} className="hover:shadow-md transition-shadow relative overflow-hidden group border-[#bd613c]/20">
        {isProcessing && (
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
            {isProcessing ? (
              <div className="flex items-center gap-2 text-sm text-[#e25822]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Traitement...</span>
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
        {/* Upload de documents externes */}
        <div
          className="bg-white/40 p-2 sm:p-3 rounded-lg border border-[#bd613c]/10 shadow-sm mb-4 max-w-2xl mx-auto flex flex-col sm:flex-row items-center gap-3 transition-colors duration-200 hover:border-[#bd613c]/30"
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
          <div className="max-w-2xl mx-auto flex flex-wrap justify-center gap-2 mb-6">
            {attachedFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-[#ebd9c8]/30 border border-[#bd613c]/20 rounded-full px-2.5 py-1 text-[11px] text-[#4a3f35]">
                {f.type.includes('pdf') ? <FileText className="w-3 h-3 text-red-500" /> : <ImageIcon className="w-3 h-3 text-blue-500" />}
                <span className="truncate max-w-[120px]">{f.name}</span>
                <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 ml-1">
                  <X className="w-3 h-3" />
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

          <TabsContent value="standard">
            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
          </TabsContent>

          <TabsContent value="bilingual">
            <BilingualRecorder onRecordingComplete={handleBilingualComplete} attachedFiles={attachedFiles} />
          </TabsContent>

          <TabsContent value="import">
            <Card
              className="border-[#bd613c]/30 shadow-none bg-white/50 transition-colors duration-200"
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('bg-[#ebd9c8]/50', 'border-dashed', 'border-[3px]', 'border-[#bd613c]');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('bg-[#ebd9c8]/50', 'border-dashed', 'border-[3px]', 'border-[#bd613c]');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('bg-[#ebd9c8]/50', 'border-dashed', 'border-[3px]', 'border-[#bd613c]');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  const file = e.dataTransfer.files[0];
                  const validExtensions = ['.webm', '.mp3', '.m4a', '.mp4', '.wav', '.ogg'];
                  const isAudioVideoType = file.type.startsWith('audio/') || file.type.startsWith('video/');
                  const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

                  if (isAudioVideoType || hasValidExtension) {
                    toast({
                      title: "Importation...",
                      description: "L'audio déposé va être analysé. Patientez...",
                    });
                    handleRecordingComplete(file);
                  } else {
                    toast({ title: "Format invalide", description: "Veuillez déposer un fichier audio ou vidéo valide.", variant: "destructive" });
                  }
                }
              }}
            >
              <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <div className="w-16 h-16 bg-[#ebd9c8]/50 rounded-full flex items-center justify-center mb-4 text-[#bd613c] group-hover:scale-110 transition-transform">
                  <Download className="w-8 h-8" />
                </div>
                <h3 className="font-bebas text-2xl tracking-widest text-[#bd613c] mb-2 uppercase">
                  Glisser & Déposer un vieil Enregistrement
                </h3>
                <p className="text-slate-500 mb-6 max-w-md mx-auto pointer-events-none">
                  Glissez ici un fichier audio (.webm, .mp3, .m4a) ou cliquez pour le sélectionner si un enregistrement a échoué sur mobile, pour le relancer manuellement.
                </p>
                <Button
                  type="button"
                  className="bg-[#bd613c] hover:bg-[#a05232] text-white px-8 py-6 rounded-full text-lg shadow-md transition-transform hover:scale-105 cursor-pointer pointer-events-none"
                >
                  <Paperclip className="w-5 h-5 mr-2" />
                  Sélectionner l&apos;Audio
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/*,.m4a,.webm,.mp3,.mp4,.wav,.ogg"
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
                    // Reset value so we can re-import the exact same file
                    e.target.value = '';
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

