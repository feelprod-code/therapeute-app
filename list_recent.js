require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
(async () => {
   const { data, error } = await supabase.from('consultations').select('id, patient_name, audio_path, created_at').order('created_at', { ascending: false }).limit(10);
   console.table(data);
})();
