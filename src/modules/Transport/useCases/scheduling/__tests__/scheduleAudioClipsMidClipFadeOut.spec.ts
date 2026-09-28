import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getGainEnvelopeSeries } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    createBufferSource,
    getCompensationDelay,
    getCachedAudioBuffer,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { disposeAudioClipScheduling } from '../disposeAudioClipScheduling';
import { scheduleAudioClips } from '../scheduleAudioClips';

// trackStore holds a single active audio track; resolveClipsWithComping supplies
// the clip(s) under test so the clip shape is controlled directly by each test.
const trackStoreState: { value: { tracks: unknown[] } } = { value: { tracks: [] } };
const { createdGains } = vi.hoisted(() => ({
    createdGains: [] as Array<{ gain: { linearRampToValueAtTime: ReturnType<typeof vi.fn> } }>,
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    getGainEnvelopeSeries: vi.fn(() => undefined),
}));
const { tempoMapStore } = vi.hoisted((): { tempoMapStore: { value: { changes: unknown[] } | null } } => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../../stores/tempoMapStore', () => ({ tempoMapStore }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: vi.fn(() => ({ gainNode: { connect: vi.fn() } })),
    getCurrentTime: vi.fn(() => 0),
    createBufferSource: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    getAudioContext: vi.fn(() => ({
        currentTime: 0,
        createGain: vi.fn(() => {
            const node = {
                gain: {
                    value: 1,
                    cancelScheduledValues: vi.fn(),
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn(),
                    exponentialRampToValueAtTime: vi.fn(),
                },
                connect: vi.fn(),
                disconnect: vi.fn(),
            };
            createdGains.push(node);
            return node;
        }),
    })),
    getCompensationDelay: vi.fn(() => 0),
}));
// `projectClipLoopExpansion` is deliberately not stubbed: it is a pure leaf in
// `#/utils/clipLoopProjection` with its own spec, and these assertions are meant to run against the
// real loop projection.
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: vi.fn(() => []),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));
vi.mock('../scheduleFrozenTrack', () => ({
    scheduleFrozenTrack: vi.fn(() => false),
}));
const collaborationStoreState: { value: { isEnabled: boolean } | null } = { value: null };
vi.mock('#/modules/Collaboration/stores', () => ({
    collaborationStore: {
        get value() {
            return collaborationStoreState.value;
        },
    },
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: vi.fn(() => null),
}));
// `TempoMap` is deliberately NOT stubbed: it is a pure leaf with its own spec,
// and the timing these tests pin is exactly the question of which conversion the
// scheduler asks it for. With an empty map every query falls back to
// `defaultTransportState.tempo` (120), so the timeline runs at 2 beats/s.

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
        gain: 1,
        ...overrides,
    };
}

type StartFn = (when: number, offset: number, duration: number) => void;

/**
 * A fresh fake AudioBufferSourceNode that records its start() arguments.
 *
 * `start` rejects a negative `when`, `offset`, or `duration` because the real
 * node does: the Web Audio specification requires
 * `AudioBufferSourceNode.start(when, offset, duration)` to throw a
 * `RangeError` when any of the three is negative — `when` has no meaning
 * before the context's origin, `offset` has no earlier sample to seek to, and
 * `duration` has no negative span of audio to play. A fake that only checked
 * `offset` would stay green on a scheduler that computes a negative
 * `playDuration` and hands it straight to `start()` — exactly the defect the
 * `playDuration <= 0` guard in `scheduleAudioClips.ts` exists to prevent.
 */
function makeFakeSource(): { start: ReturnType<typeof vi.fn<StartFn>>; [k: string]: unknown } {
    return {
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start: vi.fn<StartFn>((when, offset, duration) => {
            if (when < 0 || offset < 0 || duration < 0) {
                throw new RangeError('start() arguments must be non-negative');
            }
        }),
        onended: null,
    };
}

// Audit #4591 — starting playback in the middle of a clip starts its source at
// `now` with the elapsed offset, so the source ends at `soundStartTime +
// playDuration`. The anti-click micro fade-out must land on that end, not
// `playDuration` after `now`, or the clip is cut off abruptly.
describe('scheduleAudioClips — micro fade-out after a mid-clip start', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createdGains.length = 0;
        disposeAudioClipScheduling();
        tempoMapStore.value = { changes: [] };
        vi.mocked(getCompensationDelay).mockReturnValue(0);
        vi.mocked(getGainEnvelopeSeries).mockReturnValue(undefined);
        vi.mocked(getAssetTransfer).mockReturnValue(null);
    });

    it('ramps the clip to silence at the moment its source ends', () => {
        // 120 BPM: clip beats 8–12 sound from 4 s to 6 s. Playback resumes at
        // beat 10 with the audio clock at 5 s, halfway through the clip.
        vi.mocked(getCurrentTime).mockReturnValue(5);
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(10, 12, 10, new Set(), new Set(), [], defaultTransportState);

        const [when, , duration] = fakeSource.start.mock.calls[0]!;
        const sourceEnd = when + duration;
        expect(sourceEnd).toBeCloseTo(6, 9);
        const rampCalls = createdGains.flatMap((node) => node.gain.linearRampToValueAtTime.mock.calls);
        const rampsToSilence = rampCalls.filter(([value]) => value === 0).map(([, time]) => time as number);
        expect(rampsToSilence).toContain(sourceEnd);
    });
});
