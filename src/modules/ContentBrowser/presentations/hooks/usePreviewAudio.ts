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

type PreviewState = {
    requestRef: RefObject<PreviewRequest | 'unmounted' | null>;
    setPlayingId: (id: string | null) => void;
};
type PreviewFailure = (owner: Owner, error: unknown) => void;

function ownsRequest(state: PreviewState, request: PreviewRequest): boolean {
    return state.requestRef.current === request;
}

function clearRequest(state: PreviewState, request: PreviewRequest): void {
    if (ownsRequest(state, request)) {
        state.requestRef.current = null;
        state.setPlayingId(null);
    }
}

function retireRequest(state: PreviewState, request: PreviewRequest): void {
    releaseRequest(request);
    clearRequest(state, request);
}

function stopPreview(state: PreviewState): void {
    const request = state.requestRef.current;
    if (request === 'unmounted') {
        return;
    }
    if (request === null) {
        state.setPlayingId(null);
        return;
    }
    retireRequest(state, request);
}

function abortPreview(state: PreviewState, owner: Owner): void {
    const request = owner.request;
    const closing = request.phase === 'settled';
    const terminal = request.preset;
    const internalCleanup = terminal?.phase === 'cleanup-current' || terminal?.phase === 'cleanup-retired';
    request.phase = 'settled';
    if (terminal && !closing && !internalCleanup) {
        terminal.phase = 'revoked';
    }
    owner.stop();
    if (ownsRequest(state, request) && !closing) {
        state.setPlayingId(null);
        if (!internalCleanup) {
            state.requestRef.current = null;
        }
    }
}

function admitPreview(state: PreviewState): Owner | null {
    const previous = state.requestRef.current;
    if (previous === 'unmounted') {
        return null;
    }
    const request: PreviewRequest = { phase: 'admitting', owner: null, preset: null };
    // Teardown and engine admission can synchronously start a newer hook request.
    state.requestRef.current = request;
    if (previous) {
        releaseRequest(previous);
    }
    if (!ownsRequest(state, request) || request.phase !== 'admitting') {
        return null;
    }
    state.setPlayingId(null);
    const owner = createOwner(request, audioEngine.beginAudioPreviewIntent());
    request.owner = owner;
    if (!ownsRequest(state, request) || request.phase !== 'admitting' || !owner.intent.isCurrent()) {
        releaseRequest(request);
        clearRequest(state, request);
        return null;
    }
    request.phase = 'active';
    owner.intent.signal.addEventListener('abort', () => abortPreview(state, owner), { once: true });
    return owner;
}

function isCurrentPreview(state: PreviewState, owner: Owner): boolean {
    return ownsRequest(state, owner.request) && owner.request.phase === 'active' && owner.intent.isCurrent();
}

function finishPreview(state: PreviewState, owner: Owner): void {
    if (owner.request.phase !== 'settled') {
        clearRequest(state, owner.request);
    }
}

function reportPreviewFailure(state: PreviewState, owner: Owner, error: unknown): void {
    if (!isCurrentPreview(state, owner)) {
        return;
    }
    releaseRequest(owner.request);
    if (ownsRequest(state, owner.request)) {
        state.setPlayingId(null);
        logger.warn(new Error('Browser audio preview failed', { cause: error }));
        clearRequest(state, owner.request);
    }
}

function settlePreset(state: PreviewState, owner: Owner, terminal: PresetTerminal): void {
    if (ownsRequest(state, owner.request) && owner.request.preset === terminal) {
        terminal.phase = 'settled';
    }
}

function reportPresetFailure(state: PreviewState, owner: Owner, terminal: PresetTerminal, error: unknown): void {
    if (!ownsRequest(state, owner.request) || terminal.phase === 'settled' || terminal.phase === 'revoked') {
        return;
    }
    const eligible = isCurrentPreview(state, owner) || terminal.phase === 'cleanup-current';
    // Release can synchronously publish a newer request, so retain this claim until it returns.
    releaseRequest(owner.request, true);
    if (!ownsRequest(state, owner.request)) {
        return;
    }
    terminal.phase = 'settled';
    state.setPlayingId(null);
    if (eligible) {
        logger.warn(new Error('Browser audio preview failed', { cause: error }));
        if (ownsRequest(state, owner.request)) {
            notifyUser('Could not preview this preset. Try another sound.', 'error');
        }
    }
    clearRequest(state, owner.request);
}

function resumePreviewContext(
    state: PreviewState,
    owner: Owner,
    onFailure: PreviewFailure = (currentOwner, error) => reportPreviewFailure(state, currentOwner, error)
): Promise<void> {
    const context = getAudioContext();
    const resuming = context.state === 'suspended' ? context.resume() : Promise.resolve();
    void resuming.catch((error: unknown) => onFailure(owner, error));
    return resuming;
}

function startPreviewBuffer(
    state: PreviewState,
    owner: Owner,
    id: string,
    buffer: AudioBuffer,
    playbackIntent = owner.intent,
    onFailure: PreviewFailure = (currentOwner, error) => reportPreviewFailure(state, currentOwner, error)
): ReturnType<typeof playAudioBufferPreview> {
    if (!isCurrentPreview(state, owner)) {
        return null;
    }
    const playback = playAudioBufferPreview({
        buffer,
        gain: 0.7,
        intent: playbackIntent,
        onEnded: () => finishPreview(state, owner),
    });
    if (playback === null) {
        return null;
    }
    owner.stop = playback.stop;
    if (isCurrentPreview(state, owner)) {
        state.setPlayingId(id);
    }
    void playback.ready.catch((error: unknown) => onFailure(owner, error));
    return playback;
}

async function preparePreset(
    state: PreviewState,
    owner: Owner,
    terminal: PresetTerminal,
    id: string,
    presetId: string
): Promise<void> {
    const onFailure: PreviewFailure = (_owner, error) => reportPresetFailure(state, owner, terminal, error);
    try {
        await resumePreviewContext(state, owner, onFailure);
        if (!isCurrentPreview(state, owner)) {
            return;
        }
        const prepared = await renderPresetPreview({
            presetId,
            sampleRate: getAudioContext().sampleRate,
            signal: owner.intent.signal,
            isCurrent: () => isCurrentPreview(state, owner),
        });
        if (!isCurrentPreview(state, owner)) {
            return;
        }
        if (prepared === null || !prepared.isCurrent()) {
            retireRequest(state, owner.request);
            return;
        }
        void terminal.readyOutcome.then((outcome) => {
            if (outcome.status !== 'failed' || !ownsRequest(state, owner.request)) {
                return;
            }
            if (!isCurrentPreview(state, owner) || !prepared.isCurrent()) {
                retireRequest(state, owner.request);
                return;
            }
            reportPresetFailure(state, owner, terminal, outcome.error);
        });
        const playbackIntent: Owner['intent'] = {
            ...owner.intent,
            isCurrent: () => isCurrentPreview(state, owner) && prepared.isCurrent(),
            release: () => {
                if (ownsRequest(state, owner.request) && terminal.phase === 'pending') {
                    terminal.phase =
                        isCurrentPreview(state, owner) && prepared.isCurrent() ? 'cleanup-current' : 'cleanup-retired';
                }
                owner.intent.release();
            },
        };
        const playback = startPreviewBuffer(state, owner, id, prepared.buffer, playbackIntent, onFailure);
        if (playback === null) {
            retireRequest(state, owner.request);
            return;
        }
        await playback.ready;
        settlePreset(state, owner, terminal);
    } catch (error: unknown) {
        reportPresetFailure(state, owner, terminal, error);
    }
}

function playPreview(state: PreviewState, id: string, source: Parameters<PreviewHandle['play']>[1]): void {
    const owner = admitPreview(state);
    if (owner === null) {
        return;
    }
    if ('kind' in source) {
        const terminal: PresetTerminal = { readyOutcome: observePresetReady(owner.intent), phase: 'pending' };
        owner.request.preset = terminal;
        state.setPlayingId(id);
        void preparePreset(state, owner, terminal, id, source.presetId);
        return;
    }
    void resumePreviewContext(state, owner);
    startPreviewBuffer(state, owner, id, source);
}

function playPreviewTone(state: PreviewState, id: string, frequency: number, durationSec: number): void {
    const owner = admitPreview(state);
    if (owner === null) {
        return;
    }
    void resumePreviewContext(state, owner);
    const playback = audioEngine.playAudioPreviewTone(frequency, durationSec, owner.intent);
    if (playback === null) {
        return;
    }
    owner.stop = playback.stop;
    if (isCurrentPreview(state, owner)) {
        state.setPlayingId(id);
    }
    void playback.ready.catch((error: unknown) => reportPreviewFailure(state, owner, error));
}

async function playPreviewFile(state: PreviewState, id: string, file: File): Promise<void> {
    const owner = admitPreview(state);
    if (owner === null) {
        return;
    }
    try {
        await resumePreviewContext(state, owner);
        if (!isCurrentPreview(state, owner)) {
            return;
        }
        const bytes = await file.arrayBuffer();
        if (!isCurrentPreview(state, owner)) {
            return;
        }
        const buffer = await getAudioContext().decodeAudioData(bytes);
        if (isCurrentPreview(state, owner)) {
            startPreviewBuffer(state, owner, id, buffer);
        }
    } catch {
        // Unsupported files remain a best-effort browser preview.
        if (isCurrentPreview(state, owner)) {
            retireRequest(state, owner.request);
        }
    }
}

function unmountPreview(state: PreviewState): void {
    const request = state.requestRef.current;
    state.requestRef.current = 'unmounted';
    if (request && request !== 'unmounted') {
        releaseRequest(request);
    }
}

export const usePreviewAudio = (): PreviewHandle => {
    const requestRef = useRef<PreviewRequest | 'unmounted' | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);
    useEffect(() => {
        if (requestRef.current === 'unmounted') {
            requestRef.current = null;
        }
        return () => unmountPreview({ requestRef, setPlayingId });
    }, []);
    return {
        playingId,
        play: (id, source) => playPreview({ requestRef, setPlayingId }, id, source),
        playTone: (id, frequency, durationSec) =>
            playPreviewTone({ requestRef, setPlayingId }, id, frequency, durationSec),
        playFile: (id, file) => playPreviewFile({ requestRef, setPlayingId }, id, file),
        stop: () => stopPreview({ requestRef, setPlayingId }),
    };
};
