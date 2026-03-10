const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  
  console.log("Checking model...");
}
run();
