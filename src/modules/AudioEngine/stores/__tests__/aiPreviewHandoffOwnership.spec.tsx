import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack } from '#/modules/Arrangement/useCases';
import { AiRenderClipPreview } from '#/modules/BrowserAi/presentations/views';

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

// #3766 — an AI-render preview must keep every buffer a successful timeline drop
// placed a clip on, across preview unmount and audio replacement, while still
// reclaiming never-dropped buffers. The gestures below drive the real
// AiRenderClipPreview (via the BrowserAi views barrel); the dropped clip is
// placed the way the AI branch of `useTimelineFileDrop` places it — real
// `addClip` with the drag payload's buffer id — so the clip in the real
// trackStore is the retained clip. `scheduleAudioClips` consumes these buffers
// through the same `getCachedAudioBuffer` lookup asserted here, and
// `scheduleAudioClips.spec.ts` pins that this lookup starts a source when it
// resolves and warns when it misses.

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
const REPLACED_PCM = new Float32Array([-0.5, 0.25, -0.75]);
const CURRENT_STORES = [BUFFER_STORE, META_STORE, RECOVERY_STORE] as const;

type AiRenderDragPayload = { name: string; bufferId: string; durationSeconds: number };

// The audio cache holds its IndexedDB connection across tests, so the fake
// database is installed once for the whole file and its tables are emptied
// between tests. A per-test install would silently strand the cache on the
// first test's database.
const controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });

function renderPreview(audio: Float32Array): {
    row: HTMLElement;
    rerender: (audio: Float32Array) => void;
    unmount: () => void;
} {
    const view = render(<AiRenderClipPreview audio={audio} sampleRate={48_000} label="A" name="Clip A" />);
    const row = screen.getByText('Clip A').closest('div');
    if (!(row instanceof HTMLElement)) {
        throw new TypeError('preview row is not an element');
    }
    return {
        row,
        rerender: (nextAudio: Float32Array) => {
            view.rerender(<AiRenderClipPreview audio={nextAudio} sampleRate={48_000} label="A" name="Clip A" />);
        },
        unmount: view.unmount,
    };
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

function givenAudioTrack(): void {
    addTrack({ name: 'AI Renders', kind: 'audio', suppressAddedEvent: true });
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

describe('AI preview handoff ownership', () => {
    beforeEach(() => {
        controls.committed.clear();
        controls.committedMeta.clear();
        controls.committedRecovery.clear();
        controls.committedCheckpointRetentions.clear();
        placedClipSources.sources.length = 0;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        injectDependencies(addTrack, { eventBus: { emit: vi.fn() } });
    });

    afterEach(async () => {
        clearRuntimeAudioBufferCache();
        await flushIndexedDbTasks(4);
    });

    it('keeps a placed clip audible when a canceled repeat drag precedes the preview unmount', async () => {
        givenAudioTrack();
        const preview = renderPreview(RENDERED_PCM);

        // First drag is dropped onto the timeline; the clip now references the
        // preview's cached buffer.
        const droppedPayload = dragGesture(preview.row, 'copy');
        const clip = placeDroppedClip(droppedPayload);
        // Second drag is canceled off any drop target.
        const canceledPayload = dragGesture(preview.row, 'none');
        preview.unmount();

        // Every drop from one preview reuses one buffer id — the shape the
        // preview's ownership accounting matches.
        expect(droppedBufferId(canceledPayload)).toBe(droppedBufferId(droppedPayload));
        const bufferId = droppedBufferId(droppedPayload);
        expect(clip.audioBufferId).toBe(bufferId);

        // The placed clip survives in the arrangement...
        const retainedClip = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === clip.id);
        expect(retainedClip?.audioBufferId).toBe(bufferId);
        // ...its PCM stays resident...
        expectResidentPcm(bufferId, RENDERED_PCM);
        // ...and persisted...
        await expectDurablePcm(bufferId, RENDERED_PCM);
        // ...and a cache consumer still resolves it into a playing source.
        expectPlaybackResolvesPcm(bufferId, RENDERED_PCM);
    });

    it('keeps a placed clip audible when result replacement replaces the preview audio', async () => {
        givenAudioTrack();
        const preview = renderPreview(RENDERED_PCM);

        const droppedPayload = dragGesture(preview.row, 'copy');
        const clip = placeDroppedClip(droppedPayload);
        dragGesture(preview.row, 'none');
        // A new render result replaces the row's audio: the effect cleanup for
        // the old audio runs without an unmount.
        preview.rerender(REPLACED_PCM);

        const bufferId = droppedBufferId(droppedPayload);
        expect(clip.audioBufferId).toBe(bufferId);
        expectResidentPcm(bufferId, RENDERED_PCM);
        await expectDurablePcm(bufferId, RENDERED_PCM);
        expectPlaybackResolvesPcm(bufferId, RENDERED_PCM);
    });

    it('reclaims a never-dropped preview whose only drag was canceled', async () => {
        givenAudioTrack();
        const preview = renderPreview(RENDERED_PCM);

        const canceledPayload = dragGesture(preview.row, 'none');
        const bufferId = droppedBufferId(canceledPayload);
        preview.unmount();

        expect(getCachedAudioBuffer({ bufferId })).toBeNull();
        await flushIndexedDbTasks();
        expect(controls.committed.has(bufferId)).toBe(false);
    });

    it('keeps both placed clips audible after two successful drops share one preview buffer', async () => {
        givenAudioTrack();
        const preview = renderPreview(RENDERED_PCM);

        const firstPayload = dragGesture(preview.row, 'copy');
        const firstClip = placeDroppedClip(firstPayload);
        const secondPayload = dragGesture(preview.row, 'copy');
        const secondClip = placeDroppedClip(secondPayload);
        preview.unmount();

        const bufferId = droppedBufferId(firstPayload);
        expect(droppedBufferId(secondPayload)).toBe(bufferId);
        expect(firstClip.audioBufferId).toBe(bufferId);
        expect(secondClip.audioBufferId).toBe(bufferId);

        const retainedIds = new Set(
            trackStore.value?.tracks.flatMap((track) => track.clips).map((clip) => clip.id) ?? []
        );
        expect(retainedIds.has(firstClip.id)).toBe(true);
        expect(retainedIds.has(secondClip.id)).toBe(true);
        expectResidentPcm(bufferId, RENDERED_PCM);
        await expectDurablePcm(bufferId, RENDERED_PCM);
        expectPlaybackResolvesPcm(bufferId, RENDERED_PCM);
    });
});
