/**
 * useVoiceRecording — Manages the voice-to-text lifecycle for the voice command overlay.
 *
 * Detection order:
 *  1. Browser SpeechRecognition API (Chrome/Edge)
 *  2. Whisper sidecar via Tauri IPC (desktop builds)
 */

import { useEffect, useRef, useState } from 'react';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { isTauri as isTauriAvailable, tauriInvoke } from '#/helpers/tauriBridge';
import { injectPromptCommand } from '#/modules/AiRuntime/useCases/promptInjection';

const logger = Container.getInstance().get(Logger);

// ── Types ───────────────────────────────────────────────────────────────

type SpeechRecognitionInstance = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
};

type TranscriptionResult = {
    text: string;
    language: string;
    duration_ms: number;
    confidence: number;
};

type VoiceMode = 'browser' | 'whisper' | null;

// ── Helpers ─────────────────────────────────────────────────────────────

const getSpeechRecognition = (): SpeechRecognitionInstance | null => {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
        return null;
    }
    return new (Ctor as new () => SpeechRecognitionInstance)();
};

export const isSpeechRecognitionAvailable = (): boolean => {
    const w = window as unknown as Record<string, unknown>;
    return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
};

const resolveVoiceMode = (): VoiceMode => {
    if (isSpeechRecognitionAvailable()) {
        return 'browser';
    }
    if (isTauriAvailable()) {
        return 'whisper';
    }
    return null;
};

const transcribeViaWhisper = async (audioBlob: Blob): Promise<string> => {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));
    const tempPath = `__webdaw_voice_${String(Date.now())}.webm`;

    await tauriInvoke('write_audio_file', { path: tempPath, data: bytes });
    const result = (await tauriInvoke('transcribe_audio', {
        audioPath: tempPath,
    })) as TranscriptionResult;
    return result.text;
};

// ── Hook return type ────────────────────────────────────────────────────

export type VoiceRecordingState = {
    isListening: boolean;
    interimText: string;
    finalText: string;
    transcribing: boolean;
    errorText: string;
    voiceMode: VoiceMode;
    stopListening: () => void;
    toggleListening: () => void;
};

/**
 * Manages voice recording lifecycle: browser SpeechRecognition or Whisper sidecar.
 * Injects transcribed text into the prompt bar via `injectPromptCommand`.
 */
export const useVoiceRecording = (): VoiceRecordingState => {
    const [isListening, setIsListening] = useState(false);
    const [interimText, setInterimText] = useState('');
    const [finalText, setFinalText] = useState('');
    const [transcribing, setTranscribing] = useState(false);
    const [errorText, setErrorText] = useState('');

    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const modeRef = useRef<VoiceMode>(null);
    const isListeningRef = useRef(false);

    // Keep ref in sync with state
    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    // ── Whisper recording ───────────────────────────────────────────────

    const cleanupWhisperRecording = (): void => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
        chunksRef.current = [];
    };

    const startWhisperRecording = async (): Promise<void> => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                chunksRef.current.push(e.data);
            }
        };

        recorder.onstop = () => {
            for (const track of stream.getTracks()) {
                track.stop();
            }

            const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
            chunksRef.current = [];

            if (blob.size === 0) {
                setIsListening(false);
                return;
            }

            setTranscribing(true);
            void transcribeViaWhisper(blob)
                .then((text) => {
                    const trimmed = text.trim();
                    if (trimmed) {
                        injectPromptCommand(trimmed);
                    }
                })
                .catch((error: unknown) => {
                    logger.warn(`Whisper transcription failed: ${String(error)}`);
                })
                .finally(() => {
                    setTranscribing(false);
                    setIsListening(false);
                    setFinalText('');
                    setInterimText('');
                });
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        modeRef.current = 'whisper';
        setIsListening(true);
        setFinalText('');
        setInterimText('');
    };

    // ── Browser SpeechRecognition ────────────────────────────────────────

    const showError = (msg: string): void => {
        setErrorText(msg);
        setIsListening(true);
        setTimeout(() => {
            setErrorText('');
            setIsListening(false);
        }, 3000);
    };

    const startBrowserRecognition = (): boolean => {
        if (recognitionRef.current) {
            return true;
        }

        const recognition = getSpeechRecognition();
        if (!recognition) {
            return false;
        }

        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let accumulated = '';
        let hadError = false;

        recognition.onresult = (event) => {
            let finalPart = '';
            let interimPart = '';
            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                if (!result || result.length === 0 || !result[0]) {
                    continue;
                }
                if (result.isFinal) {
                    finalPart += result[0].transcript;
                } else {
                    interimPart += result[0].transcript;
                }
            }
            accumulated = finalPart;
            setFinalText(finalPart);
            setInterimText(interimPart);
        };

        recognition.onerror = (event) => {
            logger.warn(`Speech recognition error: ${event.error}`);

            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                hadError = true;
                recognitionRef.current = null;
                showError('Microphone access denied. Allow mic in browser settings.');
                if (isTauriAvailable()) {
                    modeRef.current = 'whisper';
                    void startWhisperRecording();
                }
                return;
            }
        };

        recognition.onend = () => {
            recognitionRef.current = null;
            if (hadError) {
                return;
            }
            setIsListening(false);

            const text = accumulated.trim();
            if (text) {
                injectPromptCommand(text);
            }
            setFinalText('');
            setInterimText('');
        };

        try {
            recognition.start();
            recognitionRef.current = recognition;
            modeRef.current = 'browser';
            setIsListening(true);
            setFinalText('');
            setInterimText('');
            setErrorText('');
            return true;
        } catch {
            return false;
        }
    };

    // ── Start / stop / toggle ───────────────────────────────────────────

    const stopListening = (): void => {
        if (modeRef.current === 'browser' && recognitionRef.current) {
            recognitionRef.current.stop();
            recognitionRef.current = null;
        }
        if (modeRef.current === 'whisper' && mediaRecorderRef.current) {
            if (mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
                return;
            }
        }
        setIsListening(false);
    };

    const startListening = (): void => {
        const mode = resolveVoiceMode();

        if (mode === 'browser') {
            const started = startBrowserRecognition();
            if (!started && isTauriAvailable()) {
                void startWhisperRecording();
            }
            return;
        }

        if (mode === 'whisper') {
            void startWhisperRecording();
            return;
        }

        showError('Voice input not available in this browser');
    };

    const toggleListening = (): void => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    };

    // ── External toggle event ───────────────────────────────────────────

    useEffect(() => {
        const handleToggle = (e: Event): void => {
            const detail = (e as CustomEvent<{ active?: boolean }>).detail;
            if (detail && typeof detail.active === 'boolean') {
                if (detail.active && !isListeningRef.current) {
                    startListening();
                } else if (!detail.active && isListeningRef.current) {
                    stopListening();
                }
            } else {
                toggleListening();
            }
        };

        document.addEventListener('webdaw:toggle-voice-command', handleToggle);
        return () => document.removeEventListener('webdaw:toggle-voice-command', handleToggle);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs, intentional
    }, []);

    // ── Cleanup on unmount ──────────────────────────────────────────────

    useEffect(() => {
        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.abort();
            }
            cleanupWhisperRecording();
        };
    }, []);

    return {
        isListening,
        interimText,
        finalText,
        transcribing,
        errorText,
        voiceMode: modeRef.current,
        stopListening,
        toggleListening,
    };
};
