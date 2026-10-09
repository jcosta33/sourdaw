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
});
