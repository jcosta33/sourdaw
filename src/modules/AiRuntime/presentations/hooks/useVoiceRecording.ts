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
import { onDictationError } from '../../useCases/voiceDictation/onDictationError';
import { onDictationResult } from '../../useCases/voiceDictation/onDictationResult';
import { startDictation } from '../../useCases/voiceDictation/startDictation';
import { stopDictation } from '../../useCases/voiceDictation/stopDictation';
import { resolveVoiceInputMode, type VoiceInputMode } from '../../useCases/voiceInput/resolveVoiceInputMode';
import { onVoiceToggle } from '../../useCases/voiceToggle/onVoiceToggle';

/**
 * Safety margin on top of the native 15s recording cap
 * (`crates/sourdaw-native/src/commands/speech.rs`) plus resample/inference
 * time. The native side always emits `dictation-result` or `dictation-error`
 * when a session ends, but this backstop keeps a future native regression
 * from stranding the UI in "transcribing" forever.
 */
const DICTATION_TIMEOUT_MS = 45_000;

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

    const syncLocalVoiceStatus = (value: { isListening: boolean; transcribing: boolean }): void => {
        setIsListening(value.isListening);
        setTranscribing(value.transcribing);
    };
    const syncVoiceStatus = (value: { isListening: boolean; transcribing: boolean }): void => {
        syncLocalVoiceStatus(setVoiceStatus(value));
    };
    const setListening = (value: boolean): void => {
        syncLocalVoiceStatus(setVoiceListeningStatus(value));
    };
    const setTranscribingAndStore = (value: boolean): void => {
        syncLocalVoiceStatus(setVoiceTranscribingStatus(value));
    };

    const [voiceMode, setVoiceMode] = useState<VoiceInputMode>(null);
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const dictationResultUnlistenRef = useRef<(() => void) | null>(null);
    const dictationErrorUnlistenRef = useRef<(() => void) | null>(null);
    const dictationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dictationErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const modeRef = useRef<VoiceInputMode>(null);
    const isListeningRef = useRef(false);
    const isMountedRef = useRef(true);
    // Incremented once per attempted Whisper session. Every async handler
    // and ref-write registered during a session captures the generation it
    // started with and checks it against the current value before acting,
    // so a stale session — superseded by a newer start, or unmounted — can
    // never clobber state a later session owns.
    const dictationGenerationRef = useRef(0);
    // Synchronous re-entrancy guard for startWhisperRecording. `isListening`
    // state lags behind a rapid double-tap by at least one render, so a
    // second tap can read the stale `false` and start a second session
    // before the first finishes registering its listeners. A ref is read
    // and written immediately, closing that window.
    const whisperStartInFlightRef = useRef(false);

    // Keep ref in sync with state
    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    // ── Whisper recording ───────────────────────────────────────────────

    const clearDictationTimeout = (): void => {
        if (dictationTimeoutRef.current !== null) {
            clearTimeout(dictationTimeoutRef.current);
            dictationTimeoutRef.current = null;
        }
    };

    // Release the native dictation-result listener registered in
    // startWhisperRecording. Safe to call when no listener is active.
    const releaseDictationResultListener = (): void => {
        const unlisten = dictationResultUnlistenRef.current;
        dictationResultUnlistenRef.current = null;
        if (unlisten) {
            unlisten();
        }
    };

    // Release the native dictation-error listener registered in
    // startWhisperRecording. Safe to call when no listener is active.
    const releaseDictationErrorListener = (): void => {
        const unlisten = dictationErrorUnlistenRef.current;
        dictationErrorUnlistenRef.current = null;
        if (unlisten) {
            unlisten();
        }
    };

    // Tears down everything a Whisper session holds while it waits for a
    // native result: both listeners and the defensive timeout. Called once
    // the session is settled (result, error, or timeout) as well as on
    // unmount, so nothing accumulates or fires after the fact.
    const cleanupWhisperRecording = (): void => {
        releaseDictationResultListener();
        releaseDictationErrorListener();
        clearDictationTimeout();
    };

    const showDictationError = (message: string): void => {
        if (dictationErrorTimeoutRef.current !== null) {
            clearTimeout(dictationErrorTimeoutRef.current);
        }
        setErrorText(message);
        dictationErrorTimeoutRef.current = setTimeout(() => {
            dictationErrorTimeoutRef.current = null;
            setErrorText('');
        }, 3000);
    };

    const startWhisperRecording = async (): Promise<void> => {
        // Double-tap guard: a second call while the first is still awaiting
        // model load / listener registration / `startDictation` bails out
        // immediately instead of racing it into a second set of listeners.
        if (whisperStartInFlightRef.current) {
            return;
        }
        whisperStartInFlightRef.current = true;
        const generation = ++dictationGenerationRef.current;
        const isCurrentSession = (): boolean => {
            return isMountedRef.current && generation === dictationGenerationRef.current;
        };

        try {
            // Auto-download and load model on first use
            await ensureWhisperLoaded();
            if (!isCurrentSession()) {
                return;
            }

            // A prior session may still be live if recording restarts before a
            // result arrived — tear it down so listeners and timers do not
            // accumulate.
            cleanupWhisperRecording();

            // Listen for transcription result from Rust. Fires even for an
            // empty transcription, so this is the only path that needs to
            // clear "transcribing" on the happy path.
            const resultUnlisten = await onDictationResult((result) => {
                if (generation !== dictationGenerationRef.current) {
                    return;
                }
                const text = result.text?.trim() ?? '';
                if (text) {
                    setFinalText(text);
                    injectPromptCommand(text);
                }
                syncVoiceStatus({ isListening: false, transcribing: false });
                cleanupWhisperRecording();
            });
            // If the component unmounted, or a newer session superseded this
            // one, while we awaited the listener registration, release it
            // immediately instead of leaking it or double-registering.
            if (!isCurrentSession()) {
                resultUnlisten();
                return;
            }
            dictationResultUnlistenRef.current = resultUnlisten;

            // Listen for a native failure — mic-stream build, recording,
            // resample, or transcription — so the UI never sits stuck in
            // "transcribing" waiting for an event that will never arrive.
            const errorUnlisten = await onDictationError((error) => {
                if (generation !== dictationGenerationRef.current) {
                    return;
                }
                logger.warn(`Native dictation failed: ${error.message}`);
                syncVoiceStatus({ isListening: false, transcribing: false });
                showDictationError(error.message);
                cleanupWhisperRecording();
            });
            if (!isCurrentSession()) {
                errorUnlisten();
                return;
            }
            dictationErrorUnlistenRef.current = errorUnlisten;

            // Start native recording via cpal + whisper inference
            await startDictation();
            if (!isCurrentSession()) {
                return;
            }

            modeRef.current = 'whisper';
            setVoiceMode('whisper');
            setListening(true);
            setFinalText('');
            setInterimText('Recording...');

            // Defensive backstop: if neither event above ever arrives, do not
            // strand the UI in "transcribing" forever.
            dictationTimeoutRef.current = setTimeout(() => {
                if (generation !== dictationGenerationRef.current) {
                    return;
                }
                logger.warn('Native dictation timed out waiting for a result');
                syncVoiceStatus({ isListening: false, transcribing: false });
                showDictationError('Voice dictation timed out. Please try again.');
                cleanupWhisperRecording();
            }, DICTATION_TIMEOUT_MS);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`Whisper recording failed: ${message}`);
            cleanupWhisperRecording();
            syncVoiceStatus({ isListening: false, transcribing: false });
            showDictationError(message);
        } finally {
            whisperStartInFlightRef.current = false;
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
            if (dictationErrorTimeoutRef.current !== null) {
                clearTimeout(dictationErrorTimeoutRef.current);
                dictationErrorTimeoutRef.current = null;
            }
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
