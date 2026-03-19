import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 800; // 15 minutes max duration

export async function POST(req: Request) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return NextResponse.json({ error: "Clé API Gemini manquante." }, { status: 500 });

        const body = await req.json();
        const { targetConsultation, sourceConsultation } = body;

        if (!targetConsultation || !sourceConsultation) {
            return NextResponse.json({ error: "Les deux consultations (cible et source) sont requises pour la fusion." }, { status: 400 });
        }

        const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const systemPrompt = `Tu es un assistant médical clinique expert. Ton rôle est de FUSIONNER INTELLIGEMMENT deux bilans de consultation d'un même patient.
Tu vas recevoir les informations du Bilan Principal (Cible) et les informations d'un Autre Bilan (Source).
Ton objectif est de rédiger un SEUL ET UNIQUE bilan cohérent qui intègre toutes les informations des deux dossiers, sans aucune redite ni répétition, comme s'ils avaient été dictés au praticien en une seule et unique fois.

Voici le Bilan Principal (Cible) :
Nom du patient : ${targetConsultation.patientName || targetConsultation.patient_name || 'Non renseigné'}
Synthèse Actuelle :
"""
${targetConsultation.synthese || 'Aucune synthèse'}
"""

Voici le Bilan à Fusionner (Source) :
Transcription (Source) :
"""
${sourceConsultation.transcription || 'Aucune transcription'}
"""
Synthèse (Source) :
"""
${sourceConsultation.synthese || 'Aucune synthèse'}
"""

Tu dois IMPÉRATIVEMENT répondre avec un objet JSON strictement formaté comme ceci :
{
  "patientName": "Le Nom et Prénom du patient (Garde celui du Bilan Principal s'il existe).",
  "resume": "Un TOUT NOUVEAU résumé narratif en 3 à 5 phrases maximum, sous forme d'un paragraphe continu unique (pas de listes). Il doit raconter l'histoire clinique issue des DEUX bilans combinés de manière fluide et logique.",
  "synthese": "Une TOUTE NOUVELLE synthèse médicale au format Markdown, fusionnant parfaitement l'ensemble des informations."
}

Règles impératives pour la nouvelle "synthese" :
1. Combine intelligemment les "Motifs de consultation" s'il y en a plusieurs.
2. Synthétise "Histoire de la Maladie" pour que cela reste clair et digeste malgré l'apport de nouvelles données.
3. Fusionne impérativement la section "Antécédents (ATCD) et Chronologie". Reprends TOUS les antécédents des deux bilans et classe-les dans un UNIQUE ordre strictement chronologique, de la naissance jusqu'à aujourd'hui. Ne crée pas de doublons.
4. La structure Markdown de la "synthese" DOIT respecter ce format d'affichage précis :

# Bilan de Consultation - ${currentDate}

### Informations Patient
- **Nom/Prénom :** [Ex: Jean Dupont]
- **Âge / Date de naissance :** [Extraire si mentionné]
- **Profession :** [Extraire si mentionné]
- **Date de consultation :** La consultation se passe aujourd'hui le ${currentDate}.
### Motif de Consultation
[...]
### Histoire de la Maladie / Douleur
- **Description :** [...]
- **Intensité :** [...]
- **Fréquence :** [...]
- **Circonstances d'apparition :** [...]
### Examens Complémentaires
- **Photos / PDF / Textes :** [...]
### Antécédents (ATCD) et Chronologie
*Présente TOUS les antécédents, traumatismes, accidents, interventions dans un ordre strictement chronologique de la naissance jusqu'à aujourd'hui.*
- [Année] - [Description]
`;

        console.log("[API Merge] Generating unified medical report...");
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: [
                { role: 'user', parts: [{ text: systemPrompt }] }
            ],
            config: {
                systemInstruction: "Tu retournes uniquement du JSON sans balises Markdown autour du bloc principal.",
            }
        });

        const texteResponse = response.text;
        if (!texteResponse) throw new Error("L'API Gemini a retourné une réponse vide.");

        const cleanJson = texteResponse
            .replace(/\`\`\`json\n/g, '')
            .replace(/\`\`\`\n?/g, '')
            .trim();

        const jsonResult = JSON.parse(cleanJson);
        const separator = "\n\n---\n**Ajout suite à une fusion :**\n\n";
        jsonResult.transcription = (targetConsultation.transcription || "") + separator + (sourceConsultation.transcription || "");

        console.log("[API Merge] Fusion réussie.");

        return NextResponse.json(jsonResult);
    } catch (error: any) {
        console.error("[API Merge] Erreur complète :", error);
        return NextResponse.json({ error: error.message || "Erreur interne serveur lors de la fusion." }, { status: 500 });
    }
}
