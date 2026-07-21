import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';

import { createTrack } from '../../../models/Track';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { trackStore } from '../../../stores/trackStore';
import { freezeTrack } from '../freezeTrack';
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

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: vi.fn(),
}));

describe('freezeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
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
            renderSettings: {
                sampleRate: 44100,
                bitDepth: 32,
                channelCount: 2,
                tailLengthSeconds: 2,
            },
            renderedAt: 1234567890,
        });

        expect(cacheAudioBuffer).toHaveBeenCalledWith({ buffer: renderedBuffer, bufferId: expectedBufferId });
        expect(renderTrackOffline).toHaveBeenCalledWith(expect.any(Object), 2, 6 + 4, expect.any(Object)); // 6 end + 4 tail
        expect(didWrite).toBe(true);
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
        expect(didWrite).toBe(true);
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

        expect(renderTrackOffline).toHaveBeenCalledWith(expect.any(Object), 0, 1 + 4, expect.any(Object));
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
});
