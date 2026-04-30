import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const text = "Patient Jean Dupont, douleur cervicale hier. s15";
const parts = [];
parts.push({ text: `\n\n--- Document texte de la consultation (foobar.txt) ---\n${text}\n--- Fin du document ---\n` });

const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est d'analyser la transcription d'un interrogatoire patient fourni et de produire un bilan.
Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Nom et Prénom",
  "consultationDate": "2024-10-14",
  "transcription": "Texte",
  "resume": "Resume",
  "synthese": "Markdown"
}`;
parts.push({ text: systemPrompt });

async function test() {
  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: parts }],
        config: { systemInstruction: systemPrompt, responseMimeType: 'application/json' }
    });
    console.log(response.text);
  } catch (e) {
    console.error(e);
  }
}
test();
