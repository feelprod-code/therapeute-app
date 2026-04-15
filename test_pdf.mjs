import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function check() {
    const fileContent = "Hello World PDF Content";
    const { data, error } = await supabase.storage.from('tdt_uploads').upload('test.pdf', fileContent, { contentType: 'application/pdf' });
    if (error) {
        console.error("Upload error:", error);
        return;
    }

    console.log("Mock PDF Uploaded. Calling API...");
    const payload = {
        attachedFiles: [{ fileName: 'test.pdf', mimeType: 'application/pdf' }],
        previousContext: { synthese: "Test", transcription: "Test" }
    };

    try {
        const res = await fetch('http://localhost:3001/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log("Status:", res.status);
        const json = await res.json();
        console.log("Response:", JSON.stringify(json).substring(0, 200));
    } catch (err) {
        console.error("Fetch error:", err);
    }
}
check();
