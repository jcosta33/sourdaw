import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { createBufferSource, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { defaultTransportState } from '../../../models/TransportState';
import { sessionState } from '../audioClipSchedulingState';
import { disposeAudioClipScheduling } from '../disposeAudioClipScheduling';
import { scheduleAudioClips } from '../scheduleAudioClips';

// trackStore holds a single active audio track; resolveClipsWithComping supplies
// the clip(s) under test so the clip shape is controlled directly by each test.
const trackStoreState: { value: { tracks: unknown[] } } = { value: { tracks: [] } };
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
}));
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: vi.fn(() => ({ gainNode: { connect: vi.fn() } })),
    getCurrentTime: vi.fn(() => 0),
    createBufferSource: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getAudioContext: vi.fn(() => ({
        currentTime: 0,
        createGain: vi.fn(() => ({
            gain: {
                value: 1,
                cancelScheduledValues: vi.fn(),
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
            },
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
vi.mock('../scheduleFrozenTrack', () => ({
    scheduleFrozenTrack: vi.fn(() => false),
}));
vi.mock('#/modules/Collaboration/stores', () => ({
    collaborationStore: { value: null },
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: vi.fn(() => null),
}));
// clipTempo (tempo at clip.startBeat) is 120 -> clipBeatsPerSecond = 2. The
// timeline tempo is passed to scheduleAudioClips directly, so the two diverge.
vi.mock('../../models/TempoMap', () => ({
    getTempoAtBeat: vi.fn(() => 120),
}));

const mockResolveClips = vi.mocked(resolveClipsWithComping);
const mockCreateBufferSource = vi.mocked(createBufferSource);
const mockGetCachedAudioBuffer = vi.mocked(getCachedAudioBuffer);

function makeAudioTrack(clips: unknown[]): unknown {
    return {
        id: 'track-1',
        kind: 'audio',
        muted: false,
        clips,
        freezeState: { status: 'active', frozenBufferId: null },
    };
}

function makeAudioClip(overrides: Record<string, unknown> = {}): unknown {
    return {
        id: 'clip-1',
        name: 'Clip 1',
        type: 'audio',
        muted: false,
        audioBufferId: 'buf-1',
        regionStartBeat: 0,
        regionEndBeat: 4,
        startBeat: 8,
        endBeat: 12,
        stretchMode: 'off',
        stretchRatio: 1,
        loopEnabled: false,
        loopLength: undefined,
        audioOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        ...overrides,
    };
}

type StartFn = (when: number, offset: number, duration: number) => void;

/** A fresh fake AudioBufferSourceNode that records its start() arguments. */
function makeFakeSource(): { start: ReturnType<typeof vi.fn<StartFn>>; [k: string]: unknown } {
    return {
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start: vi.fn<StartFn>(),
        onended: null,
    };
}

describe('scheduleAudioClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStoreState.value = { tracks: [] };
        mockResolveClips.mockReturnValue([]);
        disposeAudioClipScheduling();
    });

    it('does not notify when there are no tracks', () => {
        trackStoreState.value = { tracks: [] };
        scheduleAudioClips(0, 4, 0, new Set(), new Set(), [], defaultTransportState, 120);

        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('sizes clip playback from the timeline tempo, not the clip-start tempo (regression: §B fix 3)', () => {
        // Timeline tempo 60 -> 1 beat/s; clip-start tempo 120 -> 2 beats/s. The clip
        // spans 4 visual beats (8..12). The audible duration must follow the timeline
        // (4 beats / 1 bps = 4 s), not the clip's local rate (4 / 2 = 2 s).
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState, 60);

        expect(mockGetCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(fakeSource.start).toHaveBeenCalledTimes(1);
        const [when, offset, duration] = fakeSource.start.mock.calls[0]!;
        // iterStartTime = getCurrentTime() + (8 - 0)/(60/60) + 0 = 8.
        expect(when).toBeCloseTo(8, 6);
        expect(offset).toBeCloseTo(0, 6);
        // playDuration * stretchRatio(1): timeline duration 4 s, NOT the 2 s the bug gave.
        expect(duration).toBeCloseTo(4, 6);
    });

    it('keeps the start time and the duration on the same tempo basis (regression: §B fix 3)', () => {
        // With the bug, start time used the timeline tempo while duration used the
        // clip tempo, so duration != (endTime - startTime). Assert they agree.
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState, 60);

        expect(mockGetCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        const [when, , duration] = fakeSource.start.mock.calls[0]!;
        // endTime for the 4-beat span at timeline tempo 60 is when + 4. duration must
        // equal that span (when + duration === endTime).
        const endTime = when + duration;
        expect(endTime).toBeCloseTo(12, 6); // beat 12 at 1 beat/s from time 0 with offset 8
    });

    it('disposeAudioClipScheduling clears the requested-asset dedup (regression: §B fix 5)', () => {
        sessionState.requestedAssets.add('hash-a');
        sessionState.requestedAssets.add('hash-b');
        expect(sessionState.requestedAssets.size).toBe(2);

        disposeAudioClipScheduling();

        expect(sessionState.requestedAssets.size).toBe(0);
    });
});
