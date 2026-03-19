const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read the credentials directly from the .env.local file to avoid hardcoding here
const envContent = fs.readFileSync('/Users/philippeguillaume/ANTIGRAVITY/therapeute-app copie/.env.local', 'utf-8');
const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL="(.*?)"/);
const keyMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY="(.*?)"/);

const supabaseUrl = urlMatch[1];
const supabaseKey = keyMatch[1];

const supabase = createClient(supabaseUrl, supabaseKey);

const fileName = 'audio_1773759163660_3974c09b-9e02-40ba-979e-9439afd4e00a.webm';
const consultId = '3974c09b-9e02-40ba-979e-9439afd4e00a';

async function updateDB() {
  console.log(`Updating consultation ${consultId} with audio_path: ${fileName}`);
  const { data, error } = await supabase.from('consultations').update({ audio_path: fileName }).eq('id', consultId);
  
  if (error) {
    console.error("DB Update Error:", error.message);
  } else {
    console.log("DB Updated successfully!");
  }
}

updateDB();
