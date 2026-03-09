import Dexie, { type EntityTable } from 'dexie';

export interface Consultation {
    id?: number;
    date: Date;
    audioBlob?: Blob; // Stocke l'audio original (optionnel après transcription)
    transcription?: string; // Le texte brut transcrit
    resume?: string; // Un court résumé textuel
    synthese?: string; // Le bilan structuré généré par l'IA
    patientName?: string;
    isProcessing: boolean;
    createdAt: Date;
}

export interface DraftRecording {
    id: string; // ex: 'standard' ou 'bilingual' pour gérer 1 draft max par type
    mode: 'standard' | 'bilingual';
    audioChunks: Blob[];
    mimeType?: string;
    startedAt: Date;
    lastUpdatedAt: Date;
    bilingualRole?: 'therapeut' | 'patient'; // Uniquement pour le mode bilingue si besoin
}

const db = new Dexie('TherapeuteDB') as Dexie & {
    consultations: EntityTable<Consultation, 'id'>;
    drafts: EntityTable<DraftRecording, 'id'>;
};

db.version(2).stores({
    consultations: '++id, date, patientName, isProcessing, createdAt',
    drafts: 'id, mode, startedAt, lastUpdatedAt'
});

// Pour la rétrocompatibilité
db.version(1).stores({
    consultations: '++id, date, patientName, isProcessing, createdAt'
});

export { db };
