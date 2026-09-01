import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeSearch(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

export function extractPatientNameFromText(rawText: string): string {
  if (!rawText || !rawText.trim()) return "";
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return "";

  // Pattern 1: Civility header on separate line (Madame / Monsieur / M. / Mme)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isCivility = /^(madame|monsieur|m\.|mme|mlle|patient\s*:?|patiente\s*:?)$/i.test(line);
    if (isCivility && i + 2 < lines.length) {
      const next1 = lines[i + 1].replace(/^[^\w\sÀ-ÖØ-öø-ÿ]+|[^\w\sÀ-ÖØ-öø-ÿ]+$/g, '').trim();
      const next2 = lines[i + 2].replace(/^[^\w\sÀ-ÖØ-öø-ÿ]+|[^\w\sÀ-ÖØ-öø-ÿ]+$/g, '').trim();
      if (next1 && next2 && !next1.includes(':') && !next2.includes(':')) {
        return ensureLastNameFirst(`${next1} ${next2}`);
      }
    }
  }

  // Pattern 2: First 2 lines are LASTNAME and Firstname followed by gender/date/birth line
  if (lines.length >= 2) {
    const line0 = lines[0].replace(/^(madame|monsieur|m\.|mme|mlle)\s+/i, '').trim();
    const line1 = lines[1].trim();
    if (
      lines.length >= 3 &&
      (lines[2].toLowerCase().includes('né') || /^[fm],?\s*\d{2}[\/-]\d{2}[\/-]\d{4}/i.test(lines[2]) || /^[fm],?\s*\d+/i.test(lines[2]) || /^\d{2}[\/-]\d{2}[\/-]\d{4}/.test(lines[2])) &&
      !line0.includes(':') && !line1.includes(':')
    ) {
      return ensureLastNameFirst(`${line0} ${line1}`);
    }
  }

  // Pattern 3: Key-value lines (Nom : ..., Prénom : ...)
  let foundLastName = "";
  let foundFirstName = "";
  for (const line of lines) {
    const lastNameMatch = line.match(/^(?:nom|nom\s+(?:de\s+)?naissance|nom\s+d'usage|nom\s+marital)\s*:\s*([^,\n]+)/i);
    if (lastNameMatch && !foundLastName) {
      foundLastName = lastNameMatch[1].trim();
    }
    const firstNameMatch = line.match(/^(?:prénom|prenom)\s*:\s*([^,\n]+)/i);
    if (firstNameMatch && !foundFirstName) {
      foundFirstName = firstNameMatch[1].trim();
    }
    const fullMatch = line.match(/^(?:nom\s*[\/&]\s*pr[ée]nom|nom\s+et\s+pr[ée]nom|patient(?:e)?)\s*:\s*([^,\n]+)/i);
    if (fullMatch) {
      const candidate = fullMatch[1].trim();
      if (candidate && !/^(non\s+pr[ée]cis[ée]|anonyme)/i.test(candidate)) {
        return ensureLastNameFirst(candidate);
      }
    }
  }

  if (foundLastName && foundFirstName) {
    return ensureLastNameFirst(`${foundLastName} ${foundFirstName}`);
  }
  if (foundLastName) {
    return foundLastName.toUpperCase();
  }

  // Pattern 4: Inline civility or "Patient(e) [Nom Prénom]" at start of text
  const firstLine = lines[0];
  const inlineMatch = firstLine.match(/^(?:patient(?:e)?|madame|monsieur|m\.|mme)\s+([A-ZÀ-ÖØ-öø-ÿ\s-]+?)(?:,|\.|\s+\d|\s+né|\s+a\s+\d|\s+consulte|$)/i);
  if (inlineMatch && inlineMatch[1].trim().length > 2) {
    const candidate = inlineMatch[1].trim();
    if (!/^(anonyme|non\s+pr[ée]cis[ée])$/i.test(candidate)) {
      return ensureLastNameFirst(candidate);
    }
  }

  return "";
}

