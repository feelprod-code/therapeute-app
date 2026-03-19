const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function run() {
  try {
    const testFile = path.join(__dirname, 'test_large_audio.txt');
    // Generate a 10MB dummy file
    const mb = 1024 * 1024;
    const buffer = Buffer.alloc(10 * mb, 'a');
    fs.writeFileSync(testFile, buffer);
    
    console.log("Uploading file...");
    const uploadedFile = await ai.files.upload({
      file: testFile,
      mimeType: 'text/plain',
    });
    console.log("Upload success:", uploadedFile.name);
    
    console.log("Getting file status...");
    const fileInfo = await ai.files.get({ name: uploadedFile.name });
    console.log("File status:", fileInfo.state);
    
    fs.unlinkSync(testFile);
  } catch (error) {
    console.error("Gemini API Error:", error);
  }
}

run();
