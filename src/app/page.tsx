"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react/no-unescaped-entities, @typescript-eslint/no-unused-expressions */

import { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AudioRecorder } from "@/components/AudioRecorder";
import BilingualRecorder from '@/components/BilingualRecorder';
import { compressAudio } from '@/lib/compress-audio';
import { supabase, SupabaseConsultation } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Plus, Trash2, ArrowRight, Loader2, RefreshCw, FileText, Check, MessageSquare, ListTodo, MoreHorizontal, Merge, Search, Mic, Type, FileUp, X as XIcon, CalendarDays, Folder as FolderIcon, ChevronDown, Combine, Paperclip, Image as ImageIcon, X, Download, Square } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ProtectedRoute from "@/components/ProtectedRoute";

const BATCH_SIZE = 10; // Number of items to load per page

interface CustomSpeechEvent {
  resultIndex: number;
  results: {
    length: number;
    [key: number]: {
      isFinal: boolean;
      [key: number]: {
        transcript: string;
      };
    };
  };
}

function EmptyState() {
  return (
    <details className="mt-8 mb-8 mx-auto max-w-2xl bg-white rounded-2xl border border-[#ebd9c8] p-6 text-center cursor-pointer shadow-sm hover:shadow transition-shadow group">
      <summary className="font-bebas text-xl text-[#bd613c] tracking-wide list-none flex items-center justify-center gap-2">
        <span className="text-2xl opacity-80 group-open:hidden">▶</span>
        <span className="text-2xl opacity-80 hidden group-open:inline">▼</span>
        Comment utiliser le mode Bilingue ou un autre appareil ?
      </summary>
      <div className="mt-6 text-[#4a3f35]/80 text-sm space-y-4 font-inter text-left px-4">
        <p>1. Cliquez sur le bouton <strong className="text-[#bd613c] font-semibold">Mode Bilingue</strong> si vous passez d'une langue à l'autre dans le même enregistrement.</p>
        <p>2. Enregistrez avec le dictaphone de votre téléphone ou tout autre appareil portable.</p>
        <p>3. Cliquez sur l'onglet <strong className="text-[#bd613c] font-semibold">Importer Audio</strong> et déposez votre fichier.</p>
        <p>4. L'IA générera automatiquement le bilan complet basé sur ce fichier.</p>
      </div>
    </details>
  );
}

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
  const [textContent, setTextContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [consultations, setConsultations] = useState<SupabaseConsultation[] | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [isDictating, setIsDictating] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggleDictation = () => {
    if (isDictating) {
      recognitionRef.current?.stop();
      setIsDictating(false);
      return;
    }

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: "Non supporté", description: "La dictée vocale n'est pas supportée sur ce navigateur.", variant: "destructive" });
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: CustomSpeechEvent) => {
      let currentFinal = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinal += event.results[i][0].transcript + ' ';
        }
      }
      if (currentFinal) {
        setTextContent(prev => prev + (prev && !prev.endsWith(' ') ? ' ' : '') + currentFinal);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsDictating(false);
    };

    recognition.onend = () => {
      setIsDictating(false);
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsDictating(true);
  };

  useEffect(() => {
    const fetchConsultations = async () => {
      try {
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
            follow_ups: d.follow_ups,
            isProcessing: false, // Override dynamically in ConsultationCard
            createdAt: new Date(d.created_at)
          }));
          setConsultations(formatted);
        }
      } catch (err) {
        console.error("Catch block: Supabase fetch error:", err);
        setConsultations([]);
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

  const handleRecordingComplete = async (inputBlob: Blob | File): Promise<boolean> => {
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
        patient_name: `Patient Anonyme (${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`, // Temporaire avec heure pour éviter les erreurs de suppression
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
      // Construire le payload de mise à jour
      const updatePayload: any = {
        patient_name: analyzeData.patientName && analyzeData.patientName.trim() !== "" ? analyzeData.patientName : "Patient Anonyme",
        resume: analyzeData.resume || "",
        synthese: analyzeData.synthese,
        transcription: analyzeData.transcription || "",
      };

      // Si l'IA a trouvé une date de consultation claire dans le texte, on écrase la date de création par défaut
      if (analyzeData.consultationDate) {
        const parsedDate = new Date(analyzeData.consultationDate);
        if (!isNaN(parsedDate.getTime())) {
          updatePayload.date = parsedDate.toISOString();
        }
      }

      await supabase.from('consultations').update(updatePayload).eq('id', newConsultationId);

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
      return true;

    } catch (error: unknown) {
      console.error("Erreur gérée dans handleRecordingComplete:", error);
      const errorMessage = error instanceof Error ? error.message : "Une erreur est survenue lors du traitement audio.";

      if (newConsultationId !== undefined) {
        setActiveProcessingIds(prev => prev.filter(id => id !== newConsultationId));
      }

      toast({
        title: "Erreur Traitement",
        description: errorMessage,
        variant: "destructive",
      });
      return false;
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
        // Chercher spécifiquement le fichier audio initial (exclure les addendums)
        const audioFile = listData.find(f => f.name.startsWith('audio_') && !f.name.startsWith('audio_addendum_'));
        if (!audioFile) {
          throw new Error("Aucun fichier audio initial trouvé pour ce bilan.");
        }
        pathToDownload = audioFile.name;
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

      const { data: listData, error: listError } = await supabase.storage.from('tdt_uploads').list('', { search: consult.id });
      const uploadedAttachedFiles: { fileName: string, mimeType: string }[] = [];

      if (!listError && listData) {
        // Fallback pour trouver l'audio initial si pas en base
        if (!pathToAnalyze) {
          const initialAudio = listData.find(f => f.name.startsWith('audio_') && !f.name.startsWith('audio_addendum_'));
          if (initialAudio) pathToAnalyze = initialAudio.name;
        }

        // Trouver TOUS les autres documents: doc_, txt_addendum_, audio_addendum_
        const additionalFiles = listData.filter(f =>
          f.name.startsWith('doc_') ||
          f.name.startsWith('txt_addendum_') ||
          f.name.startsWith('audio_addendum_')
        );

        for (const file of additionalFiles) {
          let mimeType = 'application/octet-stream';
          if (file.name.endsWith('.webm')) mimeType = 'audio/webm';
          else if (file.name.endsWith('.txt')) mimeType = 'text/plain';

          uploadedAttachedFiles.push({
            fileName: file.name,
            mimeType: mimeType
          });
        }
      }

      if (!pathToAnalyze && uploadedAttachedFiles.length === 0) {
        throw new Error("Impossible de relancer : aucun fichier introuvable sur le cloud.");
      }

      const bodyPayload: any = {};

      if (pathToAnalyze) {
        if (pathToAnalyze.endsWith('.txt')) {
          uploadedAttachedFiles.push({ fileName: pathToAnalyze, mimeType: "text/plain" });
          pathToAnalyze = null; // Il n'y a plus de fichier audio principal
        } else {
          let mimeType = "audio/webm";
          if (pathToAnalyze.endsWith('.m4a')) mimeType = "audio/mp4";
          else if (pathToAnalyze.endsWith('.mp3')) mimeType = "audio/mp3";

          bodyPayload.audioFile = { fileName: pathToAnalyze, mimeType: mimeType };
        }
      }

      if (uploadedAttachedFiles.length > 0) {
        bodyPayload.attachedFiles = uploadedAttachedFiles;
      }

      // Now call /api/analyze with exactly what it expects
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 900000); // 15 min

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
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
      });
    } finally {
      setActiveProcessingIds(prev => prev.filter(id => id !== consult.id));
    }
  };

  const filteredConsultations = (consultations || []).filter(c => {
    if (!searchTerm) return true;
    const name = c.patientName || c.patient_name || "";
    return name.toLowerCase().includes(searchTerm.toLowerCase().trim());
  });

  const sortByDate = [...filteredConsultations].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const sortByName = [...filteredConsultations].sort((a, b) => {
    const nameA = a.patientName || a.patient_name || `Patient #${a.id}`;
    const nameB = b.patientName || b.patient_name || `Patient #${b.id}`;
    return nameA.localeCompare(nameB);
  });

  const ConsultationCard = ({ consult }: { consult: SupabaseConsultation }) => {
    const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
    const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
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

    const handleAppendRecording = async (audioBlob: Blob): Promise<boolean> => {
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
        return true;

      } catch (err) {
        console.error(err);
        toast({ title: "Erreur", description: "Impossible d'ajouter l'enregistrement.", variant: "destructive" });
        return false;
      } finally {
        setIsAppending(false);
      }
    };

    const extractExplicitSession = (text: string | null | undefined): number | null => {
      if (!text) return null;
      // Allow e.g. "s15", "séance 15", "S 15", "seance15"
      const match = text.match(/\b(?:s|séance|seance)\s*([0-9]+)\b/i);
      if (match) {
        const num = parseInt(match[1], 10);
        const isSpelledOut = /(?:séance|seance)/i.test(match[0]);
        // Avoid S1-S5 (sacrum) false positives unless explicitly "séance"
        // Ignore 1900-2100 matching as a year (e.g. S 1991)
        if (num >= 1900 && num <= 2100 && !isSpelledOut) return null;
        if (num > 5 || isSpelledOut) return num;
      }
      return null;
    };

    const getSessionCount = () => {
      const allDates = new Set<string>();
      let maxExplicitOffset = 0;
      let maxExplicitIndex = -1;

      if (consult.date) {
        try {
          const dStr = new Date(consult.date).toISOString().split('T')[0];
          allDates.add(dStr);
          const num = extractExplicitSession(consult.resume) || extractExplicitSession(consult.synthese);
          if (num) {
            maxExplicitOffset = num;
            maxExplicitIndex = 0;
          }
        } catch (e) { }
      }

      if (consult.follow_ups && Array.isArray(consult.follow_ups)) {
        consult.follow_ups.forEach((note: any) => {
          if (note.date) {
            try {
              const dStr = new Date(note.date).toISOString().split('T')[0];
              allDates.add(dStr);
            } catch (e) { }
          }
        });
      }

      const sortedAllDates = Array.from(allDates).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

      // Look for explicit markers in followups to adjust offset
      if (consult.follow_ups && Array.isArray(consult.follow_ups)) {
        consult.follow_ups.forEach((note: any) => {
          if (note.date) {
            try {
              const dStr = new Date(note.date).toISOString().split('T')[0];
              const dIdx = sortedAllDates.indexOf(dStr);
              let num = null;
              if (note.type === 'session_override') {
                num = note.value;
              } else {
                num = extractExplicitSession(note.title) || extractExplicitSession(note.content);
              }
              if (num && num > maxExplicitOffset) {
                // Keep the largest explicit offset we find to set the baseline
                maxExplicitOffset = num;
                maxExplicitIndex = dIdx;
              }
            } catch (e) { }
          }
        });
      }

      if (maxExplicitOffset > 0 && maxExplicitIndex >= 0) {
        // If we found 'S15' at index 4, and total length is 6
        // S15 is index 4. Index 5 is 16. Max is `15 + (5 - 4)` = 16.
        return maxExplicitOffset + ((sortedAllDates.length - 1) - maxExplicitIndex);
      }

      return sortedAllDates.length || 1;
    };

    const sessionCount = getSessionCount();

    return (
      <Card key={consult.id} className="hover:shadow-md transition-shadow relative overflow-hidden group border-[#bd613c]/20">
        {isProcessing && (
          <div className="absolute top-0 left-0 w-full h-1 bg-[#e25822] animate-pulse" />
        )}
        <div className="flex flex-row items-center justify-between p-4 sm:p-5 gap-2 sm:gap-4">
          <div className="flex-1 min-w-0 pr-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-lg sm:text-xl font-bebas tracking-wide text-[#594c42] font-medium uppercase leading-tight">
              {consult.patientName || `Patient #${consult.id}`}
            </h3>
            <div className="flex flex-row items-center gap-2 text-[10px] sm:text-[11px] text-[#4a3f35]/80 shrink-0">
              <span className="font-medium whitespace-nowrap">
                {format(new Date(consult.date), "dd/MM/yy '•' HH:mm", { locale: fr })}
              </span>
              <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[#ebd9c8]/30 text-[#bd613c]/80 text-[10px] font-medium rounded-sm whitespace-nowrap">
                <CalendarDays className="w-2.5 h-2.5 opacity-80" />
                <span>S{sessionCount}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2 shrink-0">
            {/* Les modales cachées */}
            <Dialog open={isRecordingModalOpen} onOpenChange={setIsRecordingModalOpen}>
              <DialogContent className="sm:max-w-xl bg-white border-[#ebd9c8]/30">
                <DialogHeader>
                  <DialogTitle className="font-bebas tracking-wide text-3xl text-[#bd613c] uppercase text-center mb-4">
                    Ajout Rapide d&apos;Informations
                  </DialogTitle>
                </DialogHeader>
                <div className="py-2">
                  <AudioRecorder onRecordingComplete={handleAppendRecording} isProcessing={isAppending} />
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={isMergeModalOpen} onOpenChange={setIsMergeModalOpen}>
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

            <AlertDialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
              <AlertDialogContent className="w-[90vw] rounded-xl sm:w-[400px]">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-[#bd613c]">Supprimer {consult.patientName} ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Êtes-vous sûr de vouloir supprimer définitivement ce dossier et toutes ses données associées (audios, images, textes) ? Cette action est totalement irréversible.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setIsDeleteModalOpen(false)}>Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setIsDeleteModalOpen(false); consult.id && handleDelete(consult.id); }} className="bg-red-500 text-white hover:bg-red-600 border-0 focus:ring-red-500">
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {isProcessing ? (
              <div className="flex items-center gap-2 text-sm text-[#e25822]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Traitement...</span>
              </div>
            ) : (
              <>
                {!consult.synthese && (
                  <div className="flex items-center gap-1 sm:gap-2">
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
                  </div>
                )}
                {consult.synthese && (
                  <Button asChild variant="default" className="bg-[#bd613c]/90 hover:bg-[#bd613c] text-white h-9 px-4 rounded-lg shadow-sm" size="sm">
                    <Link href={`/consultation/${consult.id}`}>
                      <span className="mr-1">Voir</span>
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Link>
                  </Button>
                )}

                {/* Dropdown 3 petits points */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-slate-600 hover:bg-[#ebd9c8]/30">
                      <MoreHorizontal className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[200px] bg-white border-[#ebd9c8]/50 shadow-md rounded-xl p-1">
                    {consult.synthese && (
                      <DropdownMenuItem onClick={() => setIsRecordingModalOpen(true)} className="cursor-pointer gap-2 text-[#4a3f35] py-2.5 focus:bg-[#ebd9c8]/20 transition-colors">
                        <Mic className="w-4 h-4 text-[#bd613c]" />
                        <span className="font-medium">Ajouter un audio</span>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => retryAnalysis(consult)} disabled={isAppending || activeProcessingIds.includes(consult.id)} className="cursor-pointer gap-2 text-[#4a3f35] py-2.5 focus:bg-[#ebd9c8]/20 transition-colors">
                      <RefreshCw className={`w-4 h-4 text-blue-500`} />
                      <span className="font-medium">Régénérer par l&apos;IA</span>
                    </DropdownMenuItem>
                    {consult.synthese && (
                      <DropdownMenuItem onClick={() => setIsMergeModalOpen(true)} className="cursor-pointer gap-2 text-[#4a3f35] py-2.5 focus:bg-[#ebd9c8]/20 transition-colors">
                        <Combine className="w-4 h-4 text-emerald-600" />
                        <span className="font-medium">Fusionner le dossier</span>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setIsDeleteModalOpen(true)} className="cursor-pointer gap-2 text-red-600 focus:bg-red-50 focus:text-red-700 py-2.5 transition-colors mt-1 border-t border-slate-100">
                      <Trash2 className="w-4 h-4" />
                      <span className="font-medium">Supprimer</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <main className="min-h-[100dvh] md:h-[100dvh] md:overflow-hidden flex flex-col py-4 sm:py-8 px-4 sm:px-6 mb-12 md:mb-0">
      <div className="max-w-7xl mx-auto w-full flex flex-col relative md:h-full">

        {/* Bouton Agenda et En-tête */}
        <div className="relative mt-8 sm:mt-6 md:mt-4 mb-6 sm:mb-8 flex flex-col items-center justify-center pt-8 sm:pt-0">
          <div className="absolute top-0 right-0 z-20">
            <Button asChild variant="outline" className="text-[#bd613c] border-[#bd613c]/30 hover:bg-[#ebd9c8]/30 rounded-xl h-9 sm:h-10 px-3 sm:px-4 shadow-sm bg-white/50 backdrop-blur-sm">
              <Link href="/calendrier">
                <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                <span className="hidden sm:inline font-medium">Mon Agenda</span>
              </Link>
            </Button>
          </div>

          <div className="text-center shrink-0 w-full px-2 sm:px-[140px] md:px-[180px] pt-2 sm:pt-0">
            <h1 className="font-bebas text-3xl sm:text-5xl md:text-6xl text-[#bd613c] tracking-wide uppercase leading-tight md:leading-none mb-1 text-balance">
              Techniques Douces Tissulaires
            </h1>
            <p className="mt-2 text-base sm:text-xl md:text-2xl tracking-[0.1em] sm:tracking-[0.2em] text-[#4a3f35] uppercase font-light">
              Consultation Bilan
            </p>
          </div>
        </div>

        {/* Grille Flex pour prendre le reste de l'écran en Desktop */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-start w-full">

          {/* Colonne de Gauche : Outils d'Enregistrement (Fixe ou scroll indépendant) */}
          <div className="md:col-span-5 flex flex-col gap-6 md:h-full md:overflow-y-auto custom-scrollbar md:pr-2 pb-4">


            {/* Sélection du Mode d'Enregistrement */}
            <Tabs value={recorderMode} onValueChange={setRecorderMode} className="w-full">
              <TabsList className="grid w-full grid-cols-3 gap-1 p-1 bg-[#ebd9c8]/20 rounded-xl mb-6 h-auto min-h-[44px]">
                <TabsTrigger value="standard" className="text-xs sm:text-sm py-2 px-1 leading-tight rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#bd613c] data-[state=active]:shadow-sm">
                  Audio
                </TabsTrigger>
                <TabsTrigger value="bilingual" className="text-xs sm:text-sm py-2 px-1 leading-tight rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#bd613c] data-[state=active]:shadow-sm">
                  Bilingue
                </TabsTrigger>
                <TabsTrigger value="text" className="text-xs sm:text-sm py-2 px-1 leading-tight rounded-lg data-[state=active]:bg-white data-[state=active]:text-[#bd613c] data-[state=active]:shadow-sm">
                  Texte
                </TabsTrigger>
              </TabsList>

              <div className="min-h-[350px] md:min-h-[420px] flex flex-col justify-center">
                <TabsContent value="standard">
                  <AudioRecorder onRecordingComplete={handleRecordingComplete} />
                </TabsContent>

                <TabsContent value="bilingual">
                  <BilingualRecorder onRecordingComplete={handleBilingualComplete} attachedFiles={attachedFiles} />
                </TabsContent>



                <TabsContent value="text">
                  <Card className="w-full max-w-4xl mx-auto border-[#bd613c]/30 shadow-sm bg-white p-6 md:p-8 min-h-[350px] flex flex-col">
                    <h3 className="font-bebas tracking-wide text-2xl text-[#bd613c] uppercase mb-2 text-center">Nouveau Patient par Saisie</h3>
                    <p className="text-sm text-[#4a3f35]/70 mb-6 text-center">
                      Collez vos anciennes notes ou rédigez votre brouillon. L'IA s'occupera d'en extraire le bilan complet.
                    </p>
                    <div className="relative flex-1 mb-6">
                      <textarea
                        className="w-full h-full min-h-[200px] p-4 pb-14 font-inter text-base rounded-xl border border-[#ebd9c8] focus:border-[#bd613c] focus:ring-1 focus:ring-[#bd613c] outline-none resize-none"
                        placeholder="Exemple : Patient Jean Dupont, 45 ans. Douleur cervicale depuis 5 jours. Antécédents d'entorse en 2018..."
                        value={textContent}
                        onChange={(e) => setTextContent(e.target.value)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={toggleDictation}
                        className={`absolute bottom-3 right-3 rounded-full transition-all ${isDictating ? 'bg-red-100 text-red-500 hover:bg-red-200 animate-pulse' : 'bg-[#ebd9c8]/30 text-[#bd613c] hover:bg-[#ebd9c8]/50'}`}
                        title={isDictating ? "Arrêter la dictée" : "Démarrer la dictée vocale"}
                      >
                        {isDictating ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
                      </Button>
                    </div>
                    <Button
                      className="w-full sm:w-auto self-center bg-[#e25822] hover:bg-[#bd613c] text-white px-10 h-11 rounded-full text-base font-medium shadow-md transition-transform hover:scale-105"
                      disabled={!textContent.trim()}
                      onClick={() => {
                        const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
                        const file = new File([blob], `bilan_manuel_${Date.now()}.txt`, { type: 'text/plain' });
                        handleRecordingComplete(file);
                        setTextContent("");
                      }}
                    >
                      Générer le Dossier Patient
                    </Button>
                  </Card>
                </TabsContent>
              </div>
            </Tabs>
          </div>

          {/* Historique des consultations */}
          <div className="md:col-span-7 space-y-6 pt-4 md:pt-0 md:h-full md:overflow-y-auto md:pr-2 pb-12 custom-scrollbar">

            <Tabs defaultValue="date" className="w-full">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-[#bd613c]/20 mb-6 mt-8 md:mt-0 gap-4">
                <TabsList className="bg-transparent p-0 w-auto flex items-center gap-6 h-auto">
                  <TabsTrigger value="date" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-[#bd613c] border-b-2 border-transparent data-[state=active]:border-[#bd613c] rounded-none px-1 py-3 text-[#4a3f35]/60 hover:text-[#bd613c] transition-all font-medium text-sm sm:text-base translate-y-[1px]">Par date</TabsTrigger>
                  <TabsTrigger value="name" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-[#bd613c] border-b-2 border-transparent data-[state=active]:border-[#bd613c] rounded-none px-1 py-3 text-[#4a3f35]/60 hover:text-[#bd613c] transition-all font-medium text-sm sm:text-base translate-y-[1px]">Par nom</TabsTrigger>
                </TabsList>

                <div className="flex items-center justify-end w-full sm:w-auto gap-2">
                  <div className="relative w-full sm:w-64 max-w-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search className="h-4 w-4 text-[#bd613c]/60" />
                    </div>
                    <input
                      type="text"
                      className="block w-full pl-10 pr-3 py-2 border border-[#ebd9c8] rounded-xl leading-5 bg-white/50 placeholder-[#4a3f35]/50 focus:outline-none focus:ring-1 focus:ring-[#bd613c] focus:border-[#bd613c] sm:text-sm text-[#4a3f35] transition-colors"
                      placeholder="Rechercher par nom..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm("")}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-[#bd613c]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleExportAll}
                    className="shrink-0 text-[#bd613c] hover:bg-[#ebd9c8]/30 h-10 w-10 sm:h-12 w-12 rounded-lg"
                    title="Sauvegarder en local (JSON)"
                  >
                    <Download className="w-5 h-5 sm:w-6 sm:h-6" />
                  </Button>
                </div>
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

