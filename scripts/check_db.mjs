import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  "https://eqcjgucfpmhvxkckokwb.supabase.co",
  "sb_publishable_XF36y_L5L1WiQgSLfDyOGw_jP6NSSDa"
);

async function checkData() {
  console.log("--- DERNIÈRES CONSULTATIONS ---");
  const { data: consults, error: errC } = await supabase
    .from('consultations')
    .select('id, patient_name, created_at, transcription, synthese')
    .order('created_at', { ascending: false })
    .limit(3);
  
  if (errC) console.error("Erreur DB:", errC);
  else {
    consults.forEach(c => {
      console.log(`[${c.created_at}] ID: ${c.id} | Nom: ${c.patient_name} | Synthèse vide? ${!c.synthese} | Transcription vide? ${!c.transcription}`);
    });
  }

  console.log("\n--- DERNIERS FICHIERS AUDIO CACHES ---");
  const { data: files, error: errF } = await supabase
    .storage
    .from('tdt_uploads')
    .list('', {
      limit: 10,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (errF) console.error("Erreur Storage:", errF);
  else {
    files.forEach(f => {
      console.log(`[${f.created_at}] Fichier: ${f.name} | Taille: ${(f.metadata?.size / 1024 / 1024).toFixed(4)} MB`);
    });
  }
}

checkData();
