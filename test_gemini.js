const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

async function run() {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if(!apiKey) {
            console.log("No API key");
            return;
        }
        console.log("Gemini SDK loaded");
    } catch(e) {
        console.log(e);
    }
}
run();
