const { GoogleGenAI } = require('@google/genai');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const tempFile = path.join(os.tmpdir(), "test_audio.webm");
  await fs.writeFile(tempFile, "dummy audio data makes the file tiny but ok");
  const uploadResult = await ai.files.upload({ file: tempFile, config: { mimeType: 'audio/webm' } });
  console.log("Upload result", uploadResult);
  
  let fileInfo = await ai.files.get({ name: uploadResult.name });
  while (fileInfo.state === 'PROCESSING') {
      await new Promise(r => setTimeout(r, 2000));
      fileInfo = await ai.files.get({ name: uploadResult.name });
  }
  console.log("File active, state is:", fileInfo.state);
}
run();
