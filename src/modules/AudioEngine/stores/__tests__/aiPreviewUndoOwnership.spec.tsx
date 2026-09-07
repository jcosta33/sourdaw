import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    addClip,
    addTrack,
    deleteTimeRange,
    getArrangementHandlers,
    setTimeOperationDependencies,
} from '#/modules/Arrangement/useCases';
import { AiRenderClipPreview } from '#/modules/BrowserAi/presentations/views';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction } from '#/modules/MIDI/useCases';

import { ensureCachedAudioBuffersDurable } from '../../useCases/ensureCachedAudioBuffersDurable';
import { getCachedAudioBuffer } from '../../useCases/getCachedAudioBuffer';
import { playCachedAudioBufferPreview } from '../../useCases/playCachedAudioBufferPreview';
import { clearRuntimeAudioBufferCache } from '../audioBufferCache';

import {
    BUFFER_STORE,
    META_STORE,
    RECOVERY_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
} from './fakeAudioBufferIndexedDb';

// #3766 follow-up — undo and redo can resurrect clips that reference a preview's
// buffer, through action legs (restoreClip, restoreTimeOperationState with its
// encoded plans) and through callback entries whose closures rewrite whole track
// states. A preview cleanup that runs while such a clip is not live would
// release the buffer and the resurrected clip would be permanently silent.
// These specs drive the real undo machinery: removals and time operations go
// through the registered Arrangement handlers, and the callback flows go
// through the real producers.

const placedClipSources = vi.hoisted(() => ({
    sources: [] as Array<{
        buffer: AudioBuffer | null;
        playbackRate: { value: number };
        connect: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        onended: (() => void) | null;
    }>,
}));

vi.mock('../../useCases/engineAccess/getAudioContext', async () => {
    const { createAudioBuffer } = await import('./preparedAudioBufferTestSupport');
    const context = {
        currentTime: 0,
        sampleRate: 48_000,
        state: 'running' as const,
        destination: { connect: (): void => {} },
        createBuffer: (_numberOfChannels: number, length: number, sampleRate: number): AudioBuffer =>
            createAudioBuffer({ length, sampleRate }),
    };
    return {
        getAudioContext: () => context as unknown as AudioContext,
        audioEngine: { context: context as unknown as AudioContext },
    };
});

vi.mock('../../useCases/scheduling/createBufferSource', async () => {
    return {
        createBufferSource: () => {
            const source = {
                buffer: null as AudioBuffer | null,
                playbackRate: { value: 1 },
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                onended: null as (() => void) | null,
            };
            placedClipSources.sources.push(source);
            return source as unknown as AudioBufferSourceNode;
        },
    };
});

const RENDERED_PCM = new Float32Array([0.5, -0.25, 0.75]);
const CURRENT_STORES = [BUFFER_STORE, META_STORE, RECOVERY_STORE] as const;

type AiRenderDragPayload = { name: string; bufferId: string; durationSeconds: number };

// The audio cache holds its IndexedDB connection across tests, so the fake
// database is installed once for the whole file and its tables are emptied
// between tests. A per-test install would silently strand the cache on the
// first test's database.
const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });

function noChangeTimeOperationPreparation() {
    return {
        status: 'ready' as const,
        hasChanges: false,
        apply: () => false,
        revert: () => false,
    };
}

function installTimeOperationDependencies(): void {
    setTimeOperationDependencies({
        prepareAutomationTimeOperation: () => ({
            status: 'ready' as const,
            hasChanges: false,
            replayPlan: { version: 1 as const, notes: [] },
            inversePlan: null,
            apply: () => false,
            revert: () => false,
        }),
        prepareAutomationTimeStateRestore: noChangeTimeOperationPreparation,
        prepareMidiGlobalTimeTransaction,
        prepareMidiTimeStateRestore: noChangeTimeOperationPreparation,
        prepareTimelineMapTimeOperation: () => ({
            status: 'ready' as const,
            hasChanges: false,
            replayPlan: { version: 1 as const, notes: [] },
            inversePlan: null,
            apply: () => false,
            revert: () => false,
        }),
        prepareTimelineMapStateRestore: noChangeTimeOperationPreparation,
    });
}

function renderPreview(audio: Float32Array): { row: HTMLElement; unmount: () => void } {
    const view = render(<AiRenderClipPreview audio={audio} sampleRate={48_000} label="A" name="Clip A" />);
    const row = screen.getByText('Clip A').closest('div');
    if (!(row instanceof HTMLElement)) {
        throw new TypeError('preview row is not an element');
    }
    return { row, unmount: view.unmount };
}

function dragGesture(row: HTMLElement, dropEffect: DataTransfer['dropEffect']): string {
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'uninitialized', dropEffect };
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.dragEnd(row, { dataTransfer });
    const payload = dataTransfer.setData.mock.calls.find((call) => call[0] === 'application/x-sourdaw-ai-render')?.[1];
    if (typeof payload !== 'string') {
        throw new TypeError('drag payload was not set as a string');
    }
    return payload;
}

function droppedBufferId(payload: string): string {
    const parsed = JSON.parse(payload) as AiRenderDragPayload;
    return parsed.bufferId;
}

function placeDroppedClip(payload: string): { id: string; audioBufferId: string | undefined } {
    const parsed = JSON.parse(payload) as AiRenderDragPayload;
    const trackId = trackStore.value?.selectedTrackId;
    if (!trackId) {
        throw new Error('expected a selected audio track for the drop');
    }
    const clip = addClip({
        trackId,
        startBeat: 0,
        endBeat: 4,
        name: parsed.name,
        type: 'audio',
        audioBufferId: parsed.bufferId,
    });
    if (!clip) {
        throw new Error('expected the dropped clip to be placed');
    }
    return { id: clip.id, audioBufferId: clip.audioBufferId };
}

function liveClipById(clipId: string) {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
}

function selectedTrackId(): string {
    const trackId = trackStore.value?.selectedTrackId;
    if (!trackId) {
        throw new Error('expected a selected audio track');
    }
    return trackId;
}

function expectResidentPcm(bufferId: string, pcm: Float32Array): void {
    expect(getCachedAudioBuffer({ bufferId })?.getChannelData(0)).toEqual(pcm);
}

async function expectDurablePcm(bufferId: string, pcm: Float32Array): Promise<void> {
    const receipt = await ensureCachedAudioBuffersDurable([bufferId]);
    expect(receipt.status).toBe('durable');
    if (receipt.status !== 'durable') {
        throw new Error(`expected a durable receipt, received ${receipt.status}`);
    }
    // The durable row is a structured clone, so its channel data is compared
    // sample-wise: the clone's typed array is not identity-equal to the
    // in-memory one.
    expect(Array.from(controls.committed.get(bufferId)?.channelData[0] ?? [])).toEqual(Array.from(pcm));
    receipt.release();
}

function expectPlaybackResolvesPcm(bufferId: string, pcm: Float32Array): void {
    placedClipSources.sources.length = 0;
    const playback = playCachedAudioBufferPreview({ bufferId, onEnded: () => {} });
    expect(playback).not.toBeNull();
    const source = placedClipSources.sources[0];
    if (!source) {
        throw new Error('expected the resolved buffer to start a source');
    }
    expect(source.buffer?.getChannelData(0)).toEqual(pcm);
}

describe('AI preview undo ownership', () => {
    beforeAll(() => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
    });

    beforeEach(() => {
        controls.committed.clear();
        controls.committedMeta.clear();
        controls.committedRecovery.clear();
        controls.committedCheckpointRetentions.clear();
        placedClipSources.sources.length = 0;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        clearUndoHistory();
        installTimeOperationDependencies();
        injectDependencies(addTrack, { eventBus: { emit: vi.fn() } });
    });

    afterEach(async () => {
        clearRuntimeAudioBufferCache();
        setTimeOperationDependencies(null);
        await flushIndexedDbTasks(4);
    });

    afterAll(() => {
        clearHandlerRegistry();
    });

    it('keeps the buffer alive across an undoable clip removal, and undo restores audible audio', async () => {
        givenAudioTrack();
        const preview = renderPreview(RENDERED_PCM);

        // The drag settles 'none' (the WebKit dropEffect reality), so the
        // handoff count is 0 for the rest of the test: the undo history is the
        // only remaining owner of the buffer once the clip is deleted.
        const payload = dragGesture(preview.row, 'none');
        const clip = placeDroppedClip(payload);
        const bufferId = droppedBufferId(payload);
        expect(clip.audioBufferId).toBe(bufferId);

        // Delete through the real handler path: the undo history now holds an
        // entry whose restoreClip inverse carries the removed clip snapshot.
        await executeAppAction({ type: 'removeClip', payload: { clipId: clip.id } });
        expect(liveClipById(clip.id)).toBeUndefined();

        // The preview unmounts while no live clip references the buffer — only
        // the undo history still owns it.
        preview.unmount();

        expectResidentPcm(bufferId, RENDERED_PCM);
        await expectDurablePcm(bufferId, RENDERED_PCM);

        // Undo resurrects the clip with its buffer id; its audio must resolve.
        await undo();
        const restoredClip = liveClipById(clip.id);
        expect(restoredClip?.audioBufferId).toBe(bufferId);
        expectResidentPcm(bufferId, RENDERED_PCM);
        expectPlaybackResolvesPcm(bufferId, RENDERED_PCM);
    });

    // The deleteTime entry's restore plans carry whole track state in the
    // time-operation codec's encoded form; only the decode path can see the
    // buffer id inside it.
    it('keeps the buffer alive across a handler-driven deleteTime, and undo restores audible audio', async () => {
        givenAudioTrack();
        const preview = renderPreview(RENDERED_PCM);

        const payload = dragGesture(preview.row, 'none');
        const clip = placeDroppedClip(payload);
        const bufferId = droppedBufferId(payload);

        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 0, endBeat: 4 } });
        expect(liveClipById(clip.id)).toBeUndefined();

        preview.unmount();

        expectResidentPcm(bufferId, RENDERED_PCM);
        await expectDurablePcm(bufferId, RENDERED_PCM);

        await undo();
        const restoredClip = liveClipById(clip.id);
        expect(restoredClip?.audioBufferId).toBe(bufferId);
        expectResidentPcm(bufferId, RENDERED_PCM);
        expectPlaybackResolvesPcm(bufferId, RENDERED_PCM);
    });

    // deleteTimeRange files a callback-kind entry whose closures flip whole
    // track states; only its push-time buffer declaration can own the history.
    it('keeps the buffer alive through deleteTimeRange, and undo restores audible audio', async () => {
        givenAudioTrack();
        const preview = renderPreview(RENDERED_PCM);

        const payload = dragGesture(preview.row, 'none');
        const clip = placeDroppedClip(payload);
        const bufferId = droppedBufferId(payload);
        const trackId = selectedTrackId();

        deleteTimeRange(0, 4, [trackId]);
        expect(liveClipById(clip.id)).toBeUndefined();

        preview.unmount();

        expectResidentPcm(bufferId, RENDERED_PCM);
        await expectDurablePcm(bufferId, RENDERED_PCM);

        await undo();
        const restoredClip = liveClipById(clip.id);
        expect(restoredClip?.audioBufferId).toBe(bufferId);
        expectResidentPcm(bufferId, RENDERED_PCM);
        expectPlaybackResolvesPcm(bufferId, RENDERED_PCM);
    });

    // After undoing the clip-creating entry the clip is not live and the entry
    // sits on the future stack: only its action leg (the redo) still owns the
    // buffer across the preview unmount.
    it('keeps the buffer alive across undo while absent, and redo restores audible audio', async () => {
        givenAudioTrack();
        const preview = renderPreview(RENDERED_PCM);

        const payload = dragGesture(preview.row, 'none');
        const bufferId = droppedBufferId(payload);
        const trackId = selectedTrackId();

        await executeAppAction({
            type: 'addClip',
            payload: {
                trackId,
                startBeat: 0,
                endBeat: 4,
                name: 'Clip A',
                type: 'audio',
                audioBufferId: bufferId,
            },
        });
        const placedClip = liveClipByBufferId(bufferId);
        if (!placedClip) {
            throw new Error('expected the placed clip');
        }
        const clipId = placedClip.id;

        await undo();
        expect(liveClipById(clipId)).toBeUndefined();

        preview.unmount();

        expectResidentPcm(bufferId, RENDERED_PCM);
        await expectDurablePcm(bufferId, RENDERED_PCM);

        await redo();
        const restoredClip = liveClipById(clipId);
        expect(restoredClip?.audioBufferId).toBe(bufferId);
        expectResidentPcm(bufferId, RENDERED_PCM);
        expectPlaybackResolvesPcm(bufferId, RENDERED_PCM);
    });
});

function givenAudioTrack(): void {
    addTrack({ name: 'AI Renders', kind: 'audio', suppressAddedEvent: true });
}

function liveClipByBufferId(bufferId: string) {
    return trackStore.value?.tracks
        .flatMap((track) => track.clips)
        .find((candidate) => candidate.audioBufferId === bufferId);
}
