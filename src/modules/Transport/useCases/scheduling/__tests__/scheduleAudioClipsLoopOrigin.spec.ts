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
 * #4988, live monitoring twin of the offline projection spec: a looped audio
 * clip's pass reads the region the clip was looped with, cyclically, so a
 * start trim moves the entry, not the window. A trimmed pass starts two
 * sources — the region tail, then its wrapped head — through one shared fade
 * node; an unanchored clip keeps the pre-anchor single sliding read.
 *
 * Flat 120 BPM throughout (2 beats per second); the fake buffer holds 8 beats
 * (4 s) so a buffer bound can never mask the region bound.
 */

const trackStoreState: { value: { tracks: unknown[] } } = { value: { tracks: [] } };
const { createdGains } = vi.hoisted(() => ({
    createdGains: [] as Array<{
        gain: {
            setValueAtTime: ReturnType<typeof vi.fn>;
            linearRampToValueAtTime: ReturnType<typeof vi.fn>;
        };
    }>,
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

function trimmedLoopedClip(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'clip-1',
        name: 'Clip 1',
        type: 'audio',
        muted: false,
        audioBufferId: 'buf-1',
        regionStartBeat: 1,
        regionEndBeat: 17,
        startBeat: 1,
        endBeat: 17,
        stretchMode: 'off',
        stretchRatio: 1,
        loopEnabled: true,
        loopLength: 4,
        loopOriginBeat: 0,
        audioOffsetBeats: 1,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        ...overrides,
    };
}

function scheduleWindow(): Array<ReturnType<typeof makeFakeSource>> {
    const sources: Array<ReturnType<typeof makeFakeSource>> = [];
    mockCreateBufferSource.mockImplementation(() => {
        const fake = makeFakeSource();
        sources.push(fake);
        return fake as unknown as AudioBufferSourceNode;
    });
    mockGetCachedAudioBuffer.mockReturnValue({ duration: 4 } as AudioBuffer);
    mockResolveClips.mockReturnValue([trimmedLoopedClip()] as never);
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
    scheduleAudioClips(0, 32, 0, new Set(), new Set(), [], defaultTransportState);
    return sources;
}

describe('scheduleAudioClips loop-origin anchored passes', () => {
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
        createdGains.length = 0;
    });

    it('starts the region tail and its wrapped head as two contiguous sources per pass', () => {
        const sources = scheduleWindow();

        expect(sources.length).toBeGreaterThanOrEqual(2);
        const tail = sources[0]!;
        const wrap = sources[1]!;
        expect(tail.start).toHaveBeenCalledWith(0.5, 0.5, 1.5);
        expect(wrap.start).toHaveBeenCalledWith(2, 0, 0.5);
    });

    it('never reads past the region end', () => {
        const sources = scheduleWindow();

        for (const source of sources) {
            const [when, offset, duration] = source.start.mock.calls[0]!;
            expect(when).toBeGreaterThanOrEqual(0);
            expect(offset + duration).toBeLessThanOrEqual(2 + 1e-9);
        }
    });

    it('starts a single sliding read for a clip without an anchor (legacy projects)', () => {
        const sources: Array<ReturnType<typeof makeFakeSource>> = [];
        mockCreateBufferSource.mockImplementation(() => {
            const fake = makeFakeSource();
            sources.push(fake);
            return fake as unknown as AudioBufferSourceNode;
        });
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 4 } as AudioBuffer);
        mockResolveClips.mockReturnValue([trimmedLoopedClip({ loopOriginBeat: undefined })] as never);
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

        scheduleAudioClips(0, 32, 0, new Set(), new Set(), [], defaultTransportState);

        // The pre-anchor read: one source per pass, reading [1, 5) — past the
        // region end, exactly as before the anchor existed.
        expect(sources).toHaveLength(4);
        expect(sources[0]!.start).toHaveBeenCalledWith(0.5, 0.5, 2);
    });

    it('schedules the single pre-change read for a loop-off clip with a stale anchor', () => {
        // The clip was looped, trimmed one beat, then unlooped: `setClipLoop`
        // deliberately keeps the anchor at 0, and with the loop off the pass
        // length is the full visual 16 beats. The stale anchor must be inert —
        // the anchored two-segment read would wrap the pass around a boundary
        // nothing loops on, replaying the file's head at the tail.
        const sources: Array<ReturnType<typeof makeFakeSource>> = [];
        mockCreateBufferSource.mockImplementation(() => {
            const fake = makeFakeSource();
            sources.push(fake);
            return fake as unknown as AudioBufferSourceNode;
        });
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 4 } as AudioBuffer);
        mockResolveClips.mockReturnValue([trimmedLoopedClip({ loopEnabled: false })] as never);
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

        scheduleAudioClips(0, 32, 0, new Set(), new Set(), [], defaultTransportState);

        // The pre-change read: one source for the whole pass, reading the
        // offset [1, 5) and stopping at the buffer end.
        expect(sources).toHaveLength(1);
        expect(sources[0]!.start).toHaveBeenCalledWith(0.5, 0.5, 3.5);
    });

    it('rides the drawn fade in on the wrapped tail when the head read is dead', () => {
        // Parity twin of the offline projector's dead-head pin: loop 4, start
        // 8/end 20, offset 5, anchor 5 — advance 3, entry 3, region [2, 6) —
        // with a 4-beat buffer (2 s). Each pass's head segment reads from
        // source beat 5 (2.5 s), at or past the buffer's end, and emits
        // nothing, so the pass's first sounding material is its wrapped tail
        // (source [2, 4)). The fade in anchors at the pass's first sound —
        // `startedSegments[0]`, the tail — and ramps 0 → 1 over the shared
        // #2867 clamp's span: `userFadeEndTime − soundStartTime = 1.5 s`,
        // held to half the 1 s play duration. The offline twin prints the
        // identical ramp from `fadeIn: { userEndSec: 6 }` on the first
        // playback it emits; a tail whose head emitted nothing continues no
        // unbroken sound, so the fade-absence rule does not cover it.
        const sources: Array<ReturnType<typeof makeFakeSource>> = [];
        mockCreateBufferSource.mockImplementation(() => {
            const fake = makeFakeSource();
            sources.push(fake);
            return fake as unknown as AudioBufferSourceNode;
        });
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 2 } as AudioBuffer);
        mockResolveClips.mockReturnValue([
            trimmedLoopedClip({
                startBeat: 8,
                endBeat: 20,
                regionStartBeat: 8,
                regionEndBeat: 20,
                loopLength: 4,
                loopOriginBeat: 5,
                audioOffsetBeats: 5,
                fadeInBeats: 4,
            }),
        ] as never);
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

        scheduleAudioClips(0, 32, 0, new Set(), new Set(), [], defaultTransportState);

        // One source per pass — the dead head emitted none — and the first
        // one is the wrapped tail, reading source [2, 4) for its 1 s of
        // material from 4.5 s.
        expect(sources).toHaveLength(3);
        expect(sources[0]!.start).toHaveBeenCalledWith(4.5, 1, 1);
        // The drawn fade rides that tail: 0 at its sound start, plateau at
        // 4.5 s + 0.5 s — exactly what the offline playback emits.
        const fadeGain = createdGains[0]!;
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 4.5);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5);
    });
});
