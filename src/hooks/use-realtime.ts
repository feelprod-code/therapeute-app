"use client";
import { useRef, useCallback, useState } from 'react';

type RealtimeEvents = {
    onTranscript: (text: string) => void;
    onTranslation: (text: string) => void;
    onSpeechStart: () => void;
    onSpeechStop: () => void;
    onError: (error: string) => void;
    onDone: () => void;
};

export function useRealtime() {
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);
    const audioElRef = useRef<HTMLAudioElement | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    const connect = useCallback(async (
        role: 'therapeut' | 'patient',
        targetLanguage: string,
        events: RealtimeEvents
    ) => {
        setIsConnecting(true);
        try {
            // 1. Get ephemeral token
            const sessionRes = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ speaker: role, targetLanguage }),
            });
            if (!sessionRes.ok) throw new Error('Session creation failed');
            const session = await sessionRes.json();
            const token = session.client_secret?.value;
            if (!token) throw new Error('No ephemeral token received');

            // 2. Create peer connection
            const pc = new RTCPeerConnection();
            pcRef.current = pc;

            // 3. Audio output from AI
            const audioEl = document.createElement('audio');
            audioEl.autoplay = true;
            audioElRef.current = audioEl;
            pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

            // 4. Add microphone
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStreamRef.current = stream;
            stream.getTracks().forEach(track => pc.addTrack(track, stream));

            // 5. Data channel for events
            const dc = pc.createDataChannel("oai-events");
            dcRef.current = dc;

            dc.onmessage = (e) => {
                try {
                    const evt = JSON.parse(e.data);
                    switch (evt.type) {
                        case 'input_audio_buffer.speech_started':
                            events.onSpeechStart();
                            break;
                        case 'input_audio_buffer.speech_stopped':
                            events.onSpeechStop();
                            break;
                        case 'conversation.item.input_audio_transcription.completed':
                            if (evt.transcript) events.onTranscript(evt.transcript);
                            break;
                        case 'response.audio_transcript.done':
                            if (evt.transcript) events.onTranslation(evt.transcript);
                            break;
                        case 'response.done':
                            events.onDone();
                            break;
                        case 'error':
                            events.onError(evt.error?.message || 'Unknown error');
                            break;
                    }
                } catch { /* ignore parse errors */ }
            };

            // 6. SDP handshake
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const sdpRes = await fetch(
                `https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/sdp',
                    },
                    body: offer.sdp,
                }
            );
            if (!sdpRes.ok) throw new Error('SDP handshake failed');

            const answerSdp = await sdpRes.text();
            await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

            setIsConnected(true);
            setIsConnecting(false);
        } catch (error) {
            setIsConnecting(false);
            cleanup();
            throw error;
        }
    }, []);

    const cleanup = useCallback(() => {
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(t => t.stop());
            micStreamRef.current = null;
        }
        if (dcRef.current) {
            dcRef.current.close();
            dcRef.current = null;
        }
        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
        if (audioElRef.current) {
            audioElRef.current.srcObject = null;
            audioElRef.current = null;
        }
        setIsConnected(false);
    }, []);

    const disconnect = useCallback(() => {
        cleanup();
    }, [cleanup]);

    return { connect, disconnect, isConnected, isConnecting };
}
