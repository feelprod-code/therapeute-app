import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Erreur: Supabase URL ou Key manquant dans .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

function extractLastName(fullName) {
  if (!fullName) return "";
  const cleanName = fullName.trim();
  const words = cleanName.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];

  const uppercaseWords = words.filter(w => {
    const cleanWord = w.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '');
    return cleanWord.length > 1 && cleanWord === cleanWord.toUpperCase();
  });

  if (uppercaseWords.length > 0) {
    return uppercaseWords.join(" ");
  }

  return words[words.length - 1];
}

function extractFirstName(fullName, lastName) {
  if (!fullName) return "";
  if (!lastName) return fullName;
  const escapedLastName = lastName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedLastName}\\b`, 'gi');
  const firstName = fullName.replace(regex, '').trim();
  return firstName.replace(/^[,\s-]+|[,\s-]+$/g, '').replace(/\s+/g, ' ') || fullName;
}

function ensureLastNameFirst(fullName) {
  if (!fullName || !fullName.trim()) return "";
  const trimmed = fullName.trim();

  if (
    trimmed.toLowerCase().startsWith("patient anonyme") ||
    trimmed.startsWith("Patient #") ||
    trimmed.toLowerCase().startsWith("patient(e)")
  ) {
    return trimmed;
  }

  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 1) return trimmed;

  const isUppercaseWord = (w) => {
    const clean = w.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '');
    return clean.length > 1 && clean === clean.toUpperCase();
  };

  const uppercaseIndexes = words.map((w, idx) => isUppercaseWord(w) ? idx : -1).filter(idx => idx !== -1);

  if (uppercaseIndexes.length > 0 && uppercaseIndexes.length < words.length) {
    const firstUpperIdx = uppercaseIndexes[0];
    const lastUpperIdx = uppercaseIndexes[uppercaseIndexes.length - 1];

    if (firstUpperIdx === 0 && lastUpperIdx === uppercaseIndexes.length - 1) {
      return trimmed;
    }

    if (lastUpperIdx === words.length - 1 && firstUpperIdx === words.length - uppercaseIndexes.length) {
      const firstNameBlock = words.slice(0, firstUpperIdx).join(" ");
      const lastNameBlock = words.slice(firstUpperIdx).join(" ");
      return `${lastNameBlock} ${firstNameBlock}`.trim();
    }
  }

  const lastName = extractLastName(trimmed);
  const firstName = extractFirstName(trimmed, lastName);

  if (lastName && firstName && lastName.toLowerCase() !== trimmed.toLowerCase()) {
    const upperLastName = lastName.toUpperCase();
    const formattedFirstName = firstName
      .split(/\s+/)
      .map(w => w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : "")
      .join(" ");
    return `${upperLastName} ${formattedFirstName}`.trim();
  }

  return trimmed;
}

async function run() {
  console.log("🔄 Récupération de tous les dossiers patients...");
  const { data: consultations, error } = await supabase.from('consultations').select('id, patient_name');

  if (error) {
    console.error("Erreur lors de la récupération des consultations:", error);
    process.exit(1);
  }

  console.log(`📋 Total de consultations trouvées: ${consultations.length}`);

  let updatedCount = 0;

  for (const consult of consultations) {
    const currentName = consult.patient_name || "";
    if (!currentName || currentName.trim() === "") continue;

    const newName = ensureLastNameFirst(currentName);

    if (newName !== currentName) {
      console.log(`✏️ Modification ID ${consult.id} : "${currentName}" ➔ "${newName}"`);
      const { error: updateError } = await supabase
        .from('consultations')
        .update({ patient_name: newName })
        .eq('id', consult.id);

      if (updateError) {
        console.error(`❌ Erreur mise à jour ID ${consult.id}:`, updateError);
      } else {
        updatedCount++;
      }
    } else {
      console.log(`✓ Déjà correct ID ${consult.id} : "${currentName}"`);
    }
  }

  console.log(`\n🎉 Terminé ! ${updatedCount} noms de patients ont été réordonnés avec le NOM EN PREMIER.`);
}

run();
