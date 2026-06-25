import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    trackStore: { value: null as unknown },
    kneadStore: { value: null as unknown, set: vi.fn() },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    trackStore: mocks.trackStore,
}));

vi.mock('../../stores/kneadStore', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    kneadStore: mocks.kneadStore,
}));

import { hydrateKneadFromTrackStore } from '../hydrateKneadFromTrackStore';

import type { KneadClipState } from '../../stores/kneadStore';

function clipState(clipId: string): KneadClipState {
    return {
        clipId,
        blobs: [],
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };
}

function trackWithClips(clips: Array<{ id: string; kneadState?: KneadClipState }>) {
    return { tracks: [{ id: 't1', clips }] };
}

function baseKneadState(clips: Record<string, KneadClipState>) {
    return {
        activeClipId: null,
        clips,
        contours: {},
        isAnalyzing: false,
        analysisProgress: 0,
    };
}

describe('hydrateKneadFromTrackStore', () => {
    beforeEach(() => {
        mocks.kneadStore.set.mockClear();
        mocks.trackStore.value = null;
        mocks.kneadStore.value = null;
    });

    it('preserves in-memory-only clip blobs not yet present in the trackStore', () => {
        const sessionOnly = clipState('session-only');
        // trackStore has caught up on clip "persisted" but knows nothing of
        // "session-only" yet (e.g. the local edit has not round-tripped into
        // the Arrangement doc that backs the projection).
        const persisted = clipState('persisted');
        mocks.trackStore.value = trackWithClips([{ id: 'persisted', kneadState: persisted }]);
        mocks.kneadStore.value = baseKneadState({ 'session-only': sessionOnly });

        hydrateKneadFromTrackStore();

        expect(mocks.kneadStore.set).toHaveBeenCalledTimes(1);
        const written = mocks.kneadStore.set.mock.calls[0]![0] as ReturnType<typeof baseKneadState>;
        // The session-only blob must survive the re-hydrate — clobbering it is
        // the data-loss bug this guards.
        expect(written.clips['session-only']).toBe(sessionOnly);
        expect(written.clips.persisted).toBe(persisted);
    });

    it('does not write the store when the projected clips are unchanged', () => {
        const shared = clipState('c1');
        mocks.trackStore.value = trackWithClips([{ id: 'c1', kneadState: shared }]);
        mocks.kneadStore.value = baseKneadState({ c1: shared });

        hydrateKneadFromTrackStore();

        // Re-projecting an unchanged document must not trigger a store write
        // (which would spuriously fire the syncKneadToEngine subscriber).
        expect(mocks.kneadStore.set).not.toHaveBeenCalled();
    });
});
