import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

async function main() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    fs.writeFileSync('/tmp/dummy.txt', 'Hello world');
    console.log('Uploading file...');
    const uploadResult = await ai.files.upload({
      file: '/tmp/dummy.txt',
      config: { mimeType: 'text/plain' }
    });
    console.log('Uploaded:', uploadResult.name);
    console.log('Polling file...');
    let fileInfo = await ai.files.get({ name: uploadResult.name });
    console.log('File info parsed:', fileInfo.state);
    
    console.log('Testing generateContent...');
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: [
            { fileData: { fileUri: uploadResult.uri, mimeType: 'text/plain' } },
            { text: "What is this?" }
        ]
    });
    console.log('GenerateContent success:', response.text);
  } catch (err) {
    console.error('Error:', err);
  }
}
main();
