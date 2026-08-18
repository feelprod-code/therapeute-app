import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractLastName(fullName: string): string {
  if (!fullName) return "";
  const cleanName = fullName.trim();
  const words = cleanName.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];

  // 1. Si des mots sont en majuscules (ex: "Jean-Claude FRENOT" ou "FRENOT Jean-Claude")
  const uppercaseWords = words.filter(w => {
    const cleanWord = w.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '');
    return cleanWord.length > 1 && cleanWord === cleanWord.toUpperCase();
  });

  if (uppercaseWords.length > 0) {
    return uppercaseWords.join(" ");
  }

  // 2. En notation standard française "NOM Prénom" (ex: "Frénot Jean-Claude", "Dupuy Béatrice"),
  // le premier mot est le nom de famille !
  return words[0];
}

export function extractFirstName(fullName: string, lastName: string): string {
  if (!fullName) return "";
  if (!lastName) return fullName;
  const cleanName = fullName.trim();
  if (cleanName.startsWith(lastName)) {
    return cleanName.slice(lastName.length).trim();
  }
  if (cleanName.endsWith(lastName)) {
    return cleanName.slice(0, cleanName.length - lastName.length).trim();
  }
  const escapedLastName = lastName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedLastName}\\b`, 'gi');
  const firstName = cleanName.replace(regex, '').trim();
  return firstName.replace(/^[,\s-]+|[,\s-]+$/g, '').replace(/\s+/g, ' ') || cleanName;
}

export function getClassificationLetter(fullName: string): string {
  if (!fullName) return "";
  const clean = fullName.trim();
  if (!clean) return "";

  const lastName = extractLastName(clean);
  const target = lastName || clean;
  const firstChar = target.trim().charAt(0);
  
  return firstChar.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function swapFirstLastName(fullName: string): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 1) return trimmed;

  if (words.length === 2) {
    return `${words[1]} ${words[0]}`;
  }

  const isUppercaseWord = (w: string) => {
    const clean = w.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, '');
    return clean.length > 1 && clean === clean.toUpperCase();
  };

  const uppercaseIndexes = words.map((w, idx) => isUppercaseWord(w) ? idx : -1).filter(idx => idx !== -1);

  if (uppercaseIndexes.length > 0 && uppercaseIndexes.length < words.length) {
    const firstUpperIdx = uppercaseIndexes[0];
    const lastUpperIdx = uppercaseIndexes[uppercaseIndexes.length - 1];

    if (firstUpperIdx === 0 && lastUpperIdx === uppercaseIndexes.length - 1) {
      const lastNameBlock = words.slice(0, lastUpperIdx + 1).join(" ");
      const firstNameBlock = words.slice(lastUpperIdx + 1).join(" ");
      return `${firstNameBlock} ${lastNameBlock}`.trim();
    } else if (lastUpperIdx === words.length - 1 && firstUpperIdx === words.length - uppercaseIndexes.length) {
      const firstNameBlock = words.slice(0, firstUpperIdx).join(" ");
      const lastNameBlock = words.slice(firstUpperIdx).join(" ");
      return `${lastNameBlock} ${firstNameBlock}`.trim();
    }
  }

  // Échange pour noms composés (ex: "Frénot Jean Claude" <-> "Jean Claude Frénot")
  const lastName = extractLastName(trimmed);
  const firstName = extractFirstName(trimmed, lastName);
  if (lastName && firstName && lastName !== trimmed) {
    if (trimmed.startsWith(lastName)) {
      return `${firstName} ${lastName}`.trim();
    } else {
      return `${lastName} ${firstName}`.trim();
    }
  }

  const last = words[words.length - 1];
  const rest = words.slice(0, words.length - 1).join(" ");
  return `${last} ${rest}`;
}

export function ensureLastNameFirst(fullName: string): string {
  if (!fullName || !fullName.trim()) return "";
  const trimmed = fullName.trim();

  // Ignorer les titres de patients anonymes
  if (
    trimmed.toLowerCase().startsWith("patient anonyme") ||
    trimmed.startsWith("Patient #") ||
    trimmed.toLowerCase().startsWith("patient(e)")
  ) {
    return trimmed;
  }

  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 1) return trimmed;

  const isUppercaseWord = (w: string) => {
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

  return trimmed;
}
