import { useState, useRef, useEffect } from 'react';

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

type PresetReadyOutcome = { status: 'ready' } | { status: 'failed'; error: unknown };
type PresetTerminal = {
    readyOutcome: Promise<PresetReadyOutcome>;
    phase: 'pending' | 'cleanup-current' | 'cleanup-retired' | 'settled' | 'revoked';
};
type PreviewRequest = {
    phase: 'admitting' | 'active' | 'settled';
    owner: Owner | null;
    preset: PresetTerminal | null;
};
type Owner = {
    request: PreviewRequest;
    intent: ReturnType<typeof audioEngine.beginAudioPreviewIntent>;
    stop: () => void;
};

function createOwner(request: PreviewRequest, original: Owner['intent']): Owner {
    let released = false;
    return {
        request,
        intent: {
            ...original,
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                original.release();
            },
        },
        stop: () => undefined,
    };
}

function observePresetReady(intent: Owner['intent']): Promise<PresetReadyOutcome> {
    return (intent.ready ?? Promise.resolve()).then(
        (): PresetReadyOutcome => ({ status: 'ready' }),
        (error: unknown): PresetReadyOutcome => ({ status: 'failed', error })
    );
}

function releaseRequest(request: PreviewRequest, preserveTerminal = false): void {
    request.phase = 'settled';
    if (request.preset && !preserveTerminal) {
        request.preset.phase = 'revoked';
    }
    try {
        request.owner?.stop();
    } finally {
        request.owner?.intent.release();
    }
}

type BufferPreviewState = {
    isCurrent: (owner: Owner) => boolean;
    finish: (owner: Owner) => void;
    report: (owner: Owner, error: unknown) => void;
    setPlayingId: (id: string | null) => void;
};

function startPreviewBuffer(
    { isCurrent, finish, report, setPlayingId }: BufferPreviewState,
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
        onEnded: () => finish(owner),
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
    const requestRef = useRef<PreviewRequest | 'unmounted' | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const owns = (request: PreviewRequest) => requestRef.current === request;
    const clear = (request: PreviewRequest) => {
        if (owns(request)) {
            requestRef.current = null;
            setPlayingId(null);
        }
    };
    const retire = (request: PreviewRequest) => {
        releaseRequest(request);
        clear(request);
    };
    const stop = () => {
        const request = requestRef.current;
        if (request === 'unmounted') {
            return;
        }
        if (request === null) {
            setPlayingId(null);
            return;
        }
        retire(request);
    };
    const onAbort = (owner: Owner) => {
        const request = owner.request;
        const closing = request.phase === 'settled';
        const terminal = request.preset;
        const internalCleanup = terminal?.phase === 'cleanup-current' || terminal?.phase === 'cleanup-retired';
        request.phase = 'settled';
        if (terminal && !closing && !internalCleanup) {
            terminal.phase = 'revoked';
        }
        owner.stop();
        if (owns(request) && !closing) {
            setPlayingId(null);
            if (!internalCleanup) {
                requestRef.current = null;
            }
        }
    };
    const begin = (): Owner | null => {
        const previous = requestRef.current;
        if (previous === 'unmounted') {
            return null;
        }
        const request: PreviewRequest = { phase: 'admitting', owner: null, preset: null };
        // Teardown and engine admission can synchronously start a newer hook request.
        requestRef.current = request;
        if (previous) {
            releaseRequest(previous);
        }
        if (!owns(request) || request.phase !== 'admitting') {
            return null;
        }
        setPlayingId(null);
        const owner = createOwner(request, audioEngine.beginAudioPreviewIntent());
        request.owner = owner;
        if (!owns(request) || request.phase !== 'admitting' || !owner.intent.isCurrent()) {
            releaseRequest(request);
            clear(request);
            return null;
        }
        request.phase = 'active';
        owner.intent.signal.addEventListener('abort', () => onAbort(owner), { once: true });
        return owner;
    };
    const isCurrent = (owner: Owner) =>
        owns(owner.request) && owner.request.phase === 'active' && owner.intent.isCurrent();
    const finish = (owner: Owner) => {
        if (owner.request.phase !== 'settled') {
            clear(owner.request);
        }
    };
    const report = (owner: Owner, error: unknown) => {
        if (!isCurrent(owner)) {
            return;
        }
        releaseRequest(owner.request);
        if (owns(owner.request)) {
            setPlayingId(null);
            logger.warn(new Error('Browser audio preview failed', { cause: error }));
            clear(owner.request);
        }
    };
    const settlePreset = (owner: Owner, terminal: PresetTerminal) => {
        if (owns(owner.request) && owner.request.preset === terminal) {
            terminal.phase = 'settled';
        }
    };
    const reportPreset = (owner: Owner, terminal: PresetTerminal, error: unknown) => {
        if (!owns(owner.request) || terminal.phase === 'settled' || terminal.phase === 'revoked') {
            return;
        }
        const eligible = isCurrent(owner) || terminal.phase === 'cleanup-current';
        // Release can synchronously publish a newer request, so retain this claim until it returns.
        releaseRequest(owner.request, true);
        if (!owns(owner.request)) {
            return;
        }
        terminal.phase = 'settled';
        setPlayingId(null);
        if (eligible) {
            logger.warn(new Error('Browser audio preview failed', { cause: error }));
            if (owns(owner.request)) {
                notifyUser('Could not preview this preset. Try another sound.', 'error');
            }
        }
        clear(owner.request);
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
    ) => startPreviewBuffer({ isCurrent, finish, report: onFailure, setPlayingId }, owner, id, buffer, playbackIntent);
    const preparePreset = async (
        owner: Owner,
        terminal: PresetTerminal,
        id: string,
        presetId: string
    ): Promise<void> => {
        const onFailure = (_owner: Owner, error: unknown) => reportPreset(owner, terminal, error);
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
                retire(owner.request);
                return;
            }
            void terminal.readyOutcome.then((outcome) => {
                if (outcome.status !== 'failed' || !owns(owner.request)) {
                    return;
                }
                if (!isCurrent(owner) || !prepared.isCurrent()) {
                    retire(owner.request);
                    return;
                }
                reportPreset(owner, terminal, outcome.error);
            });
            const playbackIntent: Owner['intent'] = {
                ...owner.intent,
                isCurrent: () => isCurrent(owner) && prepared.isCurrent(),
                release: () => {
                    if (owns(owner.request) && terminal.phase === 'pending') {
                        terminal.phase =
                            isCurrent(owner) && prepared.isCurrent() ? 'cleanup-current' : 'cleanup-retired';
                    }
                    owner.intent.release();
                },
            };
            const playback = startBuffer(owner, id, prepared.buffer, playbackIntent, onFailure);
            if (playback === null) {
                retire(owner.request);
                return;
            }
            await playback.ready;
            settlePreset(owner, terminal);
        } catch (error: unknown) {
            reportPreset(owner, terminal, error);
        }
    };
    const play: PreviewHandle['play'] = (id, source) => {
        const owner = begin();
        if (owner === null) {
            return;
        }
        if ('kind' in source) {
            const terminal: PresetTerminal = { readyOutcome: observePresetReady(owner.intent), phase: 'pending' };
            owner.request.preset = terminal;
            setPlayingId(id);
            void preparePreset(owner, terminal, id, source.presetId);
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
                retire(owner.request);
            }
        }
    };
    useEffect(() => {
        if (requestRef.current === 'unmounted') {
            requestRef.current = null;
        }
        return () => {
            const request = requestRef.current;
            requestRef.current = 'unmounted';
            if (request && request !== 'unmounted') {
                releaseRequest(request);
            }
        };
    }, []);
    return { playingId, play, playTone, playFile, stop };
};
