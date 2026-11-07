import { type RefObject, useState, useRef, useEffect } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { audioEngine, getAudioContext, playAudioBufferPreview } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { renderPresetPreview } from '../../useCases/renderPresetPreview';

export type PreviewHandle = {
    playingId: string | null;
    play: (id: string, source: AudioBuffer | { kind: 'preset'; presetId: string }) => void;
    playTone: (id: string, frequency: number, durationSec: number) => void;
    playFile: (id: string, file: File) => Promise<void>;
    stop: () => void;
};

type Owner = {
    intent: ReturnType<typeof audioEngine.beginAudioPreviewIntent>;
    stop: () => void;
};

type PresetReadyOutcome = { status: 'ready' } | { status: 'failed'; error: unknown };

type PresetTerminal = {
    owner: Owner;
    readyOutcome: Promise<PresetReadyOutcome>;
    phase: 'pending' | 'cleanup-current' | 'cleanup-retired' | 'settled' | 'revoked';
};

function observePresetReady(intent: Owner['intent']): Promise<PresetReadyOutcome> {
    return (intent.ready ?? Promise.resolve()).then(
        (): PresetReadyOutcome => ({ status: 'ready' }),
        (error: unknown): PresetReadyOutcome => ({ status: 'failed', error })
    );
}

function revokePresetTerminal(terminalRef: RefObject<PresetTerminal | null>): void {
    const terminal = terminalRef.current;
    terminalRef.current = null;
    if (terminal) {
        terminal.phase = 'revoked';
    }
}

function releaseOwner(ownerRef: RefObject<Owner | null>): void {
    const owner = ownerRef.current;
    ownerRef.current = null;
    try {
        owner?.stop();
    } finally {
        owner?.intent.release();
    }
}

type BufferPreviewState = {
    ownerRef: RefObject<Owner | null>;
    isCurrent: (owner: Owner) => boolean;
    report: (owner: Owner, error: unknown) => void;
    setPlayingId: (id: string | null) => void;
};

function startPreviewBuffer(
    { ownerRef, isCurrent, report, setPlayingId }: BufferPreviewState,
    owner: Owner,
    id: string,
    buffer: AudioBuffer,
    playbackIntent = owner.intent
): ReturnType<typeof playAudioBufferPreview> {
    if (!isCurrent(owner)) {
        return null;
    }
    const playback = playAudioBufferPreview({
        buffer,
        gain: 0.7,
        intent: playbackIntent,
        onEnded: () => {
            if (ownerRef.current === owner) {
                ownerRef.current = null;
                setPlayingId(null);
            }
        },
    });
    if (playback === null) {
        return null;
    }
    owner.stop = playback.stop;
    if (isCurrent(owner)) {
        setPlayingId(id);
    }
    void playback.ready.catch((error: unknown) => report(owner, error));
    return playback;
}

export const usePreviewAudio = (): PreviewHandle => {
    const ownerRef = useRef<Owner | null>(null);
    const terminalRef = useRef<PresetTerminal | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);

    const release = () => releaseOwner(ownerRef);
    const stop = () => {
        revokePresetTerminal(terminalRef);
        release();
        setPlayingId(null);
    };
    const begin = (): Owner | null => {
        stop();
        const intent = audioEngine.beginAudioPreviewIntent();
        if (!intent.isCurrent()) {
            return null;
        }
        const owner: Owner = { intent, stop: () => undefined };
        ownerRef.current = owner;
        intent.signal.addEventListener(
            'abort',
            () => {
                const terminal = terminalRef.current;
                if (terminal?.owner === owner && terminal.phase === 'pending') {
                    revokePresetTerminal(terminalRef);
                }
                owner.stop();
                if (ownerRef.current === owner) {
                    ownerRef.current = null;
                    setPlayingId(null);
                }
            },
            { once: true }
        );
        return owner;
    };
    const isCurrent = (owner: Owner) => ownerRef.current === owner && owner.intent.isCurrent();
    const report = (owner: Owner, error: unknown) => {
        if (isCurrent(owner)) {
            stop();
            logger.warn(new Error('Browser audio preview failed', { cause: error }));
        }
    };
    const settlePreset = (terminal: PresetTerminal) => {
        if (terminalRef.current !== terminal) {
            return;
        }
        terminalRef.current = null;
        terminal.phase = 'settled';
    };
    const reportPreset = (terminal: PresetTerminal, error: unknown) => {
        if (terminalRef.current !== terminal) {
            return;
        }
        const eligible = isCurrent(terminal.owner) || terminal.phase === 'cleanup-current';
        settlePreset(terminal);
        if (ownerRef.current === terminal.owner) {
            release();
            setPlayingId(null);
        }
        if (eligible) {
            logger.warn(new Error('Browser audio preview failed', { cause: error }));
            notifyUser('Could not preview this preset. Try another sound.', 'error');
        }
    };
    const resume = (owner: Owner, onFailure = report): Promise<void> => {
        const context = getAudioContext();
        const resuming = context.state === 'suspended' ? context.resume() : Promise.resolve();
        void resuming.catch((error: unknown) => onFailure(owner, error));
        return resuming;
    };
    const startBuffer = (
        owner: Owner,
        id: string,
        buffer: AudioBuffer,
        playbackIntent = owner.intent,
        onFailure = report
    ) => {
        return startPreviewBuffer(
            { ownerRef, isCurrent, report: onFailure, setPlayingId },
            owner,
            id,
            buffer,
            playbackIntent
        );
    };
    const preparePreset = async (terminal: PresetTerminal, id: string, presetId: string): Promise<void> => {
        const { owner } = terminal;
        const onFailure = (_owner: Owner, error: unknown) => reportPreset(terminal, error);
        try {
            await resume(owner, onFailure);
            if (!isCurrent(owner)) {
                return;
            }
            const prepared = await renderPresetPreview({
                presetId,
                sampleRate: getAudioContext().sampleRate,
                signal: owner.intent.signal,
                isCurrent: () => isCurrent(owner),
            });
            if (!isCurrent(owner)) {
                return;
            }
            if (prepared === null || !prepared.isCurrent()) {
                stop();
                return;
            }
            void terminal.readyOutcome.then((outcome) => {
                if (outcome.status !== 'failed' || terminalRef.current !== terminal) {
                    return;
                }
                if (!isCurrent(owner) || !prepared.isCurrent()) {
                    if (ownerRef.current === owner) {
                        stop();
                    }
                    return;
                }
                reportPreset(terminal, outcome.error);
            });
            const playbackIntent: Owner['intent'] = {
                ...owner.intent,
                isCurrent: () => isCurrent(owner) && prepared.isCurrent(),
                release: () => {
                    if (terminalRef.current === terminal && terminal.phase === 'pending') {
                        terminal.phase =
                            isCurrent(owner) && prepared.isCurrent() ? 'cleanup-current' : 'cleanup-retired';
                    }
                    owner.intent.release();
                },
            };
            const playback = startBuffer(owner, id, prepared.buffer, playbackIntent, onFailure);
            if (playback === null) {
                if (ownerRef.current === owner) {
                    stop();
                }
                settlePreset(terminal);
                return;
            }
            await playback.ready;
            settlePreset(terminal);
        } catch (error: unknown) {
            reportPreset(terminal, error);
        }
    };
    const play: PreviewHandle['play'] = (id, source) => {
        const owner = begin();
        if (owner === null) {
            return;
        }
        if ('kind' in source) {
            const terminal: PresetTerminal = {
                owner,
                readyOutcome: observePresetReady(owner.intent),
                phase: 'pending',
            };
            terminalRef.current = terminal;
            setPlayingId(id);
            void preparePreset(terminal, id, source.presetId);
            return;
        }
        void resume(owner);
        startBuffer(owner, id, source);
    };
    const playTone = (id: string, frequency: number, durationSec: number) => {
        const owner = begin();
        if (owner === null) {
            return;
        }
        void resume(owner);
        const playback = audioEngine.playAudioPreviewTone(frequency, durationSec, owner.intent);
        if (playback === null) {
            return;
        }
        owner.stop = playback.stop;
        if (isCurrent(owner)) {
            setPlayingId(id);
        }
        void playback.ready.catch((error: unknown) => report(owner, error));
    };
    const playFile = async (id: string, file: File): Promise<void> => {
        // The gesture owns cancellation before resume, file reads or decoding;
        // decoded completion never acquires a new intent over a newer A/B.
        const owner = begin();
        if (owner === null) {
            return;
        }
        try {
            await resume(owner);
            if (!isCurrent(owner)) {
                return;
            }
            const bytes = await file.arrayBuffer();
            if (!isCurrent(owner)) {
                return;
            }
            const buffer = await getAudioContext().decodeAudioData(bytes);
            if (isCurrent(owner)) {
                startBuffer(owner, id, buffer);
            }
        } catch {
            // Unsupported files remain a best-effort browser preview.
            if (isCurrent(owner)) {
                stop();
            }
        }
    };
    useEffect(
        () => () => {
            revokePresetTerminal(terminalRef);
            releaseOwner(ownerRef);
        },
        []
    );
    return { playingId, play, playTone, playFile, stop };
};
