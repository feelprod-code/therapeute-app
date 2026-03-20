"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Loader2, FileText, Activity, Printer, Share, Pencil, Check, X as XIcon, MessageSquare, Mic, Paperclip, Image as ImageIcon } from "lucide-react";
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

  // Nouveaux états pour le suivi chronologique
  const [appendMode, setAppendMode] = useState<'bilan' | 'suivi'>('bilan');
  const fileInputRefBilanMobile = useRef<HTMLInputElement>(null);
  const fileInputRefSuiviMobile = useRef<HTMLInputElement>(null);
  const fileInputRefBilanDesktop = useRef<HTMLInputElement>(null);
  const fileInputRefSuiviDesktop = useRef<HTMLInputElement>(null);

  const [attachedDocs, setAttachedDocs] = useState<{ name: string, originalName: string, url: string, type: 'image' | 'pdf' | 'other' }[] | null>(null);

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
        const { data: updatedData } = await supabase.from('consultations').update({
          follow_ups: [newFollowUp, ...currentFollowUps]
        }).eq('id', params.id).select().single();

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
        const { data: updatedData } = await supabase.from('consultations').update({
          follow_ups: [newFollowUp, ...currentFollowUps]
        }).eq('id', params.id).select().single();

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

      {/* MODAL AUDIO GÉRÉ GLOBALEMENT POUR EVITER LES DOUBLONS SUR MOBILE/DESKTOP */}
      <Dialog open={isRecordingModalOpen} onOpenChange={setIsRecordingModalOpen}>
        <DialogContent className="sm:max-w-xl bg-white border-[#ebd9c8]/30">
          <DialogHeader>
            <DialogTitle className="font-bebas tracking-wide text-3xl text-[#bd613c] uppercase text-center mb-4">
              Ajouter au dossier
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <AudioRecorder onRecordingComplete={handleAppendRecording} isProcessing={isAppending} />
          </div>
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
                      <h1 className="font-bebas text-4xl sm:text-5xl text-[#bd613c] tracking-wide uppercase">
                        {data.patient_name || data.patientName || `Patient #${data.id}`}
                      </h1>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-[#bd613c] print:hidden"
                        onClick={() => setIsEditing(true)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
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
                      <p className="text-[#4a3f35]/80 font-medium mb-0">
                        {format(new Date(data.date), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
                      </p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-[#bd613c] print:hidden h-6 w-6 ml-1"
                        onClick={() => {
                          const d = new Date(data.date);
                          const localIso = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                          setEditDate(localIso);
                          setIsEditingDate(true);
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* --- MOBILE ONLY CONTROLS (Comme avant le refactoring) --- */}
              <div className="flex flex-col lg:hidden mt-8 gap-8" data-html2canvas-ignore="true">

                {/* Actions Centrales Horizontales */}
                <div className="flex justify-center items-center gap-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-10 px-5 rounded-full text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                        <Mic className="w-4 h-4 mr-2" /> <span className="font-medium text-[13px]">Audio</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-56 bg-white border-[#ebd9c8]">
                      <DropdownMenuItem onClick={() => { setAppendMode('bilan'); setIsRecordingModalOpen(true); }} className="cursor-pointer py-3">
                        <span className="font-medium">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setAppendMode('suivi'); setIsRecordingModalOpen(true); }} className="cursor-pointer py-3 text-[#bd613c]">
                        <span className="font-medium">📝 Nouvelle Note de Suivi</span>
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
                      <DropdownMenuItem onClick={() => fileInputRefBilanMobile.current?.click()} className="cursor-pointer py-3">
                        <span className="font-medium">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => fileInputRefSuiviMobile.current?.click()} className="cursor-pointer py-3 text-[#bd613c]">
                        <span className="font-medium">📝 Nouvelle Note de Suivi</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <input type="file" ref={fileInputRefBilanMobile} className="hidden" onChange={(e) => handleAppendFile(e, 'bilan')} multiple />
                  <input type="file" ref={fileInputRefSuiviMobile} className="hidden" onChange={(e) => handleAppendFile(e, 'suivi')} multiple />
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
                  {data.synthese && (
                    <Button variant="ghost" size="sm" onClick={() => handleExportPDF(`bilan_${data.patient_name || 'patient'}`)} className="text-[#bd613c] hover:bg-[#ebd9c8]/30 print:hidden h-8 px-3 rounded-lg" data-html2canvas-ignore="true">
                      <Share className="w-4 h-4 sm:mr-2" /> <span className="hidden sm:inline text-sm font-medium">Exporter PDF</span>
                    </Button>
                  )}
                </div>
                <div className="prose prose-sm sm:prose-base prose-stone max-w-none prose-headings:font-bebas prose-headings:text-[#bd613c] prose-headings:tracking-wide prose-p:text-[#4a3f35]/90 prose-strong:text-[#bd613c] prose-li:text-[#4a3f35]/90 prose-h1:text-2xl sm:prose-h1:text-4xl">
                  {data.synthese ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {data.synthese}
                    </ReactMarkdown>
                  ) : "Aucune synthèse disponible."}
                </div>
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
                <div className="prose prose-sm sm:prose-base prose-stone max-w-none prose-headings:font-bebas prose-headings:text-[#bd613c] prose-headings:tracking-wide prose-p:text-[#4a3f35]/80 prose-strong:text-[#bd613c]">
                  {data.resume ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {data.resume}
                    </ReactMarkdown>
                  ) : "Aucun résumé disponible."}
                </div>
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
                <div className="prose prose-sm max-w-none text-[#4a3f35]/80 whitespace-pre-wrap font-mono text-xs prose-strong:text-[#bd613c]">
                  {data.transcription ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {data.transcription}
                    </ReactMarkdown>
                  ) : "Aucune transcription disponible."}
                </div>
              </TabsContent>

            </div>

            {/* BARRE LATERALE (Outils + Docs) - Droite UNIQUEMENT SUR DESKTOP */}
            <div className="hidden lg:flex w-72 shrink-0 flex-col gap-10 print:hidden" data-html2canvas-ignore="true">

              {/* ACTIONS (Audio / Doc) */}
              <div className="space-y-4">
                <h3 className="font-bebas text-xl tracking-wide text-[#bd613c] uppercase">Ajout d&apos;information</h3>

                <div className="flex flex-col gap-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left h-12 px-4 rounded-xl text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                        <Mic className="w-5 h-5 mr-3 text-[#bd613c]" />
                        <span className="font-medium text-base">Ajouter un Audio</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 p-2 bg-white border-[#ebd9c8]">
                      <DropdownMenuItem onClick={() => { setAppendMode('bilan'); setIsRecordingModalOpen(true); }} className="cursor-pointer py-3 rounded-lg">
                        <span className="font-medium text-base">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setAppendMode('suivi'); setIsRecordingModalOpen(true); }} className="cursor-pointer py-3 rounded-lg text-[#bd613c] mt-1 bg-[#ebd9c8]/10">
                        <span className="font-medium text-base">📝 Nouvelle Note de Suivi</span>
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
                      <DropdownMenuItem onClick={() => fileInputRefBilanDesktop.current?.click()} className="cursor-pointer py-3 rounded-lg">
                        <span className="font-medium text-base">Mettre à jour le Bilan</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => fileInputRefSuiviDesktop.current?.click()} className="cursor-pointer py-3 rounded-lg text-[#bd613c] mt-1 bg-[#ebd9c8]/10">
                        <span className="font-medium text-base">📝 Nouvelle Note de Suivi</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <input type="file" ref={fileInputRefBilanDesktop} className="hidden" onChange={(e) => handleAppendFile(e, 'bilan')} multiple />
                  <input type="file" ref={fileInputRefSuiviDesktop} className="hidden" onChange={(e) => handleAppendFile(e, 'suivi')} multiple />
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
