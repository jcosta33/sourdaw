import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';

import { updateTrack } from '../../../repositories/track/updateTrack';
import { computeTrackHash } from '../../../services/computeTrackHash';
import { trackStore } from '../../../stores/trackStore';
import { initStalenessDetection } from '../initStalenessDetection';

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../services/computeTrackHash', () => ({
    computeTrackHash: vi.fn().mockResolvedValue('mock-hash'),
}));

/**
 * Render settings a buffer baked under the *current* freeze rules carries.
 *
 * These fixtures need it: a frozen track whose `bakeVersion` is older is stale
 * on that ground alone, so without it every case below would take the version
 * branch and none would reach the content-hash logic they exist to test.
 */
const CURRENT_RENDER_SETTINGS = {
    sampleRate: 44_100,
    bitDepth: 32,
    channelCount: 2,
    tailLengthSeconds: 0,
    bakeVersion: FREEZE_BAKE_VERSION,
};

describe('initStalenessDetection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('returns an unsubscribe function', () => {
        const unsub = initStalenessDetection();
        expect(typeof unsub).toBe('function');
        unsub();
    });

    it('does nothing if no tracks are frozen', async () => {
        const unsub = initStalenessDetection();
        trackStore.set({
            tracks: [{ id: 't1', freezeState: { status: 'unfrozen' }, clips: [] } as any],
            selectedTrackId: null,
        });

        // allow microtasks to flush
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('marks a buffer baked under older freeze rules stale without consulting its content', async () => {
        // A buffer written before the current rules was cut short by a tail no
        // declaration sized, and carries this track's fader and pan printed into
        // it. Its content is unchanged and its hash still matches, so the
        // content path would call it fresh — and it is not recoverable by any
        // later fix, only by rendering again.
        const legacyFrozenTrack = {
            id: 't1',
            freezeState: {
                status: 'frozen',
                sourceContentHash: 'mock-hash',
                renderSettings: { ...CURRENT_RENDER_SETTINGS, bakeVersion: undefined },
            },
            clips: [],
            devices: [],
        };
        trackStore.set({ tracks: [legacyFrozenTrack as any], selectedTrackId: null });

        const unsub = initStalenessDetection();
        trackStore.set({ tracks: [{ ...legacyFrozenTrack } as any], selectedTrackId: null });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).not.toHaveBeenCalled();
        const call = vi.mocked(updateTrack).mock.calls[0];
        if (!call) {
            throw new Error('expected the legacy buffer to be marked stale');
        }
        expect(call[0]).toBe('t1');
        expect(call[1](legacyFrozenTrack as any).freezeState.status).toBe('stale');
        unsub();
    });

    it('leaves a buffer baked under the current freeze rules alone', async () => {
        const currentFrozenTrack = {
            id: 't1',
            freezeState: {
                status: 'frozen',
                sourceContentHash: 'mock-hash',
                renderSettings: CURRENT_RENDER_SETTINGS,
            },
            clips: [],
            devices: [],
        };
        trackStore.set({ tracks: [currentFrozenTrack as any], selectedTrackId: null });

        const unsub = initStalenessDetection();
        trackStore.set({ tracks: [{ ...currentFrozenTrack } as any], selectedTrackId: null });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('sets status to stale if frozen track content hash changes', async () => {
        // Initial state with a frozen track
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        const unsub = initStalenessDetection();

        vi.mocked(computeTrackHash).mockResolvedValue('new-hash');

        // Mutate the clips array reference to trigger detection
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [{}], // new reference
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).toHaveBeenCalled();
        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const call = vi.mocked(updateTrack).mock.calls[0];
        if (!call) {
            throw new Error('expected updateTrack to be called');
        }
        const updater = call[1];
        const track = trackStore.value?.tracks[0];
        if (!track) {
            throw new Error('expected a track in the store');
        }
        const updatedTrack = updater(track);

        expect(updatedTrack.freezeState.status).toBe('stale');
        unsub();
    });

    it('does not set status to stale if hash remains the same despite reference change', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'same-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        const unsub = initStalenessDetection();

        vi.mocked(computeTrackHash).mockResolvedValue('same-hash');

        // Mutate the clips array reference
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'same-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [{}], // new reference
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('ignores a track that was not present in the previous state', async () => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        const unsub = initStalenessDetection();

        // A brand-new frozen track appears; it has no prevTrack → continue.
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [{}],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).not.toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('detects staleness when only the devices chain reference changes', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        const unsub = initStalenessDetection();
        vi.mocked(computeTrackHash).mockResolvedValue('new-hash');

        // Same clips reference, but a new devices array reference.
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [],
                    devices: [{ type: 'Reverb' }],
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).toHaveBeenCalled();
        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        unsub();
    });

    it('skips evaluation when the new state is null (store torn down)', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });
        const unsub = initStalenessDetection();

        // Tear the store down — the subscriber receives a null state.
        trackStore.set(null);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).not.toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('skips evaluation when there was no previous state captured at init', async () => {
        // Initialise while the store is empty so prevState is captured as null.
        trackStore.set(null);
        const unsub = initStalenessDetection();

        // A real state arrives, but there is no baseline to compare against.
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: [{}],
                    devices: [],
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).not.toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('does not recompute the hash of an unfrozen track present in both states', async () => {
        // The track exists in the previous state and stays unfrozen — the
        // frozen-status guard short-circuits before any hashing.
        const unfrozenTrack = {
            id: 't1',
            freezeState: { status: 'unfrozen' },
            clips: [{}] as never[],
            devices: [] as never[],
        } as any;
        trackStore.set({ tracks: [unfrozenTrack], selectedTrackId: null });
        const unsub = initStalenessDetection();

        // Re-set with a new clips reference but still unfrozen.
        trackStore.set({
            tracks: [{ ...unfrozenTrack, clips: [{}] as never[] }],
            selectedTrackId: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).not.toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });

    it('does not recompute the hash when a frozen track clips and devices refs are unchanged', async () => {
        const sharedClips = [] as never[];
        const sharedDevices = [] as never[];
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: sharedClips,
                    devices: sharedDevices,
                } as any,
            ],
            selectedTrackId: null,
        });
        const unsub = initStalenessDetection();

        // Re-set carrying the SAME array references → no ref change → no hash.
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    freezeState: {
                        status: 'frozen',
                        sourceContentHash: 'old-hash',
                        renderSettings: CURRENT_RENDER_SETTINGS,
                    },
                    clips: sharedClips,
                    devices: sharedDevices,
                } as any,
            ],
            selectedTrackId: null,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(computeTrackHash).not.toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        unsub();
    });
});
