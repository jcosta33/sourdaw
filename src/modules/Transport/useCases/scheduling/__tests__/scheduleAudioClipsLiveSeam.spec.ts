import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getGainEnvelopeSeries } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    createBufferSource,
    getCompensationDelay,
    getCachedAudioBuffer,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { disposeAudioClipScheduling } from '../disposeAudioClipScheduling';
import { scheduleAudioClips } from '../scheduleAudioClips';

/**
 * Review probe (#5198, live-two-segment-seam stance), folded: a pass's
 * segments must place their starts on one clock read — the pass head's — so
 * the wrap segment lands exactly where the tail ends. Chromium advances
 * `AudioContext.currentTime` once per 128-sample render quantum, so a fresh
 * `getCurrentTime()` taken after the tail's source was built, connected and
 * started read one quantum late whenever a quantum boundary crossed between
 * the reads: a ~2.67 ms live-only gap at the seam, once per affected pass.
 *
 * The offline twin of each golden read is the pure beat→seconds walk pinned
 * in AudioEngine's `projectOfflineAudioClipPlaybacksLoopOrigin.spec.ts`;
 * a Transport spec cannot import it (cross-module imports are barrel-only),
 * so the offline reads appear here as golden triples.
 *
 * Flat 120 BPM (0.5 s/beat) throughout; buffer 4 s (8 beats).
 */

const trackStoreState: { value: { tracks: unknown[] } } = { value: { tracks: [] } };
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
        createGain: vi.fn(() => ({
            gain: {
                value: 1,
                cancelScheduledValues: vi.fn(),
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
                exponentialRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
            disconnect: vi.fn(),
        })),
    })),
    getCompensationDelay: vi.fn(() => 0),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: vi.fn(() => []),
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

const mockCreateBufferSource = vi.mocked(createBufferSource);
const mockGetCachedAudioBuffer = vi.mocked(getCachedAudioBuffer);
const mockResolveClips = vi.mocked(resolveClipsWithComping);

type StartFn = (when: number, offset: number, duration: number) => void;

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

function passClip(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        id: 'clip-1',
        name: 'Clip 1',
        type: 'audio',
        muted: false,
        audioBufferId: 'buf-1',
        regionStartBeat: 0,
        regionEndBeat: 32,
        stretchMode: 'off',
        stretchRatio: 1,
        loopEnabled: true,
        loopLength: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        ...overrides,
    };
}

function scheduleLive(
    clip: Record<string, unknown>,
    fromBeat = 0,
    toBeat = 32
): Array<ReturnType<typeof makeFakeSource>> {
    const sources: Array<ReturnType<typeof makeFakeSource>> = [];
    mockCreateBufferSource.mockImplementation(() => {
        const fake = makeFakeSource();
        sources.push(fake);
        return fake as unknown as AudioBufferSourceNode;
    });
    mockGetCachedAudioBuffer.mockReturnValue({ duration: 4 } as AudioBuffer);
    mockResolveClips.mockReturnValue([clip] as never);
    trackStoreState.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'audio',
                muted: false,
                clips: [],
                freezeState: { status: 'active', frozenBufferId: null },
            },
        ],
    };
    scheduleAudioClips(fromBeat, toBeat, 0, new Set(), new Set(), [], defaultTransportState);
    return sources;
}

/** Live start(when, offset, duration) triples in scheduling order. */
function liveTriples(sources: Array<ReturnType<typeof makeFakeSource>>) {
    return sources.map((source) => {
        const [when, offset, duration] = source.start.mock.calls[0]!;
        return { startSec: when, bufferOffsetSec: offset, playDuration: duration };
    });
}

describe('scheduleAudioClips live two-segment seam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStoreState.value = { tracks: [] };
        tempoMapStore.value = { changes: [] };
        vi.mocked(getCurrentTime).mockReturnValue(0);
        vi.mocked(getCompensationDelay).mockReturnValue(0);
        vi.mocked(getGainEnvelopeSeries).mockReturnValue(undefined);
        schedulerSession.pendingSeam = null;
        schedulerSession.lastLoopSeamAudioTime = null;
        disposeAudioClipScheduling();
    });

    it('nonzero entry phase: the live two-segment read equals the offline projection exactly', () => {
        // Source: start 4, end 20, offset 0, anchored at 4. Global delete
        // [6, 9) (duration 3) produces the survivor:
        // start 6, end 17, offset 5, anchor 4 - 3 = 1 (carry + shift).
        // Advance 5, region [0, 4), entry 1 beat: every full pass is the
        // region tail [1, 4) then its wrapped head [0, 1).
        const survivor = passClip({
            startBeat: 6,
            endBeat: 17,
            audioOffsetBeats: 5,
            loopOriginBeat: 1,
        });

        expect(liveTriples(scheduleLive(survivor))).toEqual([
            { startSec: 3, bufferOffsetSec: 0.5, playDuration: 1.5 },
            { startSec: 4.5, bufferOffsetSec: 0, playDuration: 0.5 },
            { startSec: 5, bufferOffsetSec: 0.5, playDuration: 1.5 },
            { startSec: 6.5, bufferOffsetSec: 0, playDuration: 0.5 },
            { startSec: 7, bufferOffsetSec: 0.5, playDuration: 1.5 },
        ]);
    });

    it('entry phase zero: the live single-segment read equals the offline projection exactly', () => {
        // Source: start 2, end 18, offset 0, anchored at 2. Global delete
        // [6, 10) (duration 4 = one loop) produces the survivor:
        // start 6, end 14, offset 8, anchor 2 - 4 = -2. Advance 8, entry 0:
        // one read per pass from the region head [0, 4) beats.
        const survivor = passClip({
            startBeat: 6,
            endBeat: 14,
            audioOffsetBeats: 8,
            loopOriginBeat: -2,
        });

        expect(liveTriples(scheduleLive(survivor))).toEqual([
            { startSec: 3, bufferOffsetSec: 0, playDuration: 2 },
            { startSec: 5, bufferOffsetSec: 0, playDuration: 2 },
        ]);
    });

    it("the survivor's head enters at the cut phase the source was reading", () => {
        // The nonzero-entry survivor above: the source at the delete end beat
        // 9 reads region position 1 beat in = 0.5 s, and the survivor's head
        // (its first source) must start at that buffer offset, not at 0.
        const survivor = passClip({
            startBeat: 6,
            endBeat: 17,
            audioOffsetBeats: 5,
            loopOriginBeat: 1,
        });
        expect(liveTriples(scheduleLive(survivor))[0]!.bufferOffsetSec).toBe(0.5);

        // The source clip itself (untrimmed, anchored at its start) advances
        // zero and reads the region from its head: pass 0 opens at beat 4.
        const source = passClip({ startBeat: 4, endBeat: 20, audioOffsetBeats: 0, loopOriginBeat: 4 });
        expect(liveTriples(scheduleLive(source))[0]).toEqual({
            startSec: 2,
            bufferOffsetSec: 0,
            playDuration: 2,
        });
    });

    it('keeps the wrap seam exactly contiguous while the audio clock advances one render quantum per read', () => {
        // Chromium updates ctx.currentTime once per 128-sample render
        // quantum. A wrap start derived from a read taken after the tail's
        // source was built and started would sit a whole quantum (or more)
        // past the tail's read-anchored end; deriving it from the pass head's
        // read keeps the seam closed to the exact instant however far the
        // clock has moved between reads.
        const QUANTUM = 128 / 48000;
        let reads = 0;
        vi.mocked(getCurrentTime).mockImplementation(() => {
            const time = reads * QUANTUM;
            reads += 1;
            return time;
        });

        const clip = passClip({
            startBeat: 6,
            endBeat: 17,
            audioOffsetBeats: 5,
            loopOriginBeat: 1,
        });
        const live = liveTriples(scheduleLive(clip));

        // Passes 0 and 1 each carry a tail and a wrap segment.
        const seams: Array<[number, number]> = [
            [0, 1],
            [2, 3],
        ];
        for (const [tailIndex, wrapIndex] of seams) {
            const tail = live[tailIndex]!;
            const wrap = live[wrapIndex]!;
            expect(wrap.startSec - (tail.startSec + tail.playDuration)).toBe(0);
            // One read basis: the two segments sit exactly one beat-span
            // apart, never one beat-span plus a quantum multiple.
            expect(wrap.startSec - tail.startSec).toBe(1.5);
        }
    });

    it('places every segment start from the pass head read: two clock reads per pass, none after scheduling', () => {
        const QUANTUM = 128 / 48000;
        let reads = 0;
        vi.mocked(getCurrentTime).mockImplementation(() => {
            const time = reads * QUANTUM;
            reads += 1;
            return time;
        });

        // A window covering only the first pass of the anchored survivor,
        // with no fades and no envelope: the pass owns exactly two reads —
        // the head read every segment start walks beats from, and the
        // pre-existing `now` read the late-start branch measures against.
        // Any read taken to place a segment start after the tail's source
        // was started would appear here as a third call.
        const clip = passClip({
            startBeat: 6,
            endBeat: 17,
            audioOffsetBeats: 5,
            loopOriginBeat: 1,
        });
        const sources = scheduleLive(clip, 6, 10);

        expect(sources).toHaveLength(2);
        expect(reads).toBe(2);
    });
});
