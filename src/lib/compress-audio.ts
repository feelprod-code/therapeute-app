import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export async function compressAudio(file: File): Promise<File> {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
  }

  const inputName = file.name.replace(/\s+/g, '_');
  const outputName = 'compressed.webm';

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // Compress to webm using libopus, similar to the browser's MediaRecorder defaults
  // 24k bitrate is usually enough for speech
  await ffmpeg.exec([
    '-i', inputName,
    '-c:a', 'libopus',
    '-b:a', '24k',
    '-vbr', 'on',
    '-ac', '1',
    outputName
  ]);

  const fileData = await ffmpeg.readFile(outputName);
  const data = new Uint8Array(fileData as unknown as ArrayBuffer);
  
  // Clean up
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  return new File([data], `compressed_${file.name}.webm`, { type: 'audio/webm' });
}
