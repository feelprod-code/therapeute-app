require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  const consultId = '8358efd3-4029-45d1-9860-a1761acc86a5';
  console.log("=== Lancement de l'analyse urgente ===");
  
  const { data: consultData, error: consultError } = await supabase.from('consultations').select('*').eq('id', consultId).single();
  const audioFileName = consultData.audio_path;
  
  const { data: audioData, error: audioError } = await supabase.storage.from('tdt_uploads').download(audioFileName);
  let finalMimeType = 'audio/webm';
  if (audioFileName.includes('.m4a')) finalMimeType = 'video/mp4'; 
  
  const tempFilePath = path.join(os.tmpdir(), `urgent-${Date.now()}-${audioFileName}`);
  await fs.writeFile(tempFilePath, Buffer.from(await audioData.arrayBuffer()));
  
  const uploadResult = await ai.files.upload({ file: tempFilePath, config: { mimeType: finalMimeType } });
  await fs.unlink(tempFilePath).catch(()=>{});
  
  let fileInfo = await ai.files.get({ name: uploadResult.name });
  while (fileInfo.state === 'PROCESSING') {
    await new Promise(r => setTimeout(r, 4000));
    fileInfo = await ai.files.get({ name: uploadResult.name });
  }
  if (fileInfo.state === 'FAILED') { console.error("FAILED"); return; }
  
  const systemPrompt = `Tu es un assistant medical expert. Genere un resume court. 
Reponds UNIQUEMENT en JSON: 
{"patientName": "Nom si trouve", "consultationDate": "date trouvée ex: 2024-04-12", "transcription": "Texte exact (mot pour mot)", "resume": "Synthese narrative courte", "synthese": "Analyse detaillee"}`;

  let success = false;
  let attempts = 0;
  while (!success && attempts < 5) {
    try {
      console.log(`Tentative de génération API Gemini... (${attempts+1}/5)`);
      const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [ { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType } } ] }],
          config: { systemInstruction: systemPrompt, responseMimeType: 'application/json' }
      });
      const analyzeData = JSON.parse(response.text);
      await supabase.from('consultations').update({
            patient_name: analyzeData.patientName || "Patient Anonyme (récupéré)",
            resume: analyzeData.resume || "",
            synthese: analyzeData.synthese,
            transcription: analyzeData.transcription || "",
      }).eq('id', consultId);
      console.log("MISE A JOUR REUSSIE POUR", analyzeData.patientName);
      success = true;
    } catch(err) {
      console.error("Erreur Gemini (503 probable):", err.message);
      attempts++;
      await new Promise(r => setTimeout(r, 8000));
    }
  }
}
run().catch(console.error);
