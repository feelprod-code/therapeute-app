require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateTranscriptions() {
    console.log('Fetching consultations...');
    const { data: consultations, error } = await supabase
        .from('consultations')
        .select('id, transcription, follow_ups');

    if (error) {
        console.error('Error fetching consultations:', error);
        process.exit(1);
    }

    console.log(`Found ${consultations.length} consultations. Processing...`);

    let updatedCount = 0;

    for (const consultation of consultations) {
        let hasChanges = false;
        let newTranscription = consultation.transcription;
        let newFollowUps = consultation.follow_ups;

        // Fix Bilan transcription
        if (newTranscription && typeof newTranscription === 'string') {
            const replaced = newTranscription.replace(/Praticien( ?):/g, 'Thérapeute :');
            if (replaced !== newTranscription) {
                newTranscription = replaced;
                hasChanges = true;
            }
        }

        // Fix follow-up transcriptions
        if (newFollowUps && Array.isArray(newFollowUps)) {
            const updatedFollowUps = newFollowUps.map(fu => {
                if (fu.transcription && typeof fu.transcription === 'string') {
                    const replaced = fu.transcription.replace(/Praticien( ?):/g, 'Thérapeute :');
                    if (replaced !== fu.transcription) {
                        hasChanges = true;
                        return { ...fu, transcription: replaced };
                    }
                }
                return fu;
            });
            newFollowUps = updatedFollowUps;
        }

        if (hasChanges) {
            console.log(`Updating consultation ${consultation.id}...`);
            const { error: updateError } = await supabase
                .from('consultations')
                .update({ transcription: newTranscription, follow_ups: newFollowUps })
                .eq('id', consultation.id);

            if (updateError) {
                console.error(`Error updating consultation ${consultation.id}:`, updateError);
            } else {
                updatedCount++;
            }
        }
    }

    console.log(`Done! Updated ${updatedCount} consultations.`);
}

updateTranscriptions();
