import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createBufferSource, getAudioContext, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { type TransportState, defaultTransportState } from '../../../models/TransportState';
import { stopActiveSources } from '../../playheadScheduler/schedulerSession';
import { disposeAudioClipScheduling } from '../disposeAudioClipScheduling';
import { scheduleAudioClips } from '../scheduleAudioClips';

const trackStoreState: { value: { tracks: unknown[] } } = { value: { tracks: [] } };
const { audioClock, resolvedParts } = vi.hoisted(() => ({
    audioClock: { seconds: 0 },
    resolvedParts: { value: [] as unknown[] },
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
    },
    getGainEnvelopeSeries: vi.fn(() => undefined),
}));
vi.mock('../../../stores/tempoMapStore', () => ({ tempoMapStore: { value: { changes: [] } } }));
vi.mock('#/modules/AudioEngine/useCases', () => {
    const context = {
        get currentTime() {
            return audioClock.seconds;
        },
        createGain: () => ({
            gain: {
                value: 1,
                cancelScheduledValues: vi.fn(),
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
            disconnect: vi.fn(),
        }),
    };
    return {
        ensureTrackStrip: vi.fn(() => ({ gainNode: { connect: vi.fn() } })),
        getCurrentTime: () => audioClock.seconds,
        createBufferSource: vi.fn(),
        getCachedAudioBuffer: vi.fn(),
        getAudioContext: () => context,
        getCompensationDelay: vi.fn(() => 0),
    };
});
// The comp programme is the subject's input: each case states the resolved
// parts directly, exactly as `resolveClipsWithComping` hands them over.
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: () => resolvedParts.value,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../scheduleFrozenTrack', () => ({ scheduleFrozenTrack: vi.fn(() => false) }));
vi.mock('#/modules/Collaboration/stores', () => ({ collaborationStore: { value: null } }));
vi.mock('#/modules/Collaboration/useCases', () => ({ getAssetTransfer: vi.fn(() => null) }));
// `TempoMap` is real: with an empty map the timeline runs at the default
// 120 BPM, 2 beats a second. Every case plays from beat 8 with the clock at
// 4 s, so beat b is due at 4 + (b - 8) / 2 seconds.

type StartFn = (when: number, offset: number, duration: number) => void;

type FakeSource = {
    buffer: unknown;
    playbackRate: { value: number };
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn<StartFn>>;
    stop: ReturnType<typeof vi.fn<(when: number) => void>>;
    onended: (() => void) | null;
};

const sources: FakeSource[] = [];

function makeFakeSource(): FakeSource {
    const source: FakeSource = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start: vi.fn<StartFn>((when, offset, duration) => {
            if (when < 0 || offset < 0 || duration < 0) {
                throw new RangeError('start() arguments must be non-negative');
            }
        }),
        stop: vi.fn<(when: number) => void>(),
        onended: null,
    };
    sources.push(source);
    return source;
}

/**
 * A resolved comp part of one clip. `audioOffsetBeats` is the part's own
 * source entry (2 beats a second of source at 120 BPM), so a part entered at
 * 6 beats reads from source second 3. Base and take entries are chosen so a
 * mid-buffer join, a boundary-exact start and a swapped take all read
 * different offsets.
 */
function compPart(
    regionStartBeat: number,
    regionEndBeat: number,
    audioOffsetBeats: number,
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        id: 'clip-1',
        name: 'Clip 1',
        type: 'audio',
        muted: false,
        audioBufferId: 'buf-1',
        startBeat: regionStartBeat,
        endBeat: regionEndBeat,
        regionStartBeat,
        regionEndBeat,
        sourceStartBeat: regionStartBeat,
        audioOffsetBeats,
        stretchMode: 'off',
        stretchRatio: 1,
        loopEnabled: false,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        ...overrides,
    };
}

type Start = { when: number; offset: number; duration: number };

function startOf(source: FakeSource): Start {
    expect(source.start).toHaveBeenCalledTimes(1);
    const [when, offset, duration] = source.start.mock.calls[0]!;
    return { when, offset, duration };
}

/** The source started reading at `offset`, or undefined when none did. */
function sourceReading(offset: number): FakeSource | undefined {
    return sources.find((source) => Math.abs(startOf(source).offset - offset) < 1e-9);
}

function expectStart(source: FakeSource | undefined, expected: Start): void {
    expect(source, `a source reading from ${String(expected.offset)} s`).toBeDefined();
    const actual = startOf(source!);
    expect(actual.when).toBeCloseTo(expected.when, 9);
    expect(actual.offset).toBeCloseTo(expected.offset, 9);
    expect(actual.duration).toBeCloseTo(expected.duration, 9);
}

/** Cut once, one 5 ms teardown ramp after the clock, never at a later instant. */
function expectStoppedAt(source: FakeSource, seconds: number): void {
    expect(source.stop).toHaveBeenCalledTimes(1);
    expect(source.stop.mock.calls[0]![0]).toBeCloseTo(seconds, 9);
}

type Playback = { scheduled: Set<string>; active: AudioBufferSourceNode[]; transport: TransportState };

function newPlayback(transport: TransportState = defaultTransportState): Playback {
    return { scheduled: new Set(), active: [], transport };
}

/** One scheduler pass with the playhead on `playheadBeat` and the clock where that beat is due. */
function runWindow(playback: Playback, fromBeat: number, toBeat: number, playheadBeat: number, clockSeconds?: number) {
    audioClock.seconds = clockSeconds ?? 4 + (playheadBeat - 8) / 2;
    scheduleAudioClips(
        fromBeat,
        toBeat,
        playheadBeat,
        playback.scheduled,
        new Set(),
        playback.active,
        playback.transport
    );
}

describe('scheduleAudioClips — comp parts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sources.length = 0;
        audioClock.seconds = 0;
        disposeAudioClipScheduling();
        vi.mocked(createBufferSource).mockImplementation(() => makeFakeSource() as unknown as AudioBufferSourceNode);
        vi.mocked(getCachedAudioBuffer).mockImplementation(({ bufferId }) =>
            bufferId === 'buf-1' ? ({ duration: 20 } as AudioBuffer) : null
        );
        trackStoreState.value = {
            tracks: [
                {
                    id: 'track-1',
                    kind: 'audio',
                    muted: false,
                    sends: [],
                    clips: [],
                    freezeState: { status: 'active', frozenBufferId: null },
                },
            ],
        };
    });

    describe('scheduled audio follows comp edits during playback', () => {
        it('cuts the superseded source and joins the new base part when a comp is drawn over a sounding clip', () => {
            const playback = newPlayback();
            resolvedParts.value = [compPart(8, 12, 0)];
            runWindow(playback, 8, 8.2, 8);
            const whole = sources[0]!;
            expectStart(whole, { when: 4, offset: 0, duration: 2 });

            resolvedParts.value = [compPart(8, 10, 0), compPart(10, 12, 6)];
            runWindow(playback, 8.2, 8.4, 8.2);

            expectStoppedAt(whole, 4.105);
            expect(playback.active).not.toContain(whole);
            expectStart(sourceReading(0.1), { when: 4.1, offset: 0.1, duration: 0.9 });
        });

        it('hears a different take swapped in over the same region of the same clip', () => {
            const playback = newPlayback();
            resolvedParts.value = [compPart(8, 12, 6)];
            runWindow(playback, 8, 8.2, 8);
            const firstTake = sources[0]!;
            expectStart(firstTake, { when: 4, offset: 3, duration: 2 });

            resolvedParts.value = [compPart(8, 12, 10)];
            runWindow(playback, 8.2, 8.4, 8.2);

            expectStoppedAt(firstTake, 4.105);
            expectStart(sourceReading(5.1), { when: 4.1, offset: 5.1, duration: 1.9 });
        });

        it('cuts a sounding part the user mutes', () => {
            const playback = newPlayback();
            resolvedParts.value = [compPart(8, 12, 0)];
            runWindow(playback, 8, 8.2, 8);

            resolvedParts.value = [compPart(8, 12, 0, { muted: true })];
            runWindow(playback, 8.2, 8.4, 8.2);

            expect(sources).toHaveLength(1);
            expectStoppedAt(sources[0]!, 4.105);
            expect(playback.active).toEqual([]);
        });

        it('leaves every source alone across passes where nothing changed', () => {
            const playback = newPlayback();
            resolvedParts.value = [compPart(8, 10, 0), compPart(10, 12, 6)];
            for (let beat = 8; beat < 12.2; beat += 0.2) {
                runWindow(playback, beat, beat + 0.2, beat);
            }

            expect(sources).toHaveLength(2);
            for (const source of sources) {
                expect(source.start).toHaveBeenCalledTimes(1);
                expect(source.stop).not.toHaveBeenCalled();
            }
        });
    });

    describe('a comp boundary inside a clip survives a main-thread stall', () => {
        it('starts the take after the boundary at its exact audio time and entry when the next window is stalled past it', () => {
            const playback = newPlayback();
            resolvedParts.value = [compPart(8, 10, 0), compPart(10, 12, 6)];
            // The first window reaches only the base part (one 0.1 s
            // look-ahead is 0.2 beats).
            runWindow(playback, 8, 8.2, 8);
            // A 1.08 s stall: the clock passes the boundary instant (5 s)
            // before the next window runs, opened at the playhead.
            runWindow(playback, 10.16, 10.36, 10.16);

            expectStart(sourceReading(0), { when: 4, offset: 0, duration: 1 });
            const takeStarts = sources.map(startOf).filter((start) => start.offset >= 3 - 1e-9);
            expect(takeStarts).toHaveLength(1);
            expect(takeStarts[0]!.when).toBeCloseTo(5, 9);
            expect(takeStarts[0]!.offset).toBeCloseTo(3, 9);
            expect(takeStarts[0]!.duration).toBeCloseTo(1, 9);
        });

        it('places the continuing part so it starts on the exact instant the part before it ends', () => {
            const playback = newPlayback();
            resolvedParts.value = [compPart(8, 10, 0), compPart(10, 12, 6)];
            // The audio clock moves on one render quantum while each source is
            // built, so a second clock read inside the emission lands late.
            vi.mocked(createBufferSource).mockImplementation(() => {
                audioClock.seconds += 128 / 48_000;
                return makeFakeSource() as unknown as AudioBufferSourceNode;
            });
            runWindow(playback, 8, 8.2, 8);

            const base = startOf(sourceReading(0)!);
            const take = startOf(sourceReading(3)!);
            expect(take.when).toBe(base.when + base.duration);
        });

        it.each([
            ['a gap after the boundary', [compPart(8, 10, 0), compPart(10.5, 12, 7)]],
            ['a different clip after the boundary', [compPart(8, 10, 0), compPart(10, 12, 6, { id: 'clip-2' })]],
            ['a muted part after the boundary', [compPart(8, 10, 0), compPart(10, 12, 6, { muted: true })]],
            ['a part with no decoded buffer', [compPart(8, 10, 0), compPart(10, 12, 6, { audioBufferId: 'buf-2' })]],
            [
                'a part looping over several passes',
                [compPart(8, 10, 0), compPart(10, 12, 6, { loopEnabled: true, loopLength: 0.5 })],
            ],
        ])('does not schedule ahead across %s', (_name, parts) => {
            const playback = newPlayback();
            resolvedParts.value = parts;
            runWindow(playback, 8, 8.2, 8);

            expect(sources).toHaveLength(1);
            expectStart(sources[0], { when: 4, offset: 0, duration: 1 });
        });

        it('does not schedule ahead across the transport loop end', () => {
            const playback = newPlayback({ ...defaultTransportState, isLooping: true, loopStart: 0, loopEnd: 10 });
            resolvedParts.value = [compPart(8, 10, 0), compPart(10, 12, 6)];
            runWindow(playback, 8, 8.2, 8);

            expect(sources).toHaveLength(1);
            expectStart(sources[0], { when: 4, offset: 0, duration: 1 });
        });

        it('stops a part scheduled ahead on a playback teardown and schedules it once on the re-emission', () => {
            const playback = newPlayback();
            resolvedParts.value = [compPart(8, 10, 0), compPart(10, 12, 6)];
            runWindow(playback, 8, 8.2, 8);
            const take = sourceReading(3)!;

            // What a stop, seek, loop or tempo edit does to the pool.
            stopActiveSources(playback.active, getAudioContext());
            playback.scheduled.clear();

            expectStoppedAt(take, 4.005);
            runWindow(playback, 8.2, 8.4, 8.2);
            runWindow(playback, 8.4, 8.6, 8.4);
            const takeStarts = sources.filter((source) => startOf(source).offset >= 3 - 1e-9);
            expect(takeStarts).toHaveLength(2);
            expectStart(takeStarts[1], { when: 5, offset: 3, duration: 1 });
        });

        it('stops a future part scheduled ahead before it sounds when a take is swapped over it', () => {
            const playback = newPlayback();
            resolvedParts.value = [compPart(8, 10, 0), compPart(10, 12, 6)];
            runWindow(playback, 8, 8.2, 8);
            const base = sourceReading(0)!;
            const staleTake = sourceReading(3)!;
            expectStart(staleTake, { when: 5, offset: 3, duration: 1 });

            resolvedParts.value = [compPart(8, 10, 0), compPart(10, 12, 10)];
            runWindow(playback, 8.2, 8.4, 8.2);

            expect(base.stop).not.toHaveBeenCalled();
            expectStoppedAt(staleTake, 4.105);
            expect(playback.active).not.toContain(staleTake);
            expectStart(sourceReading(5), { when: 5, offset: 5, duration: 1 });
        });
    });
});
