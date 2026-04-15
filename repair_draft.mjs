import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
    const { data } = await supabase.from('consultations').select('*').in('id', ['13fb3905-b300-4d91-990d-79e5bc54b92b', 'f3ec72d6-c65e-470c-9bbb-dbef3ba2bb88']);
    console.log(data);
}
run();
