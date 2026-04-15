import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function testUpload() {
  const fileContent = new Blob(['test image'], { type: 'image/jpeg' });
  const { data, error } = await supabase.storage.from('tdt_uploads').upload(`test_image_${Date.now()}.jpg`, fileContent, {
    contentType: 'image/jpeg'
  });
  
  if (error) {
    console.error("Upload error:", error);
  } else {
    console.log("Upload success:", data);
  }
}
testUpload();
