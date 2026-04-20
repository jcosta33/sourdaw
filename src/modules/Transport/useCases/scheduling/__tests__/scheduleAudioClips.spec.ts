import { describe, it, expect, vi, beforeEach } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { defaultTransportState } from '../../../models/TransportState';
import { scheduleAudioClips } from '../scheduleAudioClips';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { get: vi.fn() },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
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
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: vi.fn(() => []),
    getGainAtBeat: vi.fn(() => 0),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));
vi.mock('../scheduleMidiNotes', () => ({
    scheduleFrozenTrack: vi.fn(() => false),
}));
vi.mock('#/modules/Collaboration/stores', () => ({
    collaborationStore: { value: null },
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: vi.fn(() => null),
}));
vi.mock('../../models/TempoMap', () => ({
    getTempoAtBeat: vi.fn(() => 120),
}));

describe('scheduleAudioClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not notify when there are no tracks', () => {
        scheduleAudioClips(0, 4, 0, new Set(), new Set(), [], defaultTransportState, 120);

        expect(notifyUser).not.toHaveBeenCalled();
    });
});
