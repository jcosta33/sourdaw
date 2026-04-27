import { describe, it, expect, vi } from 'vitest';

import { playAuditionNote } from '../audition';

const { mocks } = vi.hoisted(() => {
    return {
        mocks: {
            trackStoreValue: null as unknown,
            getSynthParamsFromDevices: vi.fn(() => ({
                release: 0.3,
            })),
            scheduleNote: vi.fn(
                () =>
                    ({
                        stop: vi.fn(),
                    }) as unknown as OscillatorNode & { _env?: GainNode }
            ),
        },
    };
});

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        ensureTrackStrip: vi.fn(() => ({
            gainNode: {} as AudioNode,
            deviceNodes: [],
        })),
        context: { currentTime: 0 },
    },
}));

vi.mock('#/modules/Synth/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/useCases')>();
    return {
        ...actual,
        getDrumKitDefByIndex: vi.fn(() => null),
        scheduleDrumKitNote: vi.fn(),
        scheduleNote: mocks.scheduleNote,
        getSynthParamsFromDevices: mocks.getSynthParamsFromDevices,
    };
});

vi.mock('../faustScheduler/startFaustNote', () => ({
    startFaustNote: vi.fn(() => () => {}),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            get value() {
                return mocks.trackStoreValue;
            },
        },
    };
});

describe('playAuditionNote', () => {
    it('falls back to scheduled note when track is missing', () => {
        mocks.trackStoreValue = null;
        playAuditionNote('track-a', 60, 100);
        expect(mocks.scheduleNote).toHaveBeenCalled();
    });

    it('uses track devices to derive synth params when track exists', () => {
        mocks.trackStoreValue = {
            tracks: [{ id: 'track-a', devices: [], parentId: null }],
        };
        playAuditionNote('track-a', 60, 100);
        expect(mocks.getSynthParamsFromDevices).toHaveBeenCalledWith([]);
    });
});
