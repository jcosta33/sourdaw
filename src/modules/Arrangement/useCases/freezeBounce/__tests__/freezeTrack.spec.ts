import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';

import { createTrack } from '../../../models/Track';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { computeTrackHash } from '../../../services/computeTrackHash';
import { adjustmentLayerStore } from '../../../stores/adjustmentLayer';
import { trackStore } from '../../../stores/trackStore';
import { commitAdjustmentLayerMutation } from '../../adjustmentLayer/commitAdjustmentLayerMutation';
import { setLayerMix } from '../../adjustmentLayer/setLayerMix';
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

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: vi.fn(),
}));

describe('freezeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeFreezeTasks.clear();
        trackStore.set({ tracks: [], selectedTrackId: null });
        adjustmentLayerStore.set({ layers: [] });
        vi.mocked(updateTrack).mockImplementation((track_id, updater) => {
            const state = trackStore.value;
            if (!state) {
                return;
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => (track.id === track_id ? updater(track) : track)),
            });
        });
        vi.useFakeTimers();
        vi.setSystemTime(1234567890);
    });

    it('does nothing if store state is missing', async () => {
        trackStore.set(null as any);
        await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track is not found', async () => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing if track is already frozen', async () => {
        trackStore.set({
            tracks: [{ id: 't1', freezeState: { status: 'frozen' } } as any],
            selectedTrackId: null,
        });
        await freezeTrack('t1');
        expect(updateTrack).not.toHaveBeenCalled();
    });

    it('should freeze the track successfully', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
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

        await freezeTrack('t1');

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
            sourceContentHash: 'freeze-v2:mock-hash',
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
    });

    it('discards an in-flight re-freeze when an adjustment layer changes', async () => {
        const stale_track = {
            ...createTrack({ id: 't1', name: 'Track', kind: 'audio' }),
            frozen: true,
            frozenBufferId: 'old-buffer',
            freezeState: {
                status: 'stale' as const,
                freezeId: 'old-freeze',
                frozenBufferId: 'old-buffer',
                sourceContentHash: 'old-source',
            },
        };
        trackStore.set({ tracks: [stale_track], selectedTrackId: null, ghostClips: [] });
        adjustmentLayerStore.set({
            layers: [
                {
                    id: 'layer-1',
                    name: 'Layer',
                    effectType: 'volume',
                    parameters: [{ name: 'Gain', value: 0, min: -60, max: 12, unit: 'dB' }],
                    affectedTrackIds: ['t1'],
                    insertionIndex: 0,
                    regions: [],
                    enabled: true,
                    mix: 0.25,
                    color: '#fff',
                },
            ],
        });
        let complete_render!: (buffer: AudioBuffer) => void;
        vi.mocked(renderTrackOffline).mockReturnValue(
            new Promise<AudioBuffer>((resolve) => {
                complete_render = resolve;
            })
        );

        const freeze = freezeTrack('t1');
        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('freezing');

        commitAdjustmentLayerMutation({
            adjustmentMutationId: 'adjustment-during-freeze',
            mutation: () => setLayerMix('layer-1', 0.75),
        });
        complete_render({ sampleRate: 44_100, numberOfChannels: 2 } as AudioBuffer);
        await freeze;

        expect(trackStore.value?.tracks[0]).toMatchObject({
            frozen: true,
            frozenBufferId: 'old-buffer',
            freezeState: {
                status: 'stale',
                frozenBufferId: 'old-buffer',
            },
        });
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it.each(['clip', 'device'] as const)('discards an in-flight freeze after a %s edit', async (edit_kind) => {
        const track = createTrack({ id: 't1', name: 'Track', kind: 'audio' });
        trackStore.set({ tracks: [track], selectedTrackId: null, ghostClips: [] });
        vi.mocked(computeTrackHash).mockResolvedValueOnce('before-render').mockResolvedValueOnce('after-edit');
        let complete_render!: (buffer: AudioBuffer) => void;
        vi.mocked(renderTrackOffline).mockReturnValue(
            new Promise<AudioBuffer>((resolve) => {
                complete_render = resolve;
            })
        );

        const freeze = freezeTrack('t1');
        await vi.waitFor(() => expect(renderTrackOffline).toHaveBeenCalledOnce());
        const current_state = trackStore.value;
        if (!current_state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...current_state,
            tracks: current_state.tracks.map((candidate) => {
                if (candidate.id !== 't1') {
                    return candidate;
                }
                if (edit_kind === 'clip') {
                    return {
                        ...candidate,
                        clips: [
                            {
                                id: 'clip-1',
                                trackId: 't1',
                                name: 'Edited clip',
                                startBeat: 0,
                                endBeat: 4,
                                type: 'audio',
                                fadeInBeats: 0,
                                fadeOutBeats: 0,
                                gain: 1,
                                color: '#fff',
                                locked: false,
                                muted: false,
                            },
                        ],
                    };
                }
                return {
                    ...candidate,
                    devices: [
                        {
                            id: 'device-1',
                            name: 'Edited device',
                            type: 'eq',
                            bypassed: false,
                            parameterValues: { gain: 6 },
                        },
                    ],
                };
            }),
        });
        complete_render({ sampleRate: 44_100, numberOfChannels: 2 } as AudioBuffer);

        await freeze;

        expect(trackStore.value?.tracks[0]?.freezeState.status).toBe('unfrozen');
        expect(cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('handles render failure gracefully', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    clips: [],
                    devices: [],
                    freezeState: { status: 'unfrozen' },
                } as any,
            ],
            selectedTrackId: null,
        });

        vi.mocked(renderTrackOffline).mockRejectedValue(new Error('Render crashed'));

        await freezeTrack('t1');

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
    });

    it('uses defaults 0 and 1 if track has no clips', async () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
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
});
