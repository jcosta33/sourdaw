import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { playAuditionNote } from './audition';

describe('playAuditionNote', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('resolves the track before scheduling', () => {
        const getTrackById = vi.fn(() => null);
        const getSynthParamsForTrack = vi.fn(() => ({
            release: 0.3,
        }));
        const scheduleNote = vi.fn(
            () =>
                ({
                    stop: vi.fn(),
                }) as unknown as OscillatorNode & { _env?: GainNode }
        );

        injectDependencies(playAuditionNote, {
            audioEngine: {
                ensureTrackStrip: vi.fn(() => ({
                    gainNode: {} as AudioNode,
                    deviceNodes: [],
                })),
                context: { currentTime: 0 },
            },
            getTrackById,
            getDrumKitDefByIndex: vi.fn(() => null),
            scheduleDrumKitNote: vi.fn(),
            trackStore: { value: null },
            startFaustNote: vi.fn(() => () => {}),
            getSynthParamsForTrack,
            scheduleNote,
        });

        playAuditionNote('track-a', 60, 100);

        expect(getTrackById).toHaveBeenCalledWith('track-a');
    });
});
