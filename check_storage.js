require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.storage.from('tdt_uploads').list('', {
    limit: 20,
    offset: 0,
    sortBy: { column: 'created_at', order: 'desc' },
  });
  if (error) {
    console.log("Erreur list storage:", error);
  } else {
    console.log("Derniers fichiers uploadés:");
    data.slice(0, 10).forEach(f => console.log(`- ${f.name} (Créé le ${f.created_at})`));
  }
}
run();
