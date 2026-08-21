import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cacheAudioBuffer, getCompensationDelay } from '#/modules/AudioEngine/useCases';
import { projectStore } from '#/modules/Project/stores';
import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createTrack } from '../../../models/Track';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { trackStore } from '../../../stores/trackStore';
import { activeFreezeTasks, freezeTrack } from '../freezeTrack';
import { renderTrackOffline } from '../renderOffline';

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../services/computeTrackHash', () => ({
    computeTrackHash: vi.fn().mockResolvedValue('mock-hash'),
}));

vi.mock('../renderOffline', () => ({
    renderTrackOffline: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

// Only the two I/O helpers are replaced. `getDeviceChainTailSeconds` runs for
// real: freeze's tail is meant to be the declarations' answer, and a stub would
// let this file agree with a freeze that had stopped consulting them.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(() => 0),
}));

const transportMock = vi.hoisted(() => ({ value: null as { tempo: number } | null }));
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    transportStore: {
        get value() {
            return transportMock.value;
        },
    },
}));

describe('freezeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
        transportMock.value = null;
        activeFreezeTasks.clear();
        vi.useFakeTimers();
        vi.setSystemTime(1234567890);
    });

    it('does nothing if store state is missing', async () => {
        trackStore.set(null);
        const didWrite = await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('does nothing if track is not found', async () => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        const didWrite = await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('does nothing if track is already frozen', async () => {
        trackStore.set({
            tracks: [{ id: 't1', freezeState: { status: 'frozen' } } as any],
            selectedTrackId: null,
        });
        const didWrite = await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('should freeze the track successfully', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 2, endBeat: 6 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        const renderedBuffer: AudioBuffer = {
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            duration: 1,
            getChannelData: vi.fn(() => new Float32Array(44100)),
            sampleRate: 44100,
            length: 44100,
            numberOfChannels: 2,
        };
        const project = projectStore.value;
        if (!project) {
            throw new Error('Expected project fixture');
        }
        const expectedBufferId = 'freeze-t1-1234567890';

        vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer);

        const didWrite = await freezeTrack('t1');

        expect(updateTrack).toHaveBeenCalledTimes(2);

        // First call: sets status to 'freezing'
        const freezingCall = vi.mocked(updateTrack).mock.calls[0];
        if (!freezingCall) {
            throw new Error('expected first updateTrack call');
        }
        const storedTrack = trackStore.value!.tracks[0];
        if (!storedTrack) {
            throw new Error('expected track in store');
        }
        const freezingTrack = freezingCall[1](storedTrack);
        expect(freezingTrack.freezeState.status).toBe('freezing');
        expect(freezingTrack.freezeState.renderProgress).toBe(0);

        // Second call: sets status to 'frozen'
        const frozenCall = vi.mocked(updateTrack).mock.calls[1];
        if (!frozenCall) {
            throw new Error('expected second updateTrack call');
        }
        const frozenTrack = frozenCall[1](storedTrack);

        expect(frozenTrack.frozen).toBe(true);
        expect(frozenTrack.frozenBufferId).toBe(expectedBufferId);
        expect(frozenTrack.freezeState).toEqual({
            status: 'frozen',
            freezeId: expectedBufferId,
            frozenBufferId: expectedBufferId,
            sourceContentHash: 'mock-hash',
            compensationSeconds: 0,
            renderSettings: {
                sampleRate: 44100,
                bitDepth: 32,
                channelCount: 2,
                // No devices, so nothing declares a tail and nothing rings past
                // the content. The old heuristic reserved 4 beats here anyway.
                tailLengthSeconds: 0,
                bakeVersion: FREEZE_BAKE_VERSION,
            },
            renderedAt: 1234567890,
        });

        expect(cacheAudioBuffer).toHaveBeenCalledWith({
            buffer: renderedBuffer,
            bufferId: expectedBufferId,
            freezeProjectId: project.createdAt,
        });
        // The region is the clip bounds; the tail travels as seconds beside it.
        expect(renderTrackOffline).toHaveBeenCalledWith(
            expect.any(Object),
            2,
            6,
            expect.objectContaining({ tailSeconds: 0, targetMixer: 'keepLive' })
        );
        expect(didWrite).toBe(true);
    });

    it('does not publish a completed render after another project becomes active', async () => {
        const projectA = projectStore.value;
        if (!projectA) {
            throw new Error('Expected project fixture');
        }
        projectStore.set({ ...projectA, createdAt: 100 });
        trackStore.set({
            tracks: [
                {
                    id: 'shared-track',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        let resolveRender: ((buffer: AudioBuffer) => void) | undefined;
        vi.mocked(renderTrackOffline).mockReturnValue(
            new Promise((resolve) => {
                resolveRender = resolve;
            })
        );
        const pendingFreeze = freezeTrack('shared-track');
        await vi.waitFor(() => {
            expect(renderTrackOffline).toHaveBeenCalledTimes(1);
        });

        const projectBTrack = createTrack({ id: 'shared-track', kind: 'audio', name: 'Project B track' });
        projectStore.set({ ...projectA, createdAt: 200 });
        trackStore.set({ tracks: [projectBTrack], selectedTrackId: 'shared-track' });
        const writesBeforeProjectSwitch = vi.mocked(updateTrack).mock.calls.length;
        const renderedBuffer: AudioBuffer = {
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
            duration: 1 / 44_100,
            getChannelData: () => new Float32Array([0.5]),
            length: 1,
            sampleRate: 44_100,
            numberOfChannels: 1,
        };
        resolveRender?.(renderedBuffer);

        await expect(pendingFreeze).resolves.toBe(false);
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(updateTrack).toHaveBeenCalledTimes(writesBeforeProjectSwitch);
        expect(trackStore.value).toEqual({ tracks: [projectBTrack], selectedTrackId: 'shared-track' });
    });

    it('pins the freeze-time delay compensation onto the freeze state', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });
        // FX-4 residual — the buffer bakes the chain's latency as it stands now,
        // so playback must compensate against this value rather than re-reading
        // a chain that a later plugin-latency change can move underneath it.
        vi.mocked(getCompensationDelay).mockReturnValue(0.032);
        vi.mocked(renderTrackOffline).mockResolvedValue({
            sampleRate: 44100,
            numberOfChannels: 2,
        } as any);

        await freezeTrack('t1');

        const frozenCall = vi.mocked(updateTrack).mock.calls[1];
        if (!frozenCall) {
            throw new Error('expected second updateTrack call');
        }
        const storedTrack = trackStore.value!.tracks[0]!;
        expect(frozenCall[1](storedTrack).freezeState.compensationSeconds).toBe(0.032);
        expect(getCompensationDelay).toHaveBeenCalledWith('t1');
    });

    it('handles render failure gracefully', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockRejectedValue(new Error('Render crashed'));

        const didWrite = await freezeTrack('t1');

        expect(updateTrack).toHaveBeenCalledTimes(2);

        const errorCall = vi.mocked(updateTrack).mock.calls[1];
        if (!errorCall) {
            throw new Error('expected second updateTrack call');
        }
        const storedTrack = trackStore.value!.tracks[0];
        if (!storedTrack) {
            throw new Error('expected track in store');
        }
        const errorTrack = errorCall[1](storedTrack);

        expect(errorTrack.freezeState.status).toBe('error');
        expect(errorTrack.freezeState.errorMessage).toBe('Render crashed');
        expect(notifyUser).toHaveBeenCalledWith('Render crashed', 'error');
        expect(didWrite).toBe(false);
    });

    it('uses defaults 0 and 1 if track has no clips', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockResolvedValue({
            sampleRate: 44100,
            numberOfChannels: 2,
        } as any);

        await freezeTrack('t1');

        expect(renderTrackOffline).toHaveBeenCalledWith(
            expect.any(Object),
            0,
            1,
            expect.objectContaining({ tailSeconds: 0 })
        );
    });

    it('rejects dormant VCA freeze before task, render, cache, or project work', async () => {
        const track = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(track, 'kind', { value: 'vca' });
        trackStore.set({ tracks: [track], selectedTrackId: null });

        const didWrite = await freezeTrack('vca-1');

        expect(updateTrack).not.toHaveBeenCalled();
        expect(renderTrackOffline).not.toHaveBeenCalled();
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('computes the bounds across multiple clips (later clip inside the range)', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    // first clip spans 2..6, second clip 3..5 (fully inside →
                    // neither min nor max updates on the second iteration)
                    clips: [
                        { startBeat: 2, endBeat: 6 },
                        { startBeat: 3, endBeat: 5 },
                    ],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockResolvedValue({
            sampleRate: 44100,
            numberOfChannels: 2,
        } as any);

        await freezeTrack('t1');

        // startBeat stays 2, endBeat stays 6; the tail rides alongside in seconds
        expect(renderTrackOffline).toHaveBeenCalledWith(expect.any(Object), 2, 6, expect.any(Object));
    });

    it('reserves no tail for a device whose name reads like a reverb but declares none', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [{ type: 'Reverb', parameterValues: {}, bypassed: false }],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockResolvedValue({
            sampleRate: 44100,
            numberOfChannels: 2,
        } as any);

        await freezeTrack('t1');

        // The tail used to come from `type.includes('reverb')`, so this
        // descriptor-less type scored 8 beats on its name alone while the Dutch
        // Oven — a real reverb — scored 4. Names decide nothing now; only a
        // `DeviceTailDeclaration` does, and this type has none.
        expect(renderTrackOffline).toHaveBeenCalledWith(
            expect.any(Object),
            0,
            4,
            expect.objectContaining({ tailSeconds: 0 })
        );
    });

    it('throws and marks an error when the offline render returns no buffer', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockResolvedValue(null);

        await freezeTrack('t1');

        const errorCall = vi.mocked(updateTrack).mock.calls[1];
        if (!errorCall) {
            throw new Error('expected second updateTrack call');
        }
        const storedTrack = trackStore.value!.tracks[0];
        if (!storedTrack) {
            throw new Error('expected track in store');
        }
        const errorTrack = errorCall[1](storedTrack);
        expect(errorTrack.freezeState.status).toBe('error');
        expect(errorTrack.freezeState.errorMessage).toBe('Render failed');
    });

    it('restores the unfrozen state when the render is aborted by the user', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        // The freeze run registers its AbortController in activeFreezeTasks.
        // Reject the render using that controller's signal so the abort branch
        // (not the generic error branch) runs.
        vi.mocked(renderTrackOffline).mockImplementation(() => {
            const controller = activeFreezeTasks.get('t1');
            controller?.abort();
            return Promise.reject(new Error('aborted'));
        });

        const didWrite = await freezeTrack('t1');

        const errorCall = vi.mocked(updateTrack).mock.calls[1];
        if (!errorCall) {
            throw new Error('expected second updateTrack call');
        }
        const storedTrack = trackStore.value!.tracks[0];
        if (!storedTrack) {
            throw new Error('expected track in store');
        }
        const restoredTrack = errorCall[1](storedTrack);
        expect(restoredTrack.freezeState.status).toBe('unfrozen');
        expect(didWrite).toBe(true);
    });

    it('records a String-coerced message when the thrown value is not an Error', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockRejectedValue('a string failure');

        const didWrite = await freezeTrack('t1');

        const errorCall = vi.mocked(updateTrack).mock.calls[1];
        if (!errorCall) {
            throw new Error('expected second updateTrack call');
        }
        const storedTrack = trackStore.value!.tracks[0];
        if (!storedTrack) {
            throw new Error('expected track in store');
        }
        const errorTrack = errorCall[1](storedTrack);
        expect(errorTrack.freezeState.status).toBe('error');
        expect(errorTrack.freezeState.errorMessage).toBe('a string failure');
        expect(notifyUser).toHaveBeenCalledWith('a string failure', 'error');
        expect(didWrite).toBe(false);
    });

    it('aborts a previously in-flight freeze for the same track before starting a new one', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });
        const previousController = new AbortController();
        const abortSpy = vi.spyOn(previousController, 'abort');
        activeFreezeTasks.set('t1', previousController);

        vi.mocked(renderTrackOffline).mockResolvedValue({
            sampleRate: 44100,
            numberOfChannels: 2,
        } as any);

        await freezeTrack('t1');

        // The pre-existing task is aborted before the new render begins.
        expect(abortSpy).toHaveBeenCalled();
    });

    it('reports render progress through the onProgress callback', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockImplementation((_, __, ___, opts) => {
            opts?.onProgress?.(0.5);
            return Promise.resolve({ sampleRate: 44100, numberOfChannels: 2 } as any);
        });

        await freezeTrack('t1');

        // Three updateTrack calls: freezing, progress (0.5), frozen.
        const progressCall = vi.mocked(updateTrack).mock.calls[1];
        if (!progressCall) {
            throw new Error('expected progress updateTrack call');
        }
        const storedTrack = trackStore.value!.tracks[0];
        if (!storedTrack) {
            throw new Error('expected track in store');
        }
        const progressTrack = progressCall[1](storedTrack);
        expect(progressTrack.freezeState.renderProgress).toBe(0.5);
    });

    it('records a tail length the transport tempo cannot move', async () => {
        transportMock.value = { tempo: 60 };
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    clips: [{ startBeat: 0, endBeat: 4 }],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockResolvedValue({
            sampleRate: 44100,
            numberOfChannels: 2,
        } as any);

        await freezeTrack('t1');

        const frozenCall = vi.mocked(updateTrack).mock.calls.at(-1);
        if (!frozenCall) {
            throw new Error('expected frozen updateTrack call');
        }
        const storedTrack = trackStore.value!.tracks[0];
        if (!storedTrack) {
            throw new Error('expected track in store');
        }
        const frozenTrack = frozenCall[1](storedTrack);
        // A beat-denominated tail read 4 s here and 2 s at 120 BPM for the same
        // empty chain. A declared tail is a duration: this chain declares none,
        // and the tempo has no say in that.
        expect(frozenTrack.freezeState.renderSettings?.tailLengthSeconds).toBe(0);
    });
});
