import { describe, it, expect, vi, beforeEach } from 'vitest';

import { playAuditionNote } from '../audition';

const { mocks } = vi.hoisted(() => {
    return {
        mocks: {
            getTrackById: vi.fn(() => null),
            getSynthParamsForTrack: vi.fn(() => ({
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

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        getTrackById: mocks.getTrackById,
        getSynthParamsForTrack: mocks.getSynthParamsForTrack,
    };
});

vi.mock('#/modules/Synth/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/useCases')>();
    return {
        ...actual,
        getDrumKitDefByIndex: vi.fn(() => null),
        scheduleDrumKitNote: vi.fn(),
        startFaustNote: vi.fn(() => () => {}),
        scheduleNote: mocks.scheduleNote,
    };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: { value: null },
    };
});

describe('playAuditionNote', () => {
    it('resolves the track before scheduling', () => {
        playAuditionNote('track-a', 60, 100);

        expect(mocks.getTrackById).toHaveBeenCalledWith('track-a');
    });
});
