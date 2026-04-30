import fs from 'fs/promises';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function test() {
  const textContent = "Patient Test. A mal au ventre depuis 3 jours. Traitement: Aucun.";
  const extension = "txt";
  const audioFileName = `audio_${Date.now()}_test.${extension}`;

  const audioBlob = new Blob([textContent], { type: 'text/plain' });
  const arrayBuffer = await audioBlob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from('tdt_uploads')
    .upload(audioFileName, buffer, { contentType: 'text/plain' });

  if (uploadError) {
    console.error("Upload error", uploadError);
    return;
  }

  console.log("Upload OK", audioFileName);

  const res = await fetch("http://localhost:3001/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioFile: { fileName: audioFileName, mimeType: "text/plain" },
      attachedFiles: []
    })
  });

  const body = await res.text();
  console.log("API Status:", res.status);
  console.log("API Response:", body);
}

test();
