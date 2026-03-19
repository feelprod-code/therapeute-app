const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const apiKey = 'AIzaSyDs44SRogUSkk2JMxyIS4fbLSNWvYC7Ydg';
const ai = new GoogleGenAI({ apiKey });

async function run() {
  try {
    const testFile = path.join(__dirname, 'test_audio.txt');
    fs.writeFileSync(testFile, 'This is a test file pretending to be audio.');
    
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
