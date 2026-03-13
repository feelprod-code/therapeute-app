import { createClient } from '@supabase/supabase-js'

export interface SupabaseConsultation {
    id: string;
    user_id?: string;
    date: string | Date;
    patientName?: string;
    patient_name?: string;
    synthese?: string;
    transcription?: string;
    resume?: string;
    audioBlob?: Blob;
    isProcessing?: boolean;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
