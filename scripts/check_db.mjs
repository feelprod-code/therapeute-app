import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  "https://eqcjgucfpmhvxkckokwb.supabase.co",
  "sb_publishable_XF36y_L5L1WiQgSLfDyOGw_jP6NSSDa"
);

async function checkData() {
  const { data: c, error } = await supabase
    .from('consultations')
    .select('*')
    .eq('id', '90050536-c2e5-4ba4-a39a-18f1df14772d')
    .single();
  
  if (error) {
    console.error("Error:", error);
    return;
  }

  console.log("=== 1. INITIAL TRANSCRIPTION ===");
  console.log(c.transcription);

  console.log("\n=== 2. CURRENT SYNTHESE (BILAN) ===");
  console.log(c.synthese);

  console.log("\n=== 3. FOLLOW_UPS ARRAY ===");
  console.log("Count:", c.follow_ups?.length || 0);
  (c.follow_ups || []).forEach((f, idx) => {
    console.log(`\n--- Follow Up #${idx + 1} (Type: ${f.type}, Date: ${f.date}, Audio: ${f.audio_path}) ---`);
    console.log("Note / Summary:", f.note);
    console.log("Transcription:", f.transcription);
  });
}

checkData();



