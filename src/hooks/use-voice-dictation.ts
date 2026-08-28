import { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

interface UseVoiceDictationOptions {
  onTranscriptionComplete?: (text: string) => void;
}

export function useVoiceDictation({ onTranscriptionComplete }: UseVoiceDictationOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast({
          title: "Microphone inaccessible",
          description: "Votre navigateur ne permet pas l'accès au micro.",
          variant: "destructive"
        });
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;
      audioChunksRef.current = [];

      // Détecter le meilleur type MIME supporté
      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/aac')) {
          mimeType = 'audio/aac';
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        clearTimer();
        stopTracks();
        setIsRecording(false);

        const currentChunks = [...audioChunksRef.current];
        if (currentChunks.length === 0) {
          return;
        }

        const effectiveMime = mediaRecorder.mimeType || mimeType || 'audio/webm';
        const audioBlob = new Blob(currentChunks, { type: effectiveMime });

        if (audioBlob.size < 300) {
          return;
        }

        setIsTranscribing(true);
        try {
          const formData = new FormData();
          const ext = effectiveMime.includes('mp4') || effectiveMime.includes('aac') ? 'm4a' : 'webm';
          formData.append('file', audioBlob, `dictation.${ext}`);

          const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Erreur transcription HTTP ${response.status}`);
          }

          const result = await response.json();
          if (result.text && result.text.trim()) {
            onTranscriptionComplete?.(result.text.trim());
          }
        } catch (error: any) {
          console.error('[useVoiceDictation] Erreur transcription:', error);
          toast({
            title: "Erreur dictée vocale",
            description: error.message || "Impossible de transcrire votre voix.",
            variant: "destructive"
          });
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error('[useVoiceDictation] Erreur démarrage:', err);
      toast({
        title: "Erreur d'accès au micro",
        description: err.message || "Veuillez autoriser l'accès au microphone dans les réglages.",
        variant: "destructive"
      });
      setIsRecording(false);
    }
  }, [clearTimer, stopTracks, onTranscriptionComplete, toast]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      clearTimer();
      stopTracks();
      setIsRecording(false);
    }
  }, [clearTimer, stopTracks]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      clearTimer();
      stopTracks();
    };
  }, [clearTimer, stopTracks]);

  return {
    isRecording,
    isTranscribing,
    duration,
    startRecording,
    stopRecording,
    toggleRecording
  };
}
