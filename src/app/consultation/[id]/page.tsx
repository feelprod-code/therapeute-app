"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Loader2, FileText, Activity, Printer, Share, Pencil, Check, X as XIcon, MessageSquare, Mic, Paperclip, Image as ImageIcon, Trash2, Square, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AudioRecorder } from "@/components/AudioRecorder";
import { useToast } from "@/hooks/use-toast";
import imageCompression from 'browser-image-compression';

export default function ConsultationDetail() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Nouveaux états pour l'édition et l'ajout de documents
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [isAppending, setIsAppending] = useState(false);
  const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
  const [isTextModalOpen, setIsTextModalOpen] = useState(false);
  const [textContent, setTextContent] = useState("");

  // Nouveaux états pour l'override de séance
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [editingSessionDay, setEditingSessionDay] = useState("");
  const [customSessionNumber, setCustomSessionNumber] = useState<number | "">("");

  const handleSaveSessionOverride = async () => {
    if (customSessionNumber === "") return;
    try {
      const currentFollowUps = data.follow_ups || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtered = currentFollowUps.filter((n: any) => !(n.type === 'session_override' && n.date && n.date.startsWith(editingSessionDay)));

      const overrideNote = {
        id: crypto.randomUUID(),
        date: editingSessionDay + "T00:00:00.000Z",
        type: 'session_override',
        value: customSessionNumber
      };

      const updatedFollowUps = [...filtered, overrideNote];
      const { data: updatedData, error } = await supabase.from('consultations').update({ follow_ups: updatedFollowUps }).eq('id', params.id).select().single();

      if (error) throw error;
      setData(updatedData);
      setIsSessionModalOpen(false);
      toast({ title: "Séance modifiée", description: "Le numéro de séance a bien été mis à jour." });
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Impossible de modifier la séance.", variant: "destructive" });
    }
  };

  // Nouveaux états pour le suivi chronologique
  const [appendMode, setAppendMode] = useState<'bilan' | 'suivi'>('bilan');
  const fileInputRefBilanMobile = useRef<HTMLInputElement>(null);
  const fileInputRefSuiviMobile = useRef<HTMLInputElement>(null);
  const fileInputRefBilanDesktop = useRef<HTMLInputElement>(null);
  const fileInputRefSuiviDesktop = useRef<HTMLInputElement>(null);
  const fileInputRefImageMobile = useRef<HTMLInputElement>(null);
  const fileInputRefImageDesktop = useRef<HTMLInputElement>(null);

  const [attachedDocs, setAttachedDocs] = useState<{ name: string, originalName: string, url: string, type: 'image' | 'pdf' | 'other' }[] | null>(null);

  // Nouveaux états pour la modification de texte
  const [isEditingBilan, setIsEditingBilan] = useState(false);
  const [editBilanContent, setEditBilanContent] = useState("");

  const [isEditingResume, setIsEditingResume] = useState(false);
  const [editResumeContent, setEditResumeContent] = useState("");

  const [isEditingTranscription, setIsEditingTranscription] = useState(false);
  const [editTranscriptionContent, setEditTranscriptionContent] = useState("");

  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null);
  const [editFollowUpContent, setEditFollowUpContent] = useState("");

  // Image Viewer State
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const handleDeleteFollowUp = async (followUpId: string) => {
    if (!confirm("Voulez-vous vraiment supprimer cette note de suivi ?")) return;

    try {
      const currentFollowUps = data.follow_ups || [];
      const updatedFollowUps = currentFollowUps.filter((note: any) => note.id !== followUpId);

      const { data: updatedData, error } = await supabase.from('consultations').update({
        follow_ups: updatedFollowUps
      }).eq('id', params.id).select().single();

      if (error) throw error;

      setData(updatedData);
      toast({ title: "Note supprimée", description: "La note de suivi a bien été retirée du dossier." });
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Impossible de supprimer la note.", variant: "destructive" });
    }
  };

  const handleSaveBilan = async () => {
    try {
      const { error } = await supabase.from('consultations').update({ synthese: editBilanContent }).eq('id', params.id);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setData((prev: any) => ({ ...prev, synthese: editBilanContent }));
      setIsEditingBilan(false);
      toast({ title: "Bilan mis à jour", description: "Vos modifications ont été enregistrées." });
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Impossible de sauvegarder le bilan.", variant: "destructive" });
    }
  };

  const handleSaveResume = async () => {
    try {
      const { error } = await supabase.from('consultations').update({ resume: editResumeContent }).eq('id', params.id);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setData((prev: any) => ({ ...prev, resume: editResumeContent }));
      setIsEditingResume(false);
      toast({ title: "Résumé mis à jour", description: "Vos modifications ont été enregistrées." });
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Impossible de sauvegarder le résumé.", variant: "destructive" });
    }
  };

  const handleSaveTranscription = async () => {
    try {
      const { error } = await supabase.from('consultations').update({ transcription: editTranscriptionContent }).eq('id', params.id);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setData((prev: any) => ({ ...prev, transcription: editTranscriptionContent }));
      setIsEditingTranscription(false);
      toast({ title: "Dialogue mis à jour", description: "Vos modifications ont été enregistrées." });
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Impossible de sauvegarder le dialogue.", variant: "destructive" });
    }
  };

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

    recognition.onresult = (event: any) => {
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

  const handleSaveFollowUp = async (followUpId: string) => {
    try {
      const currentFollowUps = data.follow_ups || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatedFollowUps = currentFollowUps.map((n: any) =>
        n.id === followUpId ? { ...n, content: editFollowUpContent } : n
      );
      const { error } = await supabase.from('consultations').update({ follow_ups: updatedFollowUps }).eq('id', params.id);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setData((prev: any) => ({ ...prev, follow_ups: updatedFollowUps }));
      setEditingFollowUpId(null);
      toast({ title: "Note mise à jour", description: "Vos modifications ont été enregistrées." });
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Impossible de sauvegarder la note.", variant: "destructive" });
    }
  };

  const handleSaveName = async () => {
    if (!editName.trim()) return;
    try {
      const { error } = await supabase.from("consultations").update({ patient_name: editName }).eq("id", params.id);
      if (!error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setData((prev: any) => ({ ...prev, patient_name: editName })); // eslint-disable-line @typescript-eslint/no-explicit-any
        setIsEditing(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveDate = async () => {
    if (!editDate) return;
    try {
      const parsedDate = new Date(editDate);
      const { error } = await supabase.from("consultations").update({ date: parsedDate.toISOString() }).eq("id", params.id);
      if (!error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setData((prev: any) => ({ ...prev, date: parsedDate.toISOString() })); // eslint-disable-line @typescript-eslint/no-explicit-any
        setIsEditingDate(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const exportTxt = (content: string, type: 'bilan' | 'resume' | 'retranscription') => {
    if (!content) return;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_${data.patient_name || 'patient'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async (filename: string) => {
    const element = document.getElementById('consultation-export-container');
    if (!element) return;

    toast({ title: "Génération du PDF...", description: "Veuillez patienter..." });
    try {
      // @ts-ignore - html2pdf.js has poor typing without @types/html2pdf.js but works perfectly
      const html2pdf = (await import('html2pdf.js')).default;
      const opt = {
        margin: [15, 15, 15, 15],
        filename: filename + '.pdf',
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      await html2pdf().set(opt).from(element).save();
      toast({ title: "Succès", description: "Le PDF a été généré et téléchargé avec succès." });
    } catch (e) {
      console.error(e);
      toast({ title: "Erreur", description: "Une erreur est survenue lors de la génération du PDF.", variant: "destructive" });
    }
  };

  const handleAppendImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAppending(true);
    try {
      const isPDF = file.type === 'application/pdf';
      let finalFile: File | Blob = file;
      let finalType = isPDF ? 'pdf' : 'image';
      let orientation: 'vertical' | 'horizontal' = 'vertical';

      // Détecter l'orientation
      if (isPDF) {
        try {
          const buffer = await file.slice(0, 8192).arrayBuffer();
          const text = new TextDecoder().decode(buffer);
          // Chercher le MediaBox du PDF
          const mediaBoxRegex = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/;
          const match = text.match(mediaBoxRegex);
          if (match) {
            const w = Math.abs(parseFloat(match[3]) - parseFloat(match[1]));
            const h = Math.abs(parseFloat(match[4]) - parseFloat(match[2]));
            if (w > h) orientation = 'horizontal';
          }
        } catch (e) {
          console.error("Erreur de lecture PDF", e);
        }
      } else {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            if (img.width > img.height) orientation = 'horizontal';
            resolve(null);
          };
          img.onerror = resolve; // En cas d'erreur de lecture
          img.src = URL.createObjectURL(file);
        });
      }

      if (!isPDF) {
        toast({ title: "Compression", description: "Allègement de l'image en cours..." });
        const options = {
          maxSizeMB: 1, // Max 1MB
          maxWidthOrHeight: 1920,
          useWebWorker: true
        };
        finalFile = await imageCompression(file, options);
      }

      const safeName = file.name ? file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_') : (isPDF ? 'document.pdf' : 'image.jpg');
      const fileName = `archive_${Date.now()}_${params.id}_${safeName}`;

      toast({ title: "Upload", description: `Envoi du ${isPDF ? 'PDF' : 'fichier'} sécurisé...` });
      const { error: uploadError } = await supabase.storage.from('tdt_uploads').upload(fileName, finalFile, {
        contentType: isPDF ? 'application/pdf' : (finalFile as File).type
      });

      if (uploadError) throw new Error("Erreur lors de l'upload.");

      const newFollowUp = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        type: finalType,
        content: file.name,
        url: fileName,
        orientation: orientation
      };

      const currentFollowUps = data.follow_ups || [];
      const { data: updatedData, error: updateError } = await supabase.from('consultations').update({
        follow_ups: [newFollowUp, ...currentFollowUps]
      }).eq('id', params.id).select().single();

      if (updateError) throw updateError;

      if (updatedData) setData(updatedData);
      toast({ title: "Succès", description: "L'image a bien été ajoutée au dossier." });

    } catch (err) {
      console.error(err);
      toast({ title: "Erreur", description: "Impossible d'ajouter l'image.", variant: "destructive" });
    } finally {
      setIsAppending(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleAppendFile = async (e: React.ChangeEvent<HTMLInputElement>, mode: 'bilan' | 'suivi') => {
    if (!e.target.files || e.target.files.length === 0) return;
    setIsAppending(true);
    try {
      const uploadedFiles = [];
      for (const file of Array.from(e.target.files)) {
        const fileName = `doc_${Date.now()}_${params.id}_${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const { error } = await supabase.storage.from('tdt_uploads').upload(fileName, file);
        if (!error) {
          uploadedFiles.push({ fileName, mimeType: file.type });
        }
      }


      if (mode === 'bilan') {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attachedFiles: uploadedFiles,
            previousContext: {
              synthese: data.synthese,
              transcription: data.transcription,
              patientName: data.patient_name || data.patientName || ""
            }
          })
        });

        if (!response.ok) throw new Error("Erreur lors de la mise à jour par l'IA.");
        const result = await response.json();

        const { data: updatedData } = await supabase.from('consultations').update({
          synthese: result.synthese,
          transcription: result.transcription,
          resume: result.resume,
          patient_name: result.patientName || data.patient_name
        }).eq('id', params.id).select().single();

        if (updatedData) setData(updatedData);

      } else {
        // SUIVI
        const analyzeResp = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attachedFiles: uploadedFiles,
          })
        });

        if (!analyzeResp.ok) throw new Error("Erreur d'extraction du document.");
        const { transcription } = await analyzeResp.json();

        const response = await fetch('/api/generate-follow-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcription: transcription,
            previousSynthese: data.synthese
          })
        });

        if (!response.ok) throw new Error("Erreur de génération du suivi.");
        const { content } = await response.json();

        const newFollowUp = {
          id: crypto.randomUUID(),
          date: new Date().toISOString(),
          content: content,
          transcription: transcription
        };

        const currentFollowUps = data.follow_ups || [];
        const { data: updatedData, error: updateError } = await supabase.from('consultations').update({
          follow_ups: [newFollowUp, ...currentFollowUps]
        }).eq('id', params.id).select().single();
        if (updateError) {
          console.error("Supabase update error:", updateError);
          throw new Error("Erreur de sauvegarde dans la base de données.");
        }
        if (updatedData) setData(updatedData);
      }

      // Cleanup post-analyse:      // Cleanup post-analyse: suppression des gros fichiers non-images
      try {
        const filesToDelete = uploadedFiles.filter(f => !f.mimeType.startsWith('image/')).map(f => f.fileName);
        if (filesToDelete.length > 0) {
          await supabase.storage.from('tdt_uploads').remove(filesToDelete);
          console.log("Fichiers temporaires supprimés:", filesToDelete);
        }
      } catch (e) {
        console.error("Erreur suppression fichiers:", e);
      }

      toast({ title: "Bilan mis à jour", description: "Le document a bien été ajouté au dossier." });

    } catch (err) {
      console.error(err);
      toast({ title: "Erreur", description: "Une erreur est survenue lors de l'ajout du document.", variant: "destructive" });
    } finally {
      setIsAppending(false);
    }
  };

  const handleAppendRecording = async (audioBlob: Blob) => {
    setIsAppending(true);
    setIsRecordingModalOpen(false); // Ferme le modal d'enregistrement

    try {
      const fileName = `audio_addendum_${Date.now()}_${params.id}.webm`;
      const { error: uploadError } = await supabase.storage.from('tdt_uploads').upload(fileName, audioBlob, { contentType: audioBlob.type });

      if (uploadError) throw new Error("Erreur upload audio addendum");


      if (appendMode === 'bilan') {
        toast({ title: "Analyse en cours...", description: "Fusion des nouvelles informations avec le bilan existant." });
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioFile: { fileName, mimeType: audioBlob.type },
            previousContext: {
              synthese: data.synthese,
              transcription: data.transcription,
              patientName: data.patient_name || data.patientName || ""
            }
          })
        });

        if (!response.ok) throw new Error("Erreur lors de la mise à jour par l'IA.");
        const result = await response.json();

        const { data: updatedData } = await supabase.from('consultations').update({
          synthese: result.synthese,
          transcription: result.transcription,
          resume: result.resume,
          patient_name: result.patientName || data.patient_name
        }).eq('id', params.id).select().single();

        if (updatedData) setData(updatedData);

      } else {
        toast({ title: "Analyse en cours...", description: "Création de la note de suivi chronologique..." });

        const analyzeResp = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioFile: { fileName, mimeType: audioBlob.type },
          })
        });

        if (!analyzeResp.ok) throw new Error("Erreur d'extraction audio.");
        const { transcription } = await analyzeResp.json();

        const response = await fetch('/api/generate-follow-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcription: transcription,
            previousSynthese: data.synthese
          })
        });

        if (!response.ok) throw new Error("Erreur de génération.");
        const { content } = await response.json();

        const newFollowUp = {
          id: crypto.randomUUID(),
          date: new Date().toISOString(),
          content: content,
          transcription: transcription
        };

        const currentFollowUps = data.follow_ups || [];
        const { data: updatedData, error: updateError } = await supabase.from('consultations').update({
          follow_ups: [newFollowUp, ...currentFollowUps]
        }).eq('id', params.id).select().single();
        if (updateError) {
          console.error("Supabase update error:", updateError);
          throw new Error("Erreur de sauvegarde dans la base de données.");
        }
        if (updatedData) setData(updatedData);
      }

      // Cleanup post-analyse: suppression du fichier audio      // Cleanup post-analyse: suppression du fichier audio
      try {
        await supabase.storage.from('tdt_uploads').remove([fileName]);
        console.log("Fichier audio temporaire supprimé:", fileName);
      } catch (e) {
        console.error("Erreur suppression fichier audio:", e);
      }

      toast({ title: "Bilan mis à jour", description: "L'enregistrement a bien été ajouté au dossier." });

    } catch (err) {
      console.error(err);
      toast({ title: "Erreur", description: "Impossible d'ajouter l'enregistrement.", variant: "destructive" });
    } finally {
      setIsAppending(false);
    }
  };

  const handleAppendText = async () => {
    if (!textContent.trim()) return;
    setIsAppending(true);
    setIsTextModalOpen(false);

    try {
      const textBlob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
      const fileName = `txt_addendum_${Date.now()}_${params.id}.txt`;
      const { error: uploadError } = await supabase.storage.from('tdt_uploads').upload(fileName, textBlob);

      if (uploadError) throw new Error("Erreur upload text addendum");

      const uploadedFiles = [{ fileName, mimeType: 'text/plain' }];

      if (appendMode === 'bilan') {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attachedFiles: uploadedFiles,
            previousContext: {
              synthese: data.synthese,
              transcription: data.transcription,
              patientName: data.patient_name || data.patientName || ""
            }
          })
        });

        if (!response.ok) throw new Error("Erreur lors de la mise à jour par l'IA.");
        const result = await response.json();

        const { data: updatedData } = await supabase.from('consultations').update({
          synthese: result.synthese,
          transcription: result.transcription,
          resume: result.resume,
          patient_name: result.patientName || data.patient_name
        }).eq('id', params.id).select().single();

        if (updatedData) setData(updatedData);

      } else {
        toast({ title: "Analyse en cours...", description: "Création de la note de suivi chronologique..." });

        const analyzeResp = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attachedFiles: uploadedFiles,
          })
        });

        if (!analyzeResp.ok) throw new Error("Erreur d'extraction texte.");
        const { transcription } = await analyzeResp.json();

        const response = await fetch('/api/generate-follow-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcription: transcription,
            previousSynthese: data.synthese
          })
        });

        if (!response.ok) throw new Error("Erreur de génération.");
        const { content } = await response.json();

        const newFollowUp = {
          id: crypto.randomUUID(),
          date: new Date().toISOString(),
          content: content,
          transcription: transcription
        };

        const currentFollowUps = data.follow_ups || [];
        const { data: updatedData, error: updateError } = await supabase.from('consultations').update({
          follow_ups: [newFollowUp, ...currentFollowUps]
        }).eq('id', params.id).select().single();

        if (updateError) {
          console.error("Supabase update error:", updateError);
          throw new Error("Erreur de sauvegarde dans la base de données.");
        }
        if (updatedData) setData(updatedData);
      }

      try {
        await supabase.storage.from('tdt_uploads').remove([fileName]);
      } catch (e) {
        console.error("Erreur suppression fichier texte:", e);
      }

      toast({ title: "Bilan mis à jour", description: "La note écrite a bien été ajoutée au dossier." });
      setTextContent(""); // Reset textarea

    } catch (err) {
      console.error(err);
      toast({ title: "Erreur", description: "Impossible d'ajouter la note écrite.", variant: "destructive" });
    } finally {
      setIsAppending(false);
    }
  };

  useEffect(() => {
    async function fetchConsultation() {
      if (!params.id) return;
      const { data: consultData, error } = await supabase
        .from("consultations")
        .select("*")
        .eq("id", params.id)
        .single();

      if (error) {
        console.error("Error fetching consultation:", error);
      } else {
        setData(consultData);
        setEditName(consultData?.patient_name || consultData?.patientName || `Patient #${consultData?.id}`);
        if (consultData?.date) {
          // Format datetime-local requires YYYY-MM-DDTHH:mm
          const d = new Date(consultData.date);
          // Adjust to local time format for input
          const localIso = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
          setEditDate(localIso);
        }
      }
      setLoading(false);
    }

    fetchConsultation();
  }, [params.id]);

  useEffect(() => {
    if (!params.id) return;
    async function fetchDocs() {
      try {
        const { data: listData, error: listError } = await supabase.storage.from('tdt_uploads').list('', { search: params.id as string });
        if (listError || !listData) return;

        const docs = listData.filter(f => f.name.includes('doc_') && f.name.includes(params.id as string));

        const loadedDocs = await Promise.all(docs.map(async (f) => {
          const { data: fileData } = await supabase.storage.from('tdt_uploads').download(f.name);
          if (!fileData) return null;

          const url = URL.createObjectURL(fileData);
          const nameParts = f.name.split('_');
          const originalName = nameParts.slice(3).join('_') || f.name;

          let type: 'image' | 'pdf' | 'other' = 'other';
          const lower = f.name.toLowerCase();
          if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) type = 'image';
          else if (lower.endsWith('.pdf')) type = 'pdf';

          return { name: f.name, originalName, url, type };
        }));

        setAttachedDocs(loadedDocs.filter(Boolean) as any);
      } catch (e) {
        console.error(e);
      }
    }
    fetchDocs();
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <Loader2 className="w-12 h-12 text-[#bd613c] animate-spin mb-4" />
        <p className="text-[#4a3f35]">Chargement du bilan...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center space-y-4">
        <h1 className="text-2xl font-bold text-red-500">Bilan introuvable</h1>
        <p className="text-slate-500">Cette consultation n&apos;existe pas ou a été supprimée.</p>
        <Button onClick={() => router.push("/")} variant="outline">
          Retour à l&apos;accueil
        </Button>
      </div>
    );
  }

  return (
    <main className="min-h-screen py-8 px-4 sm:px-6 mb-12 flex justify-center">

      {/* Modal d'enregistrement audio */}
      <Dialog open={isRecordingModalOpen} onOpenChange={(open) => !open && !isAppending ? setIsRecordingModalOpen(false) : null}>
        <DialogContent className="sm:max-w-2xl bg-white border-[#ebd9c8]/30">
          <DialogHeader>
            <DialogTitle className="font-bebas tracking-wide text-3xl text-[#bd613c] uppercase text-center">
              {appendMode === 'bilan' ? 'Mettre à jour le Bilan' : 'Nouvelle Séance de Suivi'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <AudioRecorder
              onRecordingComplete={handleAppendRecording}
              isProcessing={isAppending}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal d'ajout de texte manuel */}
      <Dialog open={isTextModalOpen} onOpenChange={(open) => !open && !isAppending ? setIsTextModalOpen(false) : null}>
        <DialogContent className="sm:max-w-2xl bg-white border-[#ebd9c8]/30">
          <DialogHeader>
            <DialogTitle className="font-bebas tracking-wide text-3xl text-[#bd613c] uppercase text-center">
              {appendMode === 'bilan' ? 'Mettre à jour le Bilan' : 'Nouvelle Note Manuelle'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="relative">
              <textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Saisissez ici les informations de votre consultation..."
                className="w-full min-h-[200px] p-4 pb-14 font-inter text-base rounded-xl border border-[#ebd9c8] focus:border-[#bd613c] focus:ring-1 focus:ring-[#bd613c] outline-none resize-none transition-shadow"
                disabled={isAppending}
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleDictation}
                disabled={isAppending}
                className={`absolute bottom-3 right-3 rounded-full transition-all ${isDictating ? 'bg-red-100 text-red-500 hover:bg-red-200 animate-pulse' : 'bg-[#ebd9c8]/30 text-[#bd613c] hover:bg-[#ebd9c8]/50'}`}
                title={isDictating ? "Arrêter la dictée" : "Démarrer la dictée vocale"}
              >
                {isDictating ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
              </Button>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setIsTextModalOpen(false)} disabled={isAppending} className="text-[#4a3f35]/60 hover:text-[#4a3f35] hover:bg-[#ebd9c8]/20">
                Annuler
              </Button>
              <Button onClick={handleAppendText} disabled={!textContent.trim() || isAppending} className="bg-[#e25822] hover:bg-[#bd613c] text-white px-6">
                {isAppending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-5 h-5 mr-2" />}
                Traiter & Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de changement de séance */}
      <Dialog open={isSessionModalOpen} onOpenChange={setIsSessionModalOpen}>
        <DialogContent className="sm:max-w-md bg-white border-[#ebd9c8]/30">
          <DialogHeader>
            <DialogTitle className="font-bebas tracking-wide text-2xl text-[#bd613c] uppercase text-center">
              Modifier le numéro de séance
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex flex-col items-center gap-3">
              <label className="text-sm font-medium text-[#4a3f35]/80">Nouveau numéro (ex: 15) :</label>
              <input
                type="number"
                min="1"
                value={customSessionNumber}
                onChange={(e) => setCustomSessionNumber(e.target.value ? parseInt(e.target.value, 10) : "")}
                className="w-24 text-center font-bebas text-3xl text-[#bd613c] border-b-2 border-[#ebd9c8] focus:border-[#bd613c] outline-none bg-transparent"
                autoFocus
              />
            </div>
            <div className="flex justify-center gap-3 pt-4">
              <Button variant="ghost" onClick={() => setIsSessionModalOpen(false)} className="text-[#4a3f35]/60 hover:bg-[#ebd9c8]/20">
                Annuler
              </Button>
              <Button onClick={handleSaveSessionOverride} className="bg-[#e25822] hover:bg-[#bd613c] text-white">
                <Check className="w-4 h-4 mr-2" /> Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal d'affichage Image Plein Écran */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-[95vw] lg:max-w-[80vw] max-h-[95vh] p-1 md:p-6 bg-black/95 sm:bg-white border-none sm:border-[#ebd9c8]/30 flex flex-col items-center justify-center">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 text-white sm:text-slate-500 hover:bg-white/20 sm:hover:bg-slate-100 z-50 rounded-full"
            onClick={() => setSelectedImage(null)}
          >
            <XIcon className="w-6 h-6" />
          </Button>
          {selectedImage && (
            <img
              src={supabase.storage.from('tdt_uploads').getPublicUrl(selectedImage).data.publicUrl}
              alt="Image plein écran"
              className="w-auto h-auto max-w-full max-h-[85vh] object-contain rounded-md"
            />
          )}
        </DialogContent>
      </Dialog>

      <div className="w-full max-w-5xl space-y-8 xl:space-y-10">

        <Button
          variant="ghost"
          onClick={() => router.push("/")}
          className="text-[#bd613c] hover:bg-[#ebd9c8]/30 -ml-2 print:hidden"
          data-html2canvas-ignore="true"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Retour aux bilans
        </Button>

        <Tabs defaultValue="synthese" className="w-full">
          <div className="flex flex-col lg:flex-row gap-8 items-start">

            {/* LECTURE ZONE (Notebook) - Gauche (flex-1) */}
            <div id="consultation-export-container" className="flex-1 min-w-0 bg-[#fdfcfb] rounded-2xl p-6 sm:p-10 shadow-sm border border-[#ebd9c8]/50 w-full">

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="font-bebas text-3xl sm:text-4xl text-[#bd613c] tracking-wide uppercase bg-transparent border-b-2 border-[#bd613c] focus:outline-none w-full max-w-sm"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" className="text-green-600 hover:bg-green-50" onClick={handleSaveName}>
                        <Check className="w-5 h-5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => setIsEditing(false)}>
                        <XIcon className="w-5 h-5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 relative group">
                      <h1
                        className="font-bebas text-4xl sm:text-5xl text-[#bd613c] tracking-wide uppercase cursor-pointer hover:bg-[#ebd9c8]/20 transition-colors px-2 -mx-2 rounded-lg"
                        onDoubleClick={() => setIsEditing(true)}
                        title="Double-clic pour modifier"
                      >
                        {data.patient_name || data.patientName || `Patient #${data.id}`}
                      </h1>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 relative group">
                  {isEditingDate ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="datetime-local"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="text-[#4a3f35]/80 font-medium bg-transparent border-b-2 border-[#bd613c] focus:outline-none"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" className="text-green-600 hover:bg-green-50 h-8 w-8" onClick={handleSaveDate}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="text-red-500 hover:bg-red-50 h-8 w-8" onClick={() => setIsEditingDate(false)}>
                        <XIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p
                        className="text-[#4a3f35]/80 font-medium mb-0 cursor-pointer hover:bg-[#ebd9c8]/20 transition-colors px-2 -mx-2 rounded-lg"
                        onDoubleClick={() => {
                          const d = new Date(data.date);
                          const localIso = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                          setEditDate(localIso);
                          setIsEditingDate(true);
                        }}
                        title="Double-clic pour modifier l'heure"
                      >
                        {format(new Date(data.date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* --- MOBILE ONLY CONTROLS --- */}
              <div className="flex flex-col lg:hidden mt-8 gap-8" data-html2canvas-ignore="true">

                {/* Actions Centrales Horizontales */}
                <div className="flex flex-wrap justify-center items-center gap-2 sm:gap-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-10 px-5 rounded-full text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                        <Mic className="w-4 h-4 mr-2" /> <span className="font-medium text-[13px]">Audio</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-56 bg-white border-[#ebd9c8]">
                      <DropdownMenuItem onClick={() => { setAppendMode('bilan'); setIsRecordingModalOpen(true); }} className="cursor-pointer py-3 flex items-center hover:bg-[#ebd9c8]/20 transition-colors rounded-lg">
                        <span className="text-xl mr-3 opacity-80">🔄</span>
                        <span className="font-medium text-[15px] text-slate-700">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setAppendMode('suivi'); setIsRecordingModalOpen(true); }} className="cursor-pointer py-3 flex items-center mt-1 bg-[#ebd9c8]/10 hover:bg-[#ebd9c8]/30 transition-colors rounded-lg text-[#bd613c] shadow-sm border border-[#bd613c]/10">
                        <span className="text-xl mr-3">📝</span>
                        <span className="font-medium text-[15px]">Nouvelle Note de Suivi</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Nouveau bouton Texte */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-10 px-5 rounded-full text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                        <Pencil className="w-4 h-4 mr-2" /> <span className="font-medium text-[13px]">Texte</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-56 bg-white border-[#ebd9c8]">
                      <DropdownMenuItem onClick={() => { setAppendMode('bilan'); setIsTextModalOpen(true); }} className="cursor-pointer py-3 flex items-center hover:bg-[#ebd9c8]/20 transition-colors rounded-lg">
                        <span className="text-xl mr-3 opacity-80">🔄</span>
                        <span className="font-medium text-[15px] text-slate-700">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setAppendMode('suivi'); setIsTextModalOpen(true); }} className="cursor-pointer py-3 flex items-center mt-1 bg-[#ebd9c8]/10 hover:bg-[#ebd9c8]/30 transition-colors rounded-lg text-[#bd613c] shadow-sm border border-[#bd613c]/10">
                        <span className="text-xl mr-3">📝</span>
                        <span className="font-medium text-[15px]">Nouvelle Note de Suivi</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-10 px-5 rounded-full text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                        {isAppending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Paperclip className="w-4 h-4 mr-2" />}
                        <span className="font-medium text-[13px]">Document</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-56 bg-white border-[#ebd9c8]">
                      <DropdownMenuItem onClick={() => fileInputRefBilanMobile.current?.click()} className="cursor-pointer py-3 flex items-center hover:bg-[#ebd9c8]/20 transition-colors rounded-lg">
                        <span className="text-xl mr-3 opacity-80">🔄</span>
                        <span className="font-medium text-[15px] text-slate-700">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => fileInputRefSuiviMobile.current?.click()} className="cursor-pointer py-3 flex items-center mt-1 bg-[#ebd9c8]/10 hover:bg-[#ebd9c8]/30 transition-colors rounded-lg text-[#bd613c] shadow-sm border border-[#bd613c]/10">
                        <span className="text-xl mr-3">📝</span>
                        <span className="font-medium text-[15px]">Nouvelle Note de Suivi</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Nouveau bouton Image Mobile */}
                  <Button variant="outline" className="h-10 px-5 rounded-full text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending} onClick={() => fileInputRefImageMobile.current?.click()}>
                    <ImageIcon className="w-4 h-4 mr-2" /> <span className="font-medium text-[13px]">Doc Visuel</span>
                  </Button>

                  <input type="file" ref={fileInputRefBilanMobile} className="hidden" onChange={(e) => handleAppendFile(e, 'bilan')} multiple />
                  <input type="file" ref={fileInputRefSuiviMobile} className="hidden" onChange={(e) => handleAppendFile(e, 'suivi')} multiple />
                  <input type="file" ref={fileInputRefImageMobile} className="hidden" accept="image/*,application/pdf" onChange={(e) => handleAppendImage(e)} />
                </div>

                {/* Documents Associés Mobile */}
                {attachedDocs && attachedDocs.length > 0 && (
                  <Card className="p-5 border-[#bd613c]/20 shadow-sm bg-white/50 border">
                    <h2 className="text-lg font-bebas tracking-wide text-[#bd613c] uppercase mb-4 flex items-center border-b border-[#ebd9c8] pb-2">
                      <ImageIcon className="w-5 h-5 mr-2" /> Documents Associés
                    </h2>
                    <div className="flex flex-wrap gap-3">
                      {attachedDocs.map((doc, idx) => (
                        <a key={idx} href={doc.url} target="_blank" rel="noopener noreferrer" className="block relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-[#bd613c]/20 bg-[#ebd9c8]/10 hover:shadow-md transition-all">
                          {doc.type === 'image' ? (
                            <img src={doc.url} alt={doc.originalName} className="object-cover w-full h-full" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-[#bd613c] p-2 text-center">
                              <FileText className="w-6 h-6 mb-1 opacity-80" />
                              <span className="text-[9px] leading-tight font-medium truncate w-full px-1">{doc.originalName}</span>
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  </Card>
                )}

                {/* TabsList Mobile (Horizontale à 3 colonnes) */}
                <TabsList className="grid grid-cols-4 w-full bg-[#ebd9c8]/30 p-1.5 rounded-xl h-auto">
                  <TabsTrigger value="synthese" className="text-[11px] sm:text-sm data-[state=active]:bg-[#bd613c] data-[state=active]:text-white rounded-lg py-2 transition-all font-medium">Synthèse</TabsTrigger>
                  <TabsTrigger value="notes" className="text-[11px] sm:text-sm data-[state=active]:bg-[#bd613c] data-[state=active]:text-white rounded-lg py-2 transition-all font-medium">Résumé</TabsTrigger>
                  <TabsTrigger value="transcription" className="text-[11px] sm:text-sm data-[state=active]:bg-[#bd613c] data-[state=active]:text-white rounded-lg py-2 transition-all font-medium">Dialogue</TabsTrigger>
                  <TabsTrigger value="suivi" className="text-[11px] sm:text-sm data-[state=active]:bg-[#bd613c] data-[state=active]:text-white rounded-lg py-2 transition-all font-medium">Suivi</TabsTrigger>
                </TabsList>
              </div>
              {/* --- END MOBILE ONLY --- */}

              {/* TABS CONTENT */}
              <TabsContent value="synthese" className="mt-8 lg:border-t border-[#ebd9c8]/50 lg:pt-8 print:border-none print:mt-4 print:pt-4">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <FileText className="w-6 h-6 text-[#bd613c]" />
                    <h2 className="font-bebas text-3xl tracking-wide text-[#bd613c] uppercase mb-0">
                      Synthèse
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {data.synthese && !isEditingBilan && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => handleExportPDF(`bilan_${data.patient_name || 'patient'}`)} className="text-[#bd613c] hover:bg-[#ebd9c8]/30 print:hidden h-8 px-3 rounded-lg" data-html2canvas-ignore="true">
                          <Share className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline text-sm font-medium">Exporter PDF</span>
                        </Button>
                      </>
                    )}
                    {isEditingBilan && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setIsEditingBilan(false)} className="text-slate-400 hover:text-red-500 hover:bg-red-50 print:hidden h-8 px-3 rounded-lg">
                          <XIcon className="w-4 h-4 mr-2" /> <span className="text-sm font-medium">Annuler</span>
                        </Button>
                        <Button size="sm" onClick={handleSaveBilan} className="bg-green-600 hover:bg-green-700 text-white print:hidden h-8 px-4 rounded-lg">
                          <Check className="w-4 h-4 mr-2" /> <span className="text-sm font-medium">Sauvegarder</span>
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {isEditingBilan ? (
                  <textarea
                    value={editBilanContent}
                    onChange={(e) => setEditBilanContent(e.target.value)}
                    className="w-full min-h-[500px] p-4 font-mono text-sm sm:text-base rounded-xl border border-[#ebd9c8] focus:border-[#bd613c] focus:ring-1 focus:ring-[#bd613c] outline-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                  />
                ) : (
                  <div
                    className="prose prose-sm sm:prose-base prose-stone max-w-none prose-headings:font-bebas prose-headings:text-[#bd613c] prose-headings:tracking-wide prose-p:text-[#4a3f35]/90 prose-strong:text-[#bd613c] prose-li:text-[#4a3f35]/90 prose-h1:text-2xl sm:prose-h1:text-4xl cursor-pointer hover:bg-[#ebd9c8]/10 transition-colors p-4 -m-4 rounded-xl"
                    onDoubleClick={() => { setEditBilanContent(data.synthese); setIsEditingBilan(true); }}
                    title="Double-clic pour modifier"
                  >
                    {data.synthese ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                        {data.synthese}
                      </ReactMarkdown>
                    ) : "Aucune synthèse disponible."}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="notes" className="mt-8 lg:border-t border-[#ebd9c8]/50 lg:pt-8 print:hidden">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <Activity className="w-6 h-6 text-[#bd613c]" />
                    <h2 className="font-bebas text-3xl tracking-wide text-[#bd613c] uppercase mb-0">
                      Résumé Rapide
                    </h2>
                  </div>
                  {data.resume && (
                    <Button variant="ghost" size="sm" onClick={() => handleExportPDF(`resume_${data.patient_name || 'patient'}`)} className="text-[#bd613c] hover:bg-[#ebd9c8]/30 h-8 px-3 rounded-lg" data-html2canvas-ignore="true">
                      <Share className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline text-sm font-medium">Exporter PDF</span>
                    </Button>
                  )}
                </div>
                {isEditingResume ? (
                  <div className="space-y-4">
                    <textarea
                      value={editResumeContent}
                      onChange={(e) => setEditResumeContent(e.target.value)}
                      className="w-full min-h-[300px] p-4 font-mono text-sm sm:text-base rounded-xl border border-[#ebd9c8] focus:border-[#bd613c] focus:ring-1 focus:ring-[#bd613c] outline-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setIsEditingResume(false)} className="text-slate-400 hover:text-red-500 hover:bg-red-50 h-8 px-3 rounded-lg">Annuler</Button>
                      <Button size="sm" onClick={handleSaveResume} className="bg-green-600 hover:bg-green-700 text-white h-8 px-4 rounded-lg">Sauvegarder</Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="prose prose-sm sm:prose-base prose-stone max-w-none prose-headings:font-bebas prose-headings:text-[#bd613c] prose-headings:tracking-wide prose-p:text-[#4a3f35]/80 prose-strong:text-[#bd613c] cursor-pointer hover:bg-[#ebd9c8]/10 transition-colors p-4 -m-4 rounded-xl"
                    onDoubleClick={() => { setEditResumeContent(data.resume || ""); setIsEditingResume(true); }}
                    title="Double-clic pour modifier"
                  >
                    {data.resume ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {data.resume}
                      </ReactMarkdown>
                    ) : "Aucun résumé disponible."}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="transcription" className="mt-8 lg:border-t border-[#ebd9c8]/50 lg:pt-8 print:block">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-6 h-6 text-[#bd613c]" />
                    <h2 className="font-bebas text-3xl tracking-wide text-[#bd613c] uppercase mb-0">
                      Dialogue Brut
                    </h2>
                  </div>
                  {data.transcription && (
                    <Button variant="ghost" size="sm" onClick={() => handleExportPDF(`dialogue_${data.patient_name || 'patient'}`)} className="text-[#bd613c] hover:bg-[#ebd9c8]/30 print:hidden h-8 px-3 rounded-lg" data-html2canvas-ignore="true">
                      <Share className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline text-sm font-medium">Exporter PDF</span>
                    </Button>
                  )}
                </div>
                {isEditingTranscription ? (
                  <div className="space-y-4">
                    <textarea
                      value={editTranscriptionContent}
                      onChange={(e) => setEditTranscriptionContent(e.target.value)}
                      className="w-full min-h-[500px] p-4 font-mono text-sm rounded-xl border border-[#ebd9c8] focus:border-[#bd613c] focus:ring-1 focus:ring-[#bd613c] outline-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setIsEditingTranscription(false)} className="text-slate-400 hover:text-red-500 hover:bg-red-50 h-8 px-3 rounded-lg">Annuler</Button>
                      <Button size="sm" onClick={handleSaveTranscription} className="bg-green-600 hover:bg-green-700 text-white h-8 px-4 rounded-lg">Sauvegarder</Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="prose prose-sm max-w-none text-[#4a3f35]/80 whitespace-pre-wrap font-mono text-xs prose-strong:text-[#bd613c] cursor-pointer hover:bg-[#ebd9c8]/10 transition-colors p-4 -m-4 rounded-xl"
                    onDoubleClick={() => { setEditTranscriptionContent(data.transcription || ""); setIsEditingTranscription(true); }}
                    title="Double-clic pour modifier"
                  >
                    {data.transcription ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                        {data.transcription}
                      </ReactMarkdown>
                    ) : "Aucune transcription disponible."}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="suivi" className="mt-8 lg:border-t border-[#ebd9c8]/50 lg:pt-8 print:block">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <Activity className="w-6 h-6 text-[#bd613c]" />
                    <h2 className="font-bebas text-3xl tracking-wide text-[#bd613c] uppercase mb-0">
                      Notes de Suivi Chronologique
                    </h2>
                  </div>
                </div>

                {!data.follow_ups || data.follow_ups.length === 0 ? (
                  <div className="text-center py-12 bg-[#ebd9c8]/10 rounded-2xl border border-dashed border-[#ebd9c8]">
                    <Activity className="w-12 h-12 text-[#bd613c]/40 mx-auto mb-3" />
                    <p className="text-[#4a3f35]/60 font-medium">Aucune note de suivi pour le moment.</p>
                    <p className="text-sm text-[#4a3f35]/40 mt-1">Ajoutez un audio ou document pour créer le premier suivi.</p>
                  </div>
                ) : (
                  <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-[#ebd9c8] before:to-transparent">
                    {(() => {
                      // Group follow_ups by day (YYYY-MM-DD)
                      const grouped = data.follow_ups.reduce((acc: any, note: any) => {
                        if (!note.date) return acc;
                        const dayStr = new Date(note.date).toISOString().split('T')[0];
                        if (!acc[dayStr]) acc[dayStr] = [];
                        acc[dayStr].push(note);
                        return acc;
                      }, {});

                      // Determine the absolute session number based on all unique dates of interaction
                      const extractExplicitSession = (text: string | null | undefined): number | null => {
                        if (!text) return null;
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

                      const allDates = new Set<string>();
                      let maxExplicitOffset = 0;
                      let maxExplicitIndex = -1;

                      if (data.date) {
                        try {
                          const dStr = new Date(data.date).toISOString().split('T')[0];
                          allDates.add(dStr);
                          const num = extractExplicitSession(data.resume) || extractExplicitSession(data.synthese);
                          if (num) {
                            maxExplicitOffset = num;
                            maxExplicitIndex = 0;
                          }
                        } catch (e) {
                          console.error("Invalid Bilan date", e);
                        }
                      }

                      Object.keys(grouped).forEach(dayStr => allDates.add(dayStr));
                      const sortedAllDates = Array.from(allDates).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

                      // Pass 2: check follow-ups for explicit session markers
                      Object.keys(grouped).forEach(dayStr => {
                        const dIdx = sortedAllDates.indexOf(dayStr);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        grouped[dayStr].forEach((note: any) => {
                          let num = null;
                          if (note.type === 'session_override') {
                            num = note.value;
                          } else {
                            num = extractExplicitSession(note.title) || extractExplicitSession(note.content);
                          }
                          if (num && num > maxExplicitOffset) {
                            maxExplicitOffset = num;
                            maxExplicitIndex = dIdx;
                          }
                        });
                      });

                      const getSessionNumberForDay = (dayStr: string) => {
                        const idx = sortedAllDates.indexOf(dayStr);
                        if (maxExplicitOffset > 0 && maxExplicitIndex >= 0) {
                          return maxExplicitOffset + (idx - maxExplicitIndex);
                        }
                        return idx + 1;
                      };

                      const sortedDays = Object.keys(grouped).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

                      return sortedDays.map((dayStr, dayIdx) => (
                        <div key={dayStr} className="relative flex items-start gap-4 md:gap-6 group is-active">
                          {/* Timeline Marker (one per DAY) */}
                          <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-[#bd613c] shadow shrink-0 z-10 mt-4 relative">
                            <Check className="w-4 h-4 text-white" />
                          </div>

                          {/* Card for the DAY */}
                          <div className="flex-1 min-w-0 p-5 rounded-2xl border border-[#ebd9c8]/50 bg-white shadow-sm hover:shadow-md transition-shadow">
                            <h3 className="font-bebas tracking-wide text-lg sm:text-xl text-[#bd613c] mb-3 pb-2 border-b border-[#ebd9c8]/30 flex items-center overflow-hidden">
                              <span className="capitalize truncate flex-1">{format(new Date(dayStr), "EEEE d MMMM yyyy", { locale: fr })}</span>
                              <div className="shrink-0 flex items-center border-l border-[#bd613c]/30 pl-2 ml-2">
                                <span className="text-sm sm:text-base opacity-70">SÉANCE {getSessionNumberForDay(dayStr)}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-[#bd613c] print:hidden"
                                  onClick={() => {
                                    setEditingSessionDay(dayStr);
                                    setCustomSessionNumber(getSessionNumberForDay(dayStr));
                                    setIsSessionModalOpen(true);
                                  }}
                                  title="Modifier la séance"
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                              </div>
                              <span className="shrink-0 text-sm sm:text-base opacity-60 border-l border-[#bd613c]/30 pl-2 ml-2">
                                à {format(new Date(Math.min(...grouped[dayStr].map((n: any) => new Date(n.date).getTime()))), "HH:mm")}
                              </span>
                            </h3>

                            <div className="space-y-6">
                              {grouped[dayStr].filter((n: any) => n.type !== 'session_override').length === 0 ? (
                                <p className="text-xs text-slate-400 italic">Aucune note pour ce jour (Séance enregistrée via l'historique).</p>
                              ) : grouped[dayStr].filter((n: any) => n.type !== 'session_override').map((note: any, noteIdx: number, arr: any[]) => (
                                <div key={note.id || noteIdx} className="relative">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2 mb-2">
                                    <div className="flex items-center -mr-2">
                                      {editingFollowUpId === note.id ? (
                                        <>
                                          <Button size="icon" variant="ghost" className="text-green-600 hover:bg-green-50 h-8 w-8" onClick={() => handleSaveFollowUp(note.id)}>
                                            <Check className="w-4 h-4" />
                                          </Button>
                                          <Button size="icon" variant="ghost" className="text-slate-400 hover:text-red-500 hover:bg-red-50 h-8 w-8" onClick={() => setEditingFollowUpId(null)}>
                                            <XIcon className="w-4 h-4" />
                                          </Button>
                                        </>
                                      ) : (
                                        <>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-slate-400 hover:text-red-500 hover:bg-red-50 h-8 px-2"
                                            onClick={() => handleDeleteFollowUp(note.id)}
                                            title="Supprimer la note"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {editingFollowUpId === note.id ? (
                                    <textarea
                                      value={editFollowUpContent}
                                      onChange={(e) => setEditFollowUpContent(e.target.value)}
                                      className="w-full min-h-[150px] p-3 font-mono text-sm rounded-xl border border-[#ebd9c8] focus:border-[#bd613c] focus:ring-1 focus:ring-[#bd613c] outline-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                                    />
                                  ) : note.type === 'image' ? (
                                    <div className="mt-2 flex flex-col items-center">
                                      <img
                                        src={supabase.storage.from('tdt_uploads').getPublicUrl(note.url).data.publicUrl}
                                        alt={note.content || "Image attachée"}
                                        className="cursor-pointer max-h-64 object-contain rounded-xl border border-[#ebd9c8]/50 shadow-sm hover:shadow transition-shadow"
                                        onClick={() => setSelectedImage(note.url)}
                                      />
                                      {note.content && <p className="text-xs text-slate-500 mt-2">{note.content}</p>}
                                    </div>
                                  ) : note.type === 'pdf' ? (
                                    <div className="mt-2 flex flex-col items-center w-full">
                                      <div className="w-full sm:w-3/4 lg:w-2/3 rounded-xl overflow-hidden border border-[#ebd9c8]/80 shadow-sm relative bg-white flex flex-col">
                                        <div className="bg-slate-50 p-2 px-3 flex justify-between items-center border-b border-[#ebd9c8]/50 z-10">
                                          <span className="text-xs font-medium text-slate-600 flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-[#bd613c]" /> Aperçu du PDF
                                          </span>
                                          <Button variant="outline" size="sm" className="h-7 text-xs bg-white text-[#bd613c] border-[#ebd9c8] hover:bg-slate-50" onClick={() => window.open(supabase.storage.from('tdt_uploads').getPublicUrl(note.url).data.publicUrl, "_blank")}>
                                            <ExternalLink className="w-3 h-3 mr-1" /> Agrandir
                                          </Button>
                                        </div>
                                        <iframe
                                          src={`${supabase.storage.from('tdt_uploads').getPublicUrl(note.url).data.publicUrl}#toolbar=0&navpanes=0&view=FitH`}
                                          className="w-full h-[350px] border-none bg-zinc-100"
                                          title={note.content || "Document PDF"}
                                        />
                                      </div>
                                      {note.content && <p className="text-xs text-slate-500 mt-2">{note.content}</p>}
                                    </div>
                                  ) : (
                                    <div
                                      className="prose prose-sm prose-stone prose-p:text-[#4a3f35]/80 prose-strong:text-[#bd613c] cursor-pointer hover:bg-[#ebd9c8]/10 transition-colors p-3 -m-3 rounded-xl"
                                      onDoubleClick={() => { setEditFollowUpContent(note.content); setEditingFollowUpId(note.id); }}
                                      title="Double-clic pour modifier la note"
                                    >
                                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                        {note.content}
                                      </ReactMarkdown>
                                    </div>
                                  )}
                                  {note.transcription && (
                                    <details className="mt-3 pt-2 border-t border-[#ebd9c8]/30 group/details">
                                      <summary className="text-xs font-medium text-slate-400 hover:text-[#bd613c] cursor-pointer list-none flex items-center gap-1 select-none transition-colors">
                                        <span className="group-open/details:hidden">▶</span><span className="hidden group-open/details:inline">▼</span> Voir la transcription source
                                      </summary>
                                      <div className="mt-2 p-3 bg-slate-50 rounded-lg text-xs font-mono text-slate-500 whitespace-pre-wrap">
                                        {note.transcription}
                                      </div>
                                    </details>
                                  )}

                                  {/* Separator between notes of the same day, except the last one */}
                                  {noteIdx < arr.length - 1 && (
                                    <div className="w-full h-px bg-gradient-to-r from-transparent via-[#ebd9c8]/50 to-transparent my-6" />
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </TabsContent>

            </div>

            {/* BARRE LATERALE (Outils + Docs) - Droite UNIQUEMENT SUR DESKTOP */}
            <div className="hidden lg:flex w-72 shrink-0 flex-col gap-10 print:hidden" data-html2canvas-ignore="true">

              {/* ACTIONS (Audio / Doc) */}
              <div className="space-y-6">
                <h3 className="font-bebas text-xl tracking-wide text-[#bd613c] uppercase">Ajout d&apos;information</h3>

                <div className="flex flex-col gap-5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left h-12 px-4 rounded-xl text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                        <Mic className="w-5 h-5 mr-3 text-[#bd613c]" />
                        <span className="font-medium text-base">Ajouter un Audio</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 p-2 bg-white border-[#ebd9c8]">
                      <DropdownMenuItem onClick={() => { setAppendMode('bilan'); setIsRecordingModalOpen(true); }} className="cursor-pointer py-3 flex items-center rounded-lg hover:bg-[#ebd9c8]/20 transition-colors">
                        <span className="text-xl mr-3 opacity-80">🔄</span>
                        <span className="font-medium text-base text-slate-700">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setAppendMode('suivi'); setIsRecordingModalOpen(true); }} className="cursor-pointer py-3 flex items-center rounded-lg text-[#bd613c] mt-1 bg-[#ebd9c8]/10 hover:bg-[#ebd9c8]/30 transition-colors shadow-sm border border-[#bd613c]/10">
                        <span className="text-xl mr-3">📝</span>
                        <span className="font-medium text-base">Nouvelle Note de Suivi</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left h-12 px-4 rounded-xl text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                        <Pencil className="w-5 h-5 mr-3 text-[#bd613c]" />
                        <span className="font-medium text-base">Ajouter un Texte</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 p-2 bg-white border-[#ebd9c8]">
                      <DropdownMenuItem onClick={() => { setAppendMode('bilan'); setIsTextModalOpen(true); }} className="cursor-pointer py-3 flex items-center rounded-lg hover:bg-[#ebd9c8]/20 transition-colors">
                        <span className="text-xl mr-3 opacity-80">🔄</span>
                        <span className="font-medium text-base text-slate-700">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setAppendMode('suivi'); setIsTextModalOpen(true); }} className="cursor-pointer py-3 flex items-center rounded-lg text-[#bd613c] mt-1 bg-[#ebd9c8]/10 hover:bg-[#ebd9c8]/30 transition-colors shadow-sm border border-[#bd613c]/10">
                        <span className="text-xl mr-3">📝</span>
                        <span className="font-medium text-base">Nouvelle Note de Suivi</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left h-12 px-4 rounded-xl text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                        {isAppending ? <Loader2 className="w-5 h-5 mr-3 animate-spin text-[#bd613c]" /> : <Paperclip className="w-5 h-5 mr-3 text-[#bd613c]" />}
                        <span className="font-medium text-base">{isAppending ? "Traitement..." : "Ajouter un Document"}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 p-2 bg-white border-[#ebd9c8]">
                      <DropdownMenuItem onClick={() => fileInputRefBilanDesktop.current?.click()} className="cursor-pointer py-3 flex items-center rounded-lg hover:bg-[#ebd9c8]/20 transition-colors">
                        <span className="text-xl mr-3 opacity-80">🔄</span>
                        <span className="font-medium text-base text-slate-700">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => fileInputRefSuiviDesktop.current?.click()} className="cursor-pointer py-3 flex items-center rounded-lg text-[#bd613c] mt-1 bg-[#ebd9c8]/10 hover:bg-[#ebd9c8]/30 transition-colors shadow-sm border border-[#bd613c]/10">
                        <span className="text-xl mr-3">📝</span>
                        <span className="font-medium text-base">Nouvelle Note de Suivi</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Nouveau bouton Image Desktop */}
                  <Button variant="outline" className="w-full justify-start text-left h-12 px-4 rounded-xl text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending} onClick={() => fileInputRefImageDesktop.current?.click()}>
                    {isAppending ? <Loader2 className="w-5 h-5 mr-3 animate-spin text-[#bd613c]" /> : <ImageIcon className="w-5 h-5 mr-3 text-[#bd613c]" />}
                    <span className="font-medium text-base">{isAppending ? "Traitement..." : "Doc Visuel (Image / PDF)"}</span>
                  </Button>

                  <input type="file" ref={fileInputRefBilanDesktop} className="hidden" onChange={(e) => handleAppendFile(e, 'bilan')} multiple />
                  <input type="file" ref={fileInputRefSuiviDesktop} className="hidden" onChange={(e) => handleAppendFile(e, 'suivi')} multiple />
                  <input type="file" ref={fileInputRefImageDesktop} className="hidden" accept="image/*,application/pdf" onChange={(e) => handleAppendImage(e)} />
                </div>
              </div>

              {/* TABS (Navigation Verticale) */}
              <div className="space-y-4">
                <h3 className="font-bebas text-xl tracking-wide text-[#bd613c] uppercase">Vues du dossier</h3>
                <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-2 w-full">
                  <TabsTrigger value="synthese" className="w-full justify-start text-left px-4 py-3 rounded-xl bg-[#ebd9c8]/20 data-[state=active]:bg-[#bd613c] data-[state=active]:text-white data-[state=active]:shadow-md transition-all font-medium border border-transparent data-[state=active]:border-[#bd613c] hover:bg-[#ebd9c8]/40">
                    <FileText className="w-4 h-4 mr-3 opacity-70" /> Synthèse
                  </TabsTrigger>
                  <TabsTrigger value="notes" className="w-full justify-start text-left px-4 py-3 rounded-xl bg-[#ebd9c8]/20 data-[state=active]:bg-[#bd613c] data-[state=active]:text-white data-[state=active]:shadow-md transition-all font-medium border border-transparent data-[state=active]:border-[#bd613c] hover:bg-[#ebd9c8]/40">
                    <Activity className="w-4 h-4 mr-3 opacity-70" /> Résumé Rapide
                  </TabsTrigger>
                  <TabsTrigger value="transcription" className="w-full justify-start text-left px-4 py-3 rounded-xl bg-[#ebd9c8]/20 data-[state=active]:bg-[#bd613c] data-[state=active]:text-white data-[state=active]:shadow-md transition-all font-medium border border-transparent data-[state=active]:border-[#bd613c] hover:bg-[#ebd9c8]/40">
                    <MessageSquare className="w-4 h-4 mr-3 opacity-70" /> Dialogue
                  </TabsTrigger>
                  <TabsTrigger value="suivi" className="w-full justify-start text-left px-4 py-3 rounded-xl bg-[#ebd9c8]/20 data-[state=active]:bg-[#bd613c] data-[state=active]:text-white data-[state=active]:shadow-md transition-all font-medium border border-transparent data-[state=active]:border-[#bd613c] hover:bg-[#ebd9c8]/40">
                    <Activity className="w-4 h-4 mr-3 opacity-70" /> Séances de Suivi
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* DOCUMENTS ASSOCIES */}
              {attachedDocs && attachedDocs.length > 0 && (
                <div className="space-y-4">
                  <h3 className="font-bebas text-xl tracking-wide text-[#bd613c] uppercase flex items-center">
                    <ImageIcon className="w-5 h-5 mr-2" /> Fichiers Joints
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {attachedDocs.map((doc, idx) => (
                      <a key={idx} href={doc.url} target="_blank" rel="noopener noreferrer" title={doc.originalName} className="block relative aspect-square rounded-xl overflow-hidden border border-[#bd613c]/20 hover:border-[#bd613c]/50 hover:shadow-md transition-all bg-[#ebd9c8]/10 group/doc">
                        {doc.type === 'image' ? (
                          <img src={doc.url} alt={doc.originalName} className="object-cover w-full h-full group-hover/doc:scale-105 transition-transform duration-300" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-[#bd613c] p-2 text-center group-hover/doc:bg-[#ebd9c8]/30 transition-colors">
                            <FileText className="w-8 h-8 mb-2 opacity-80" />
                            <span className="text-[9px] leading-tight font-medium truncate w-full px-1">{doc.originalName}</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-[#bd613c]/90 opacity-0 group-hover/doc:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                          <span className="text-white text-xs font-medium font-sans px-2 text-center text-balance overflow-hidden break-words">Ouvrir</span>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

            </div>

          </div>
        </Tabs>
      </div>
    </main>
  );
}
