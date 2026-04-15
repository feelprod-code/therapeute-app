import re

with open("src/app/consultation/[id]/page.tsx", "r") as f:
    text = f.read()

parts = text.split('  return (\n    <main className="min-h-screen py-8 px-4 sm:px-6 mb-12 flex justify-center">')

if len(parts) == 2:
    top_part = parts[0]
else:
    # Just in case the exact string wasn't matched
    raise Exception("Could not find the split point.")

jsx = """  return (
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
                  <Button variant="outline" onClick={() => setIsRecordingModalOpen(true)} className="h-10 px-5 rounded-full text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all" disabled={isAppending}>
                    <Mic className="w-4 h-4 mr-2" /> <span className="font-medium text-sm">Audio</span>
                  </Button>

                  <div className="relative">
                    <input type="file" id="append-file-mobile" className="hidden" onChange={handleAppendFile} disabled={isAppending} multiple />
                    <Button asChild variant="outline" className="h-10 px-5 rounded-full text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all cursor-pointer">
                      <label htmlFor="append-file-mobile" className="flex items-center w-full">
                        {isAppending ? <Loader2 className="w-4 h-4 mr-2 animate-spin text-[#bd613c]" /> : <Paperclip className="w-4 h-4 mr-2 text-[#bd613c]" />}
                        <span className="font-medium text-sm">Document</span>
                      </label>
                    </Button>
                  </div>
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
                <TabsList className="grid grid-cols-3 w-full bg-[#ebd9c8]/30 p-1.5 rounded-xl h-auto">
                  <TabsTrigger value="synthese" className="text-[11px] sm:text-sm data-[state=active]:bg-[#bd613c] data-[state=active]:text-white rounded-lg py-2 transition-all font-medium">Synthèse</TabsTrigger>
                  <TabsTrigger value="notes" className="text-[11px] sm:text-sm data-[state=active]:bg-[#bd613c] data-[state=active]:text-white rounded-lg py-2 transition-all font-medium">Résumé</TabsTrigger>
                  <TabsTrigger value="transcription" className="text-[11px] sm:text-sm data-[state=active]:bg-[#bd613c] data-[state=active]:text-white rounded-lg py-2 transition-all font-medium">Dialogue</TabsTrigger>
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
                 <h3 className="font-bebas text-xl tracking-wide text-[#bd613c] uppercase">Ajout d'information</h3>
                 
                 <div className="flex flex-col gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setIsRecordingModalOpen(true)}
                      className="w-full justify-start text-left h-12 px-4 rounded-xl text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all"
                      disabled={isAppending}
                    >
                      <Mic className="w-5 h-5 mr-3 text-[#bd613c]" />
                      <span className="font-medium text-base">Ajouter un Audio</span>
                    </Button>

                    <div className="relative">
                      <input
                        type="file"
                        id="append-file-desktop"
                        className="hidden"
                        onChange={handleAppendFile}
                        disabled={isAppending}
                        multiple
                      />
                      <Button
                        asChild
                        variant="outline"
                        className="w-full justify-start text-left h-12 px-4 rounded-xl text-[#bd613c] border-[#ebd9c8] bg-white shadow-sm hover:shadow hover:-translate-y-0.5 transition-all cursor-pointer"
                      >
                        <label htmlFor="append-file-desktop" className="flex items-center w-full">
                          {isAppending ? (
                            <Loader2 className="w-5 h-5 mr-3 animate-spin text-[#bd613c]" />
                          ) : (
                            <Paperclip className="w-5 h-5 mr-3 text-[#bd613c]" />
                          )}
                          <span className="font-medium text-base">{isAppending ? "Traitement..." : "Ajouter un Document"}</span>
                        </label>
                      </Button>
                    </div>
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
"""

with open("src/app/consultation/[id]/page.tsx", "w") as f:
    f.write(top_part + jsx)
