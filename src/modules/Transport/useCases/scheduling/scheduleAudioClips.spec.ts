import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { scheduleAudioClips } from './scheduleAudioClips';
import { defaultTransportState } from '../../models/TransportState';

describe('scheduleAudioClips', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not notify when there are no tracks', () => {
        const notifyUser = vi.fn();
        injectDependencies(scheduleAudioClips, {
            trackStore: { value: { tracks: [] } },
            tempoMapStore: { value: { changes: [] } },
            audioBufferCache: { get: vi.fn() },
            ensureTrackStrip: vi.fn(),
            getCurrentTime: vi.fn(() => 0),
            createBufferSource: vi.fn(),
            getAudioContext: vi.fn(() => ({
                createGain: vi.fn(() => ({
                    gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
                    connect: vi.fn(),
                    disconnect: vi.fn(),
                })),
            })),
            getCompensationDelay: vi.fn(() => 0),
            resolveClipsWithComping: vi.fn(() => []),
            getGainAtBeat: vi.fn(() => 0),
            notifyUser,
            scheduleFrozenTrack: vi.fn(() => false),
            collaborationStore: { value: null },
            getAssetTransfer: () => null,
            getTempoAtBeat: vi.fn(() => 120),
        });

        scheduleAudioClips(0, 4, 0, new Set(), new Set(), [], defaultTransportState, 120);

        expect(notifyUser).not.toHaveBeenCalled();
    });
});
