const { GoogleGenAI } = require('@google/genai');

const apiKey = 'AIzaSyDs44SRogUSkk2JMxyIS4fbLSNWvYC7Ydg';
const ai = new GoogleGenAI({ apiKey });

async function checkFiles() {
  try {
    console.log("Fetching files from Gemini...");
    const files = await ai.files.list();
    let pending = 0;
    let active = 0;
    let failed = 0;
    
    for (const file of files) {
      console.log(`- File: ${file.name} | State: ${file.state} | Created: ${file.createTime}`);
      if (file.state === 'PROCESSING' || file.state === 'PENDING') pending++;
      else if (file.state === 'ACTIVE') active++;
      else if (file.state === 'FAILED') failed++;
    }
    
    console.log(`\nSummary: ${active} ACTIVE, ${pending} PROCESSING, ${failed} FAILED`);
  } catch (error) {
    console.error("Error fetching Gemini files:", error);
  }
}

checkFiles();
