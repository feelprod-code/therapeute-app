const { GoogleGenAI } = require('@google/genai');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

async function run() {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const tempFile = path.join(os.tmpdir(), "test_audio.webm");
    await fs.writeFile(tempFile, "dummy audio data makes the file tiny but ok");
    try {
        const uploadResult = await ai.files.upload({
            file: tempFile,
            config: { mimeType: 'audio/webm' }
        });
        console.log("Upload succes:", uploadResult.name);
        
        let fileInfo = await ai.files.get({ name: uploadResult.name });
        while (fileInfo.state === 'PROCESSING') {
            console.log("File is processing, waiting...");
            await new Promise(r => setTimeout(r, 2000));
            fileInfo = await ai.files.get({ name: uploadResult.name });
        }
        
        if (fileInfo.state === 'FAILED') {
            console.error("File processing failed.");
        } else {
            console.log("File is ready:", fileInfo.state);
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: [{
                    role: 'user',
                    parts: [
                        { fileData: { fileUri: uploadResult.uri, mimeType: 'audio/webm' } },
                        { text: "Describe this audio." }
                    ]
                }]
            });
            console.log("Generate succes:", response.text);
        }
    } catch(e) {
        console.error("Error:", e);
    }
}
run();
