/**
 * useVoiceRecording — Manages the voice-to-text lifecycle for the voice command overlay.
 *
 * Detection order:
 *  1. Browser SpeechRecognition API (Chrome/Edge)
 *  2. Whisper native via Tauri IPC (desktop builds, auto-downloads model)
 */

import { useEffect, useRef, useState } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { isTauri as isTauriAvailable } from '#/utils/tauriBridge';

import { voiceStatusStore } from '../../stores/voiceStatusStore';
import { injectPromptCommand } from '../../useCases/promptInjection';
import { ensureWhisperReady } from '../../useCases/voiceDictation/ensureWhisperReady';
import { onDictationResult } from '../../useCases/voiceDictation/onDictationResult';
import { startDictation } from '../../useCases/voiceDictation/startDictation';
import { stopDictation } from '../../useCases/voiceDictation/stopDictation';
import { onVoiceToggle } from '../../useCases/voiceToggle/onVoiceToggle';

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

/** Ensure the Whisper model is downloaded and loaded before first use. */
const ensureWhisperLoaded = async (): Promise<void> => {
    await ensureWhisperReady();
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
 * Manages voice recording lifecycle: browser SpeechRecognition or native Whisper.
 * Injects transcribed text into the prompt bar via `injectPromptCommand`.
 */
export const useVoiceRecording = (): VoiceRecordingState => {
    const [isListening, setIsListening] = useState(false);
    const [interimText, setInterimText] = useState('');
    const [finalText, setFinalText] = useState('');
    const [transcribing, setTranscribing] = useState(false);
    const [errorText, setErrorText] = useState('');

    // Sync to voiceStatusStore so VoiceButton can reflect state
    const setListening = (value: boolean): void => {
        setIsListening(value);
        voiceStatusStore.set({ isListening: value, transcribing: voiceStatusStore.value?.transcribing ?? false });
    };
    const setTranscribingAndStore = (value: boolean): void => {
        setTranscribing(value);
        voiceStatusStore.set({ isListening: voiceStatusStore.value?.isListening ?? false, transcribing: value });
    };

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
        try {
            // Auto-download and load model on first use
            await ensureWhisperLoaded();

            // Listen for transcription result from Rust
            const unlisten = await onDictationResult((result) => {
                const text = result.text?.trim() ?? '';
                if (text) {
                    setFinalText(text);
                    injectPromptCommand(text);
                }
                setTranscribing(false);
                setIsListening(false);
                unlisten();
            });

            // Start native recording via cpal + whisper inference
            await startDictation();

            modeRef.current = 'whisper';
            setListening(true);
            setFinalText('');
            setInterimText('Recording...');
        } catch (error: unknown) {
            logger.warn(`Whisper recording failed: ${String(error)}`);
            setListening(false);
        }
    };

    // ── Browser SpeechRecognition ────────────────────────────────────────

    const showError = (msg: string): void => {
        setErrorText(msg);
        setListening(true);
        setTimeout(() => {
            setErrorText('');
            setListening(false);
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
            for (let index = 0; index < event.results.length; index++) {
                const result = event.results[index];
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
            setListening(true);
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
        if (modeRef.current === 'whisper') {
            setTranscribingAndStore(true);
            setInterimText('Transcribing...');
            stopDictation().catch((error: unknown) => {
                logger.warn(`stop_dictation failed: ${String(error)}`);
            });
            // The dictation-result event listener (set in startWhisperRecording) handles the rest
            return;
        }
        setListening(false);
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
        return onVoiceToggle((payload) => {
            if (payload && typeof payload.active === 'boolean') {
                if (payload.active && !isListeningRef.current) {
                    startListening();
                } else if (!payload.active && isListeningRef.current) {
                    stopListening();
                }
            } else {
                toggleListening();
            }
        });
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
