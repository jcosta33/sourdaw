import { useEffect, useRef, useState } from 'react';

import { logger } from '#/infra/logger/appLogger';

import { voiceInputAvailabilityStore } from '../../stores/voiceInputAvailabilityStore';
import { injectVoicePromptDraft } from '../../useCases/injectVoicePromptDraft';
import { setVoiceListeningStatus } from '../../useCases/setVoiceListeningStatus';
import { setVoiceStatus } from '../../useCases/setVoiceStatus';
import { setVoiceTranscribingStatus } from '../../useCases/setVoiceTranscribingStatus';
import { cancelDictation } from '../../useCases/voiceDictation/cancelDictation';
import { onDictationError } from '../../useCases/voiceDictation/onDictationError';
import { onDictationResult } from '../../useCases/voiceDictation/onDictationResult';
import { startDictation } from '../../useCases/voiceDictation/startDictation';
import { stopDictation } from '../../useCases/voiceDictation/stopDictation';
import { voiceCommandGesture } from '../../useCases/voiceInput/voiceCommandGesture';
import { onVoiceToggle } from '../../useCases/voiceToggle/onVoiceToggle';

const DICTATION_TIMEOUT_MS = 45_000;

export type VoiceRecordingState = {
    isListening: boolean;
    interimText: string;
    finalText: string;
    transcribing: boolean;
    errorText: string;
    voiceMode: 'whisper' | null;
    stopListening: () => void;
};

export const useVoiceRecording = (): VoiceRecordingState => {
    const [isListening, setIsListening] = useState(false);
    const [interimText, setInterimText] = useState('');
    const [finalText, setFinalText] = useState('');
    const [transcribing, setTranscribing] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [voiceMode, setVoiceMode] = useState<'whisper' | null>(null);
    const resultUnlistenRef = useRef<(() => void) | null>(null);
    const errorUnlistenRef = useRef<(() => void) | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const generationRef = useRef(0);
    const listeningRef = useRef(false);
    const mountedRef = useRef(true);
    const startInFlightRef = useRef(false);
    const terminalRef = useRef(false);
    const sessionIdRef = useRef<string | null>(null);

    const syncStatus = (value: { isListening: boolean; transcribing: boolean }): void => {
        const status = setVoiceStatus(value);
        setIsListening(status.isListening);
        setTranscribing(status.transcribing);
    };

    const cleanup = (): void => {
        resultUnlistenRef.current?.();
        resultUnlistenRef.current = null;
        errorUnlistenRef.current?.();
        errorUnlistenRef.current = null;
        if (timeoutRef.current !== null) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    };

    const showError = (message: string): void => {
        setErrorText(message);
        setTimeout(() => setErrorText(''), 3000);
    };

    const startLocalDictation = async (): Promise<void> => {
        if (startInFlightRef.current || voiceInputAvailabilityStore.value?.hasVerifiedLocalModel !== true) {
            return;
        }
        startInFlightRef.current = true;
        const generation = ++generationRef.current;
        const sessionId = globalThis.crypto.randomUUID();
        sessionIdRef.current = sessionId;
        const current = (): boolean => mountedRef.current && generation === generationRef.current;
        const settleTerminal = (): boolean => {
            if (!current() || terminalRef.current) {
                return false;
            }
            terminalRef.current = true;
            return true;
        };
        try {
            cleanup();
            terminalRef.current = false;
            const resultUnlisten = await onDictationResult((result) => {
                if (result.sessionId !== sessionId || !settleTerminal()) {
                    return;
                }
                const text = result.text.trim();
                if (text) {
                    setFinalText(text);
                    injectVoicePromptDraft(text);
                }
                sessionIdRef.current = null;
                syncStatus({ isListening: false, transcribing: false });
                cleanup();
            });
            if (!current()) {
                resultUnlisten();
                return;
            }
            resultUnlistenRef.current = resultUnlisten;
            const errorUnlisten = await onDictationError((error) => {
                if (error.sessionId !== sessionId || !settleTerminal()) {
                    return;
                }
                logger.warn(`Native dictation failed: ${error.message}`);
                sessionIdRef.current = null;
                syncStatus({ isListening: false, transcribing: false });
                showError(error.message);
                cleanup();
            });
            if (!current()) {
                errorUnlisten();
                return;
            }
            errorUnlistenRef.current = errorUnlisten;
            const acknowledgedSessionId = await startDictation(sessionId);
            if (!current() || terminalRef.current || acknowledgedSessionId !== sessionId) {
                return;
            }
            setVoiceMode('whisper');
            setVoiceListeningStatus(true);
            setIsListening(true);
            setFinalText('');
            setInterimText('Recording...');
            timeoutRef.current = setTimeout(() => {
                if (!settleTerminal()) {
                    return;
                }
                void cancelDictation(sessionId).catch((error: unknown) =>
                    logger.warn(`cancel_dictation timed out: ${String(error)}`)
                );
                sessionIdRef.current = null;
                syncStatus({ isListening: false, transcribing: false });
                showError('Voice dictation timed out. Please try again.');
                cleanup();
            }, DICTATION_TIMEOUT_MS);
        } catch (error: unknown) {
            terminalRef.current = true;
            if (sessionIdRef.current === sessionId) {
                sessionIdRef.current = null;
            }
            cleanup();
            syncStatus({ isListening: false, transcribing: false });
            showError(error instanceof Error ? error.message : String(error));
        } finally {
            startInFlightRef.current = false;
        }
    };

    const stopListening = (): void => {
        const sessionId = sessionIdRef.current;
        if (!listeningRef.current || sessionId === null) {
            return;
        }
        setVoiceTranscribingStatus(true);
        setTranscribing(true);
        setInterimText('Transcribing...');
        void stopDictation(sessionId).catch((error: unknown) => logger.warn(`stop_dictation failed: ${String(error)}`));
    };

    useEffect(() => {
        listeningRef.current = isListening;
    }, [isListening]);

    useEffect(() => {
        return onVoiceToggle(({ gesture }) => {
            if (!voiceCommandGesture.consume(gesture)) {
                return;
            }
            if (listeningRef.current) {
                stopListening();
                return;
            }
            void startLocalDictation();
        });
    }, []);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
            ++generationRef.current;
            const sessionId = sessionIdRef.current;
            sessionIdRef.current = null;
            if (sessionId !== null) {
                void cancelDictation(sessionId).catch((error: unknown) =>
                    logger.warn(`cancel_dictation on unmount failed: ${String(error)}`)
                );
            }
            cleanup();
        };
    }, []);

    return { isListening, interimText, finalText, transcribing, errorText, voiceMode, stopListening };
};
