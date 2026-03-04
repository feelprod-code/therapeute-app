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

const db = new Dexie('TherapeuteDB') as Dexie & {
    consultations: EntityTable<Consultation, 'id'>;
};

db.version(1).stores({
    consultations: '++id, date, patientName, isProcessing, createdAt'
});

export { db };
