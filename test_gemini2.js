require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
console.log(Object.keys(new GoogleGenAI({apiKey: 'abc'})));
