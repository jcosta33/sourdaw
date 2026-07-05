/**
 * useVoiceRecording — Manages the voice-to-text lifecycle for the voice command overlay.
 *
 * Detection order:
 *  1. Browser SpeechRecognition API (Chrome/Edge)
 *  2. Whisper native via Tauri IPC (desktop builds, auto-downloads model)
 */

import { useEffect, useRef, useState } from 'react';

import { logger } from '#/infra/logger/appLogger';

import { injectPromptCommand } from '../../useCases/promptInjection';
import { setVoiceListeningStatus } from '../../useCases/setVoiceListeningStatus';
import { setVoiceStatus } from '../../useCases/setVoiceStatus';
import { setVoiceTranscribingStatus } from '../../useCases/setVoiceTranscribingStatus';
import { ensureWhisperReady } from '../../useCases/voiceDictation/ensureWhisperReady';
import { onDictationResult } from '../../useCases/voiceDictation/onDictationResult';
import { startDictation } from '../../useCases/voiceDictation/startDictation';
import { stopDictation } from '../../useCases/voiceDictation/stopDictation';
import { resolveVoiceInputMode, type VoiceInputMode } from '../../useCases/voiceInput/resolveVoiceInputMode';
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

// ── Helpers ─────────────────────────────────────────────────────────────

type WindowWithSpeechRecognition = Window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
};

const getSpeechRecognition = (): SpeechRecognitionInstance | null => {
    const w = window as WindowWithSpeechRecognition;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
        return null;
    }
    return new Ctor();
};

export const isSpeechRecognitionAvailable = (): boolean => {
    return resolveVoiceInputMode() === 'browser';
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
    voiceMode: VoiceInputMode;
    stopListening: () => void;
    toggleListening: () => void;
};

type ShowErrorInput = {
    message: string;
    keepListening?: boolean;
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

    const syncVoiceStatus = (value: { isListening: boolean; transcribing: boolean }): void => {
        setIsListening(value.isListening);
        setTranscribing(value.transcribing);
        setVoiceStatus(value);
    };
    const setListening = (value: boolean): void => {
        setIsListening(value);
        setVoiceListeningStatus(value);
    };
    const setTranscribingAndStore = (value: boolean): void => {
        setTranscribing(value);
        setVoiceTranscribingStatus(value);
    };

    const [voiceMode, setVoiceMode] = useState<VoiceInputMode>(null);
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const dictationUnlistenRef = useRef<(() => void) | null>(null);
    const modeRef = useRef<VoiceInputMode>(null);
    const isListeningRef = useRef(false);
    const isMountedRef = useRef(true);

    // Keep ref in sync with state
    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    // ── Whisper recording ───────────────────────────────────────────────

    // Release the native dictation-result listener registered in
    // startWhisperRecording. Safe to call when no listener is active.
    const releaseDictationListener = (): void => {
        const unlisten = dictationUnlistenRef.current;
        dictationUnlistenRef.current = null;
        if (unlisten) {
            unlisten();
        }
    };

    const cleanupWhisperRecording = (): void => {
        releaseDictationListener();
    };

    const startWhisperRecording = async (): Promise<void> => {
        try {
            // Auto-download and load model on first use
            await ensureWhisperLoaded();

            // A prior listener may still be live if recording restarts before a
            // result arrived — release it so listeners do not accumulate.
            releaseDictationListener();

            // Listen for transcription result from Rust
            const unlisten = await onDictationResult((result) => {
                const text = result.text?.trim() ?? '';
                if (text) {
                    setFinalText(text);
                    injectPromptCommand(text);
                }
                syncVoiceStatus({ isListening: false, transcribing: false });
                releaseDictationListener();
            });
            // If the component unmounted while we awaited the listener
            // registration, release it immediately instead of leaking it.
            if (!isMountedRef.current) {
                unlisten();
                return;
            }
            dictationUnlistenRef.current = unlisten;

            // Start native recording via cpal + whisper inference
            await startDictation();

            modeRef.current = 'whisper';
            setVoiceMode('whisper');
            setListening(true);
            setFinalText('');
            setInterimText('Recording...');
        } catch (error: unknown) {
            logger.warn(`Whisper recording failed: ${String(error)}`);
            setListening(false);
        }
    };

    // ── Browser SpeechRecognition ────────────────────────────────────────

    const showError = (input: ShowErrorInput): void => {
        setErrorText(input.message);
        setListening(true);
        setTimeout(() => {
            setErrorText('');
            if (!input.keepListening) {
                setListening(false);
            }
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
                const fallbackMode = resolveVoiceInputMode({ browserMode: 'disabled' });
                showError({
                    message: 'Microphone access denied. Allow mic in browser settings.',
                    keepListening: fallbackMode === 'whisper',
                });
                if (fallbackMode === 'whisper') {
                    modeRef.current = 'whisper';
                    setVoiceMode('whisper');
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
            setListening(false);

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
            setVoiceMode('browser');
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
        const mode = resolveVoiceInputMode();

        if (mode === 'browser') {
            const started = startBrowserRecognition();
            if (!started && resolveVoiceInputMode({ browserMode: 'disabled' }) === 'whisper') {
                void startWhisperRecording();
            }
            return;
        }

        if (mode === 'whisper') {
            void startWhisperRecording();
            return;
        }

        showError({ message: 'Voice input not available in this browser' });
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
            isMountedRef.current = false;
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
        voiceMode,
        stopListening,
        toggleListening,
    };
};
