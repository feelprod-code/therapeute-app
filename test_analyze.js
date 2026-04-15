require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  const consultId = '13fb3905-b300-4d91-990d-79e5bc54b92b';
  console.log("Downloading audio for", consultId);
  
  // get audio path
  const { data: consultData } = await supabase.from('consultations').select('*').eq('id', consultId).single();
  const filePath = consultData.audio_path;
  console.log("Audio path:", filePath);
  
  if (!filePath) { console.log("NO FILE PATH"); return; }
  
  const { data, error } = await supabase.storage.from('tdt_uploads').download(filePath);
  if (error) { console.error("Download err", error); return; }
  
  console.log("Downloaded size:", data.size);
  
  // Here we would call Gemini but let's just see if this works.
}
run().catch(console.error);
