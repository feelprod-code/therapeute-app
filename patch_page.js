const fs = require('fs');
let content = fs.readFileSync('src/app/page.tsx', 'utf-8');

// Replace handleRetryAnalysis hardcoded mimeType
content = content.replace(
  `          audioFile: { fileName: consultation.audio_path, mimeType: 'audio/webm' },`,
  `          audioFile: { fileName: consultation.audio_path, mimeType: consultation.audio_path?.endsWith('.txt') ? 'text/plain' : 'audio/webm' },`
);

// Replace handleEditTranscription hardcoded mimeType
content = content.replace(
  `          audioFile: { fileName: currentConsultation.audio_path, mimeType: 'audio/webm' },`,
  `          audioFile: { fileName: currentConsultation.audio_path, mimeType: currentConsultation.audio_path?.endsWith('.txt') ? 'text/plain' : 'audio/webm' },`
);

fs.writeFileSync('src/app/page.tsx', content, 'utf-8');
console.log('Patched page.tsx successfully');
