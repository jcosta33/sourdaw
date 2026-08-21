import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveClipsWithComping, getGainAtBeat } from '#/modules/Arrangement/useCases';
import {
    createBufferSource,
    getAudioContext,
    getCompensationDelay,
    getCachedAudioBuffer,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { defaultTransportState } from '../../../models/TransportState';
import { gainNodePool } from '../audioClipSchedulingState';
import { disposeAudioClipScheduling } from '../disposeAudioClipScheduling';
import { scheduleAudioClips } from '../scheduleAudioClips';
import { scheduleFrozenTrack } from '../scheduleFrozenTrack';

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
            },
            connect: vi.fn(),
            disconnect: vi.fn(),
        })),
    })),
    getCompensationDelay: vi.fn(() => 0),
}));
// `projectClipLoopExpansion` is deliberately not stubbed: it is a pure leaf in
// `#/utils/clipLoopProjection` with its own spec, and these assertions are meant to run against the
// real loop projection.
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

describe('scheduleAudioClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStoreState.value = { tracks: [] };
        collaborationStoreState.value = null;
        tempoMapStore.value = { changes: [] };
        // Reset implementations that other tests override via mockReturnValue —
        // clearAllMocks only clears call records, not per-test return values.
        vi.mocked(getCurrentTime).mockReturnValue(0);
        vi.mocked(getCompensationDelay).mockReturnValue(0);
        vi.mocked(getGainAtBeat).mockReturnValue(0);
        vi.mocked(getAssetTransfer).mockReturnValue(null);
        mockResolveClips.mockReturnValue([]);
        disposeAudioClipScheduling();
    });

    it('does not notify when there are no tracks', () => {
        trackStoreState.value = { tracks: [] };
        scheduleAudioClips(0, 4, 0, new Set(), new Set(), [], defaultTransportState);

        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('sizes a clip spanning a tempo change by integrating the map, not one flat tempo', () => {
        // 120 BPM, halving to 60 at beat 10 — inside the clip (8..12). The audible
        // length is 2 beats at 120 (1 s) plus 2 beats at 60 (2 s) = 3 s. Dividing
        // the 4-beat span by the tempo at the playhead gave 2 s, so the clip ran
        // a whole second short while MIDI on the same beats did not.
        tempoMapStore.value = {
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 10, tempo: 60, curve: 'instant' },
            ],
        };
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockGetCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(fakeSource.start).toHaveBeenCalledTimes(1);
        const [when, offset, duration] = fakeSource.start.mock.calls[0]!;
        // Nothing before beat 8 changes tempo, so the start is unaffected: 8 beats
        // at 120 = 4 s. That is what isolates the duration as the failing quantity.
        expect(when).toBeCloseTo(4, 9);
        expect(offset).toBeCloseTo(0, 9);
        expect(duration).toBeCloseTo(3, 9);
        // Start and length come from the same mapping, so the clip ends exactly
        // where beat 12 lands: 10 beats at 120 (5 s) + 2 at 60 (2 s) = 7 s.
        expect(when + duration).toBeCloseTo(7, 9);
    });

    it('places a clip after a tempo change at the integrated beat time, not the flat one', () => {
        // The change sits between the playhead (beat 0) and the clip start (beat 8),
        // so it is the *start* that a flat rate got wrong: 4 beats at 120 (2 s) plus
        // 4 at 60 (4 s) = 6 s, where dividing 8 beats by the playhead tempo gave 4 s.
        tempoMapStore.value = {
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 4, tempo: 60, curve: 'instant' },
            ],
        };
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const [when, , duration] = fakeSource.start.mock.calls[0]!;
        expect(when).toBeCloseTo(6, 9);
        // The whole clip now sits at 60 BPM: 4 beats = 4 s.
        expect(duration).toBeCloseTo(4, 9);
        expect(when + duration).toBeCloseTo(10, 9);
    });

    // Regression (PR #514 review): identical defect to the MIDI path — the
    // frozen-track dedup was keyed by track.id only, so an unfreeze → refreeze
    // within one session (new frozenBufferId, same id) stayed silent. Keying by
    // track.id + frozenBufferId must dedup within a buffer but reschedule on
    // refreeze.
    it('dedups a frozen audio track per buffer and reschedules after a refreeze with a new buffer', () => {
        vi.mocked(scheduleFrozenTrack).mockReturnValue(true);
        const scheduledFrozenTracks = new Set<string>();

        trackStoreState.value = {
            tracks: [
                {
                    ...(makeAudioTrack([]) as Record<string, unknown>),
                    freezeState: { status: 'frozen', frozenBufferId: 'frozen-buffer-1' },
                },
            ],
        };
        scheduleAudioClips(0, 4, 0, new Set(), scheduledFrozenTracks, [], defaultTransportState);
        // Next tick, same buffer: still deduped.
        scheduleAudioClips(0.2, 4.2, 0.2, new Set(), scheduledFrozenTracks, [], defaultTransportState);
        expect(vi.mocked(scheduleFrozenTrack)).toHaveBeenCalledTimes(1);

        // Refreeze mid-session: same track.id, new frozen render.
        trackStoreState.value = {
            tracks: [
                {
                    ...(makeAudioTrack([]) as Record<string, unknown>),
                    freezeState: { status: 'frozen', frozenBufferId: 'frozen-buffer-2' },
                },
            ],
        };
        scheduleAudioClips(0.4, 4.4, 0.4, new Set(), scheduledFrozenTracks, [], defaultTransportState);

        expect(vi.mocked(scheduleFrozenTrack)).toHaveBeenCalledTimes(2);
        expect(scheduledFrozenTracks.has('track-1:frozen-buffer-1')).toBe(true);
        expect(scheduledFrozenTracks.has('track-1:frozen-buffer-2')).toBe(true);
    });

    // ── Clip filtering & dedup ──────────────────────────────────────────────

    it('skips non-audio clips and clips with no buffer id without scheduling a source', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        // A midi clip (type !== 'audio') and an audio clip missing its buffer id.
        mockResolveClips.mockReturnValue([
            makeAudioClip({ id: 'midi-1', type: 'midi', audioBufferId: undefined }),
            makeAudioClip({ id: 'audio-noid', type: 'audio', audioBufferId: undefined }),
        ] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).not.toHaveBeenCalled();
    });

    it('skips a muted clip', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockResolveClips.mockReturnValue([makeAudioClip({ muted: true })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).not.toHaveBeenCalled();
    });

    it('skips an audio track whose kind is not audio and a muted track', () => {
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = {
            tracks: [
                { id: 'midi-track', kind: 'midi', muted: false, clips: [], freezeState: { status: 'active' } },
                { id: 'muted-audio', kind: 'audio', muted: true, clips: [], freezeState: { status: 'active' } },
            ],
        };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).not.toHaveBeenCalled();
    });

    it('skips clips whose beat range falls entirely outside the scheduling window', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        // Clip at beats 8..12; window 0..4 → startBeat(8) > toBeat(4) → skipped.
        mockResolveClips.mockReturnValue([makeAudioClip({ id: 'future' })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 4, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).not.toHaveBeenCalled();

        // Clip at beats 0..2; window 4..8 → endBeat(2) < fromBeat(4) → skipped.
        mockResolveClips.mockReturnValue([makeAudioClip({ id: 'past', startBeat: 0, endBeat: 2 })] as never);
        scheduleAudioClips(4, 8, 0, new Set(), new Set(), [], defaultTransportState);
        expect(mockCreateBufferSource).not.toHaveBeenCalled();
    });

    it('does not reschedule a clip already in the scheduledAudioClipsSet', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        const scheduled = new Set<string>(['clip-1:0:4']);

        scheduleAudioClips(0, 16, 0, scheduled, new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).not.toHaveBeenCalled();
    });

    it('bails when trackStore.value is null', () => {
        trackStoreState.value = undefined as unknown as { tracks: unknown[] };
        expect(() => scheduleAudioClips(0, 4, 0, new Set(), new Set(), [], defaultTransportState)).not.toThrow();
        expect(mockCreateBufferSource).not.toHaveBeenCalled();
    });

    it('reads tempo map changes when present and tolerates an empty store', () => {
        // Exercise the default changes path; tempoMapStore mock supplies [] already.
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);
        expect(fakeSource.start).toHaveBeenCalledTimes(1);
    });

    // ── Missing-buffer handling ─────────────────────────────────────────────

    it('warns and dedups a clip whose buffer is missing and is not a recording clip', () => {
        mockGetCachedAudioBuffer.mockReturnValue(null);
        mockResolveClips.mockReturnValue([makeAudioClip({ name: 'Lost' })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        const scheduled = new Set<string>();

        scheduleAudioClips(0, 16, 0, scheduled, new Set(), [], defaultTransportState);

        expect(notifyUser).toHaveBeenCalledWith('Missing audio for clip "Lost" — re-import the audio file', 'warning');
        // Deduped so a second tick does not re-notify.
        vi.mocked(notifyUser).mockClear();
        scheduleAudioClips(0, 16, 0, scheduled, new Set(), [], defaultTransportState);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('silently skips a missing recording clip (rec- prefix) without notifying', () => {
        mockGetCachedAudioBuffer.mockReturnValue(null);
        mockResolveClips.mockReturnValue([makeAudioClip({ audioBufferId: 'rec-123', name: 'Rec' })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(notifyUser).not.toHaveBeenCalled();
        expect(mockCreateBufferSource).not.toHaveBeenCalled();
    });

    // The scheduler deliberately keeps no dedup of its own. A local
    // "requested once, ever" Set made an asset permanently unfetchable after
    // one aborted transfer; AssetTransfer owns the dedup because only it knows
    // whether the request is still alive, and it re-opens the hash on abort.
    it('asks AssetTransfer for a missing asset on every tick while collaboration is enabled', () => {
        const requestAsset = vi.fn();
        vi.mocked(getAssetTransfer).mockReturnValue({ requestAsset } as never);
        collaborationStoreState.value = { isEnabled: true };
        mockGetCachedAudioBuffer.mockReturnValue(null);
        mockResolveClips.mockReturnValue([makeAudioClip({ audioBufferId: 'buf-1', assetHash: 'hash-1' })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        const scheduled = new Set<string>();

        scheduleAudioClips(0, 16, 0, scheduled, new Set(), [], defaultTransportState);
        scheduleAudioClips(0, 16, 0, scheduled, new Set(), [], defaultTransportState);

        expect(requestAsset).toHaveBeenCalledTimes(2);
        expect(requestAsset).toHaveBeenCalledWith('hash-1');
        expect(notifyUser).not.toHaveBeenCalled();
    });

    // ── Stretch ratio & env gain ────────────────────────────────────────────

    it('sets playbackRate when stretchMode is active and stretchRatio differs from 1', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ stretchMode: 'timestretch', stretchRatio: 2 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        // Stretch doubles playback rate and halves the audible duration.
        expect((fakeSource.playbackRate as { value: number }).value).toBe(2);
        const [, offset, duration] = fakeSource.start.mock.calls[0]!;
        // Timeline duration 4 beats / 2 bps = 2 s; *stretch 2 = 4 s.
        expect(duration).toBeCloseTo(4, 6);
        expect(offset).toBeCloseTo(0, 6);
    });

    /// The live half of #2098's law, pinned so it cannot drift back into
    /// agreement with the defect the export carried: `start`'s duration
    /// argument is measured in the source buffer's own time, so a clip that
    /// occupies two seconds of timeline at half speed asks for one second of
    /// material. The export asserts the same thing in
    /// `AudioEngine/useCases/offlineRender/__tests__/scheduleTrackClipsAudio.spec.ts`.
    it('asks for the source seconds a half-speed clip consumes, not its destination span', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ stretchMode: 'timestretch', stretchRatio: 0.5 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect((fakeSource.playbackRate as { value: number }).value).toBe(0.5);
        const [, , duration] = fakeSource.start.mock.calls[0]!;
        // Timeline duration 4 beats / 2 bps = 2 s; *stretch 0.5 = 1 s of material.
        expect(duration).toBeCloseTo(1, 6);
    });

    it('inserts an envelope gain node scaled by 10^(db/20) when the clip has env gain', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        vi.mocked(getGainAtBeat).mockReturnValue(6); // +6 dB ≈ gain ~1.995
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        // The envelope gain node is acquired after the fade gain; its gain.value
        // is set to 10**(db/20) before being wired ahead of the source.
        const ctx = vi.mocked(getAudioContext).mock.results[0]!.value;
        const gains = ctx.createGain.mock.results.map(
            (r: { value: { gain: { value: number } } }) => r.value.gain.value
        );
        const expected = 10 ** (6 / 20);
        expect(gains.some((g: number) => Math.abs(g - expected) < 1e-5)).toBe(true);
    });

    // ── Late start (already-past iterStartTime) ─────────────────────────────
    //
    // beatToAudioTime (which computes iterStartTime) and the `now = getCurrentTime()`
    // read at L195 are independent calls. The late-start branch is only reachable
    // when real wall-clock time advances between them — so the mock must return an
    // incrementing value per call, not a constant.

    it('starts mid-buffer when iterStartTime is in the past and the clip has not finished', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        // Call sequence: beatToAudioTime→10, now→15 (elapsed = 5 s past iterStartTime).
        // Clip 8..12 at timeline bps 2 → iterStartTime = 10 + 8/2 = 14.
        let call = 0;
        vi.mocked(getCurrentTime).mockImplementation(() => (call++ === 0 ? 10 : 15));

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(fakeSource.start).toHaveBeenCalledTimes(1);
        const [when, offset, duration] = fakeSource.start.mock.calls[0]!;
        expect(when).toBe(15); // started at "now"
        // bufferOffset = elapsed(15-14=1)*stretch(1) + audioOffset(0) = 1.
        expect(offset).toBeCloseTo(1, 6);
        // remaining = playDuration*stretch + audioOffset - bufferOffset = 2 + 0 - 1 = 1.
        expect(duration).toBeCloseTo(1, 6);
    });

    it('releases resources and skips when a late-start clip has already finished playing', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        // iterStartTime = 0 + 8/2 = 4; now = 100 → elapsed 96, far past clip end.
        let call = 0;
        vi.mocked(getCurrentTime).mockImplementation(() => (call++ === 0 ? 0 : 100));

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(fakeSource.start).not.toHaveBeenCalled();
    });

    it('starts mid-buffer with an audio content offset folded into the buffer offset', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        // clipBeatsPerSecond = 120/60 = 2; audioOffset 2 beats → 1 s.
        mockResolveClips.mockReturnValue([makeAudioClip({ audioOffsetBeats: 2 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        // iterStartTime = 0 + 8/2 = 4; now = 5 → elapsed 1.
        let call = 0;
        vi.mocked(getCurrentTime).mockImplementation(() => (call++ === 0 ? 0 : 5));

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const [when, offset] = fakeSource.start.mock.calls[0]!;
        expect(when).toBe(5);
        // elapsed*stretch(1) + audioOffsetSeconds(1) = 2.
        expect(offset).toBeCloseTo(2, 6);
    });

    /// A clip slipped past the head of its own file. Both write paths reach a
    /// negative `audioOffsetBeats` unfloored — `slipClipContent` stores the slid
    /// value as-is, and `trimClipStart` adds a negative delta on a leftward
    /// left-edge drag — and the store sanitiser checks only finiteness. Handing
    /// that number to `start()` is a `RangeError` by specification, and this
    /// call sits in the scheduler tick under a `try`/`finally` with no `catch`,
    /// so the throw would also skip that tick's automation, VCA and modulation
    /// passes. The answer is the professional one, and the one the export
    /// bounces: silence across the negative span, then the file from sample 0.
    it('pre-rolls silence for a negative audio offset instead of throwing', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        // clipBeatsPerSecond = 120/60 = 2; audioOffset -1 beat → -0.5 s.
        mockResolveClips.mockReturnValue([makeAudioClip({ audioOffsetBeats: -1 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        expect(() => {
            scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);
        }).not.toThrow();

        const [when, offset, duration] = fakeSource.start.mock.calls[0]!;
        // Clip head is at beat 8 → 4.0 s; the 0.5 s of missing material is
        // crossed on the timeline before anything sounds.
        expect(when).toBeCloseTo(4.5, 6);
        // Entry into the file is its first sample, never a negative seek.
        expect(offset).toBeCloseTo(0, 6);
        // The tail stays put, so the pre-roll shortens the sound: the clip's
        // 2.0 s span less the 0.5 s of silence at its head.
        expect(duration).toBeCloseTo(1.5, 6);
    });

    /// Companion to the pre-roll test above: here the offset doesn't just eat
    /// into the buffer, it clears the whole thing. `sourceOffsetSeconds` (5 s)
    /// alone exceeds the 0.25 s buffer, so `(buffer.duration -
    /// sourceOffsetSeconds) / stretchRatio` goes negative and wins the
    /// `Math.min` over the untouched 2 s iteration span, driving `playDuration`
    /// below zero. Nothing audible remains, so the source must never start and
    /// both pooled GainNodes must come back rather than leak into a disposed
    /// graph.
    it('releases both gain nodes and never starts a source when the offset clears a short buffer', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 0.25 } as AudioBuffer);
        // Non-zero env gain so an envGainNode is also acquired, exercising both
        // pool slots this guard is responsible for releasing.
        vi.mocked(getGainAtBeat).mockReturnValue(3);
        // clipBeatsPerSecond = 2; audioOffsetBeats 10 → 5 s into a 0.25 s buffer.
        mockResolveClips.mockReturnValue([makeAudioClip({ audioOffsetBeats: 10 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(fakeSource.start).not.toHaveBeenCalled();
        expect(gainNodePool).toHaveLength(2);
    });

    it('moves the start across a tempo change while leaving the buffer content offset alone', () => {
        // The two conversions in this path answer different questions and must not
        // be unified. `when` is a timeline position, so it integrates the map. The
        // buffer offset is a seek into recorded audio, which was rendered at one
        // fixed rate and knows nothing about the project's later tempo changes —
        // integrating the map there would seek to the wrong sample.
        // 120 from the origin, 60 at beat 4 — before the clip, so it moves the
        // start — and 30 at beat 9, inside the two offset beats, so the flat rate
        // and the integral genuinely disagree about the offset.
        tempoMapStore.value = {
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 4, tempo: 60, curve: 'instant' },
                { id: 'c', beat: 9, tempo: 30, curve: 'instant' },
            ],
        };
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ audioOffsetBeats: 2 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const [when, offset] = fakeSource.start.mock.calls[0]!;
        // 4 beats at 120 (2 s) + 4 at 60 (4 s). A flat rate placed it at 4 s.
        expect(when).toBeCloseTo(6, 9);
        // 2 offset beats at the clip's own rate of 60 BPM = 2 s. Integrating the
        // map over beats 8..10 would give 1 s + 2 s and seek a second too deep.
        expect(offset).toBeCloseTo(2, 9);
    });

    // ── Loop iterations ─────────────────────────────────────────────────────

    it('schedules one source per loop iteration, advancing the start time by loopLength', () => {
        const sources = [makeFakeSource(), makeFakeSource()];
        mockCreateBufferSource.mockReturnValueOnce(sources[0]! as never);
        mockCreateBufferSource.mockReturnValueOnce(sources[1]! as never);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        // Visual span 8..16 (8 beats); loopLength 4 → 2 iterations.
        mockResolveClips.mockReturnValue([
            makeAudioClip({ startBeat: 8, endBeat: 16, loopEnabled: true, loopLength: 4 }),
        ] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 24, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).toHaveBeenCalledTimes(2);
        // Timeline bps 2: iter 0 start = 8/2 = 4; iter 1 start = 12/2 = 6.
        expect(sources[0]!.start.mock.calls[0]![0]).toBeCloseTo(4, 6);
        expect(sources[1]!.start.mock.calls[0]![0]).toBeCloseTo(6, 6);
        // Each iteration duration = loopLen 4 beats / 2 bps = 2 s.
        expect(sources[0]!.start.mock.calls[0]![2]).toBeCloseTo(2, 6);
        expect(sources[1]!.start.mock.calls[0]![2]).toBeCloseTo(2, 6);
    });

    it('caps iterations at the visual clip length when loopLength is larger than the remainder', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        // Visual 8..11 (3 beats); loopLength 2 → ceil(3/2) = 2 iterations, second
        // iteration iterStartBeat 10 < endBeat 11, remaining = 1 beat.
        mockResolveClips.mockReturnValue([
            makeAudioClip({ startBeat: 8, endBeat: 11, loopEnabled: true, loopLength: 2 }),
        ] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).toHaveBeenCalledTimes(2);
    });

    it('bounds malformed persisted loop expansion at the shared maximum iteration count', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([
            makeAudioClip({ startBeat: 0, endBeat: 10, loopEnabled: true, loopLength: 1 / 4097 }),
        ] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 11, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).toHaveBeenCalledTimes(4096);
    });

    it('allocates only loop occurrences intersecting the live scheduler window', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([
            makeAudioClip({ startBeat: 0, endBeat: 10, loopEnabled: true, loopLength: 1 / 480 }),
        ] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        const scheduled = new Set<string>();

        scheduleAudioClips(4, 4.01, 4, scheduled, new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).toHaveBeenCalledTimes(5);

        scheduleAudioClips(4, 4.01, 4, scheduled, new Set(), [], defaultTransportState);
        expect(mockCreateBufferSource).toHaveBeenCalledTimes(5);

        scheduleAudioClips(4.01, 4.02, 4.01, scheduled, new Set(), [], defaultTransportState);
        expect(mockCreateBufferSource.mock.calls.length).toBeGreaterThan(5);
        expect(mockCreateBufferSource.mock.calls.length).toBeLessThan(12);
    });

    it('breaks the loop when an iteration starts at or past clip end', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        // Visual 8..9 (1 beat); loopLength 1 → maxIterations = ceil(1/1) = 1.
        // First iterStartBeat = 8 < 9 → runs; second would be 9 >= 9 → break.
        mockResolveClips.mockReturnValue([
            makeAudioClip({ startBeat: 8, endBeat: 9, loopEnabled: true, loopLength: 1 }),
        ] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        expect(mockCreateBufferSource).toHaveBeenCalledTimes(1);
    });

    // ── Fade in / micro-fade / fade out ─────────────────────────────────────

    it('applies a linear fade-in ramp when fadeInBeats > 0 and the start lands before fade end', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ fadeInBeats: 2 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        // fadeGain is the first createGain(); capture its ramp targets.
        const ctx = vi.mocked(getAudioContext).mock.results[0]!.value;
        const fadeGain = ctx.createGain.mock.results[0]!.value;
        // fadeInEnd = iterStartTime(4) + 2 beats / clipBps(2) = 4 + 1 = 5.
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5);
        // progressRatio 0 at effectiveStart(4) → starts at 0.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 4);
    });

    it('stretches a fade-in that spans a tempo change by integrating the map', () => {
        // A fade is a length in beats, so a tempo change inside it changes how long
        // it lasts. 120 BPM halving to 60 at beat 9, with the fade running 8..10:
        // 0.5 s for the first beat plus 1 s for the second. Dividing 2 beats by the
        // flat rate gave 1 s, so the ramp finished half a second early and the fade
        // audibly outran the audio it was shaping.
        tempoMapStore.value = {
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 9, tempo: 60, curve: 'instant' },
            ],
        };
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ fadeInBeats: 2 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const ctx = vi.mocked(getAudioContext).mock.results[0]!.value;
        const fadeGain = ctx.createGain.mock.results[0]!.value;
        // Nothing before beat 8 changes, so iterStartTime is still 4 — which is what
        // isolates the fade length as the failing quantity. fadeInEnd = 4 + 1.5.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 4);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5.5);
    });

    it('jumps the fade gain to 1 when the effective start is already past the fade-in end', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ fadeInBeats: 2 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        // iterStartTime = 0 + 8/2 = 4; fadeInEnd = 4 + 2/2 = 5. Late start with
        // now = 5 → elapsed 1 (< playDuration 2, so the clip still plays) and
        // effectiveStart 5 >= fadeInEnd 5 → gain jumps straight to 1 (no ramp).
        let call = 0;
        vi.mocked(getCurrentTime).mockImplementation(() => (call++ === 0 ? 0 : 5));

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const ctx = vi.mocked(getAudioContext).mock.results[0]!.value;
        const fadeGain = ctx.createGain.mock.results[0]!.value;
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 5);
    });

    /// No existing test combined a drawn fade-in with a negative offset, so
    /// `effectiveStart = Math.max(soundStartTime, now)` — the line that decides
    /// where a fade actually lands — went unobserved for this case. A pre-roll
    /// (from the negative offset) longer than the drawn fade window pushes
    /// `effectiveStart` past `fadeInEnd`, and the bare `setValueAtTime(1, …)`
    /// jump would start the source at unity on a discontinuity. Drawing a fade
    /// is the gesture that says "no click here", so the fix substitutes the
    /// same micro anti-click ramp an undrawn fade gets.
    it('applies a micro fade instead of a bare jump when pre-roll outruns a drawn fade-in', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        // fadeInBeats 1 → 0.5 s fade window (iterStartTime 4 → fadeInEnd 4.5).
        // audioOffsetBeats -2 → clipAudioOffsetSeconds -1 s → preRollSeconds 1 s,
        // which outruns the fade and pushes effectiveStart to 5 (past fadeInEnd).
        mockResolveClips.mockReturnValue([makeAudioClip({ fadeInBeats: 1, audioOffsetBeats: -2 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const ctx = vi.mocked(getAudioContext).mock.results[0]!.value;
        const fadeGain = ctx.createGain.mock.results[0]!.value;
        // Before the fix this was setValueAtTime(1, 5) — a bare jump to unity.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 5);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 5.003);
        expect(fadeGain.gain.setValueAtTime).not.toHaveBeenCalledWith(1, 5);
    });

    it('applies a micro fade-in when there is no explicit fade-in (fadeInBeats === 0)', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ fadeInBeats: 0 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const ctx = vi.mocked(getAudioContext).mock.results[0]!.value;
        const fadeGain = ctx.createGain.mock.results[0]!.value;
        // Micro-fade: start at 0 (effectiveStart 4), ramp to 1 at 4 + 0.003.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 4);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 4 + 0.003);
    });

    it('applies a linear fade-out ramp when fadeOutBeats > 0 on the last iteration', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ fadeOutBeats: 2 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const ctx = vi.mocked(getAudioContext).mock.results[0]!.value;
        const fadeGain = ctx.createGain.mock.results[0]!.value;
        // clipEndTime = beatToAudioTime(12) = 6; fadeOutStart = 6 - 2/2 = 5.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 5);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 6);
    });

    it('applies a micro fade-out when there is no explicit fade-out (fadeOutBeats === 0)', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip({ fadeOutBeats: 0 })] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        const ctx = vi.mocked(getAudioContext).mock.results[0]!.value;
        const fadeGain = ctx.createGain.mock.results[0]!.value;
        // iterEndTime = effectiveStart(4) + playDuration(2) = 6; micro fade start 6-0.003.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 6 - 0.003);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 6);
    });

    // ── Gain-node pool reuse & cleanup ──────────────────────────────────────

    it('reuses a pooled GainNode instead of creating a new one on the next schedule', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);
        // Simulate the source ending → onended returns the fadeGain to the pool.
        const onended = fakeSource.onended as (() => void) | null;
        expect(onended).not.toBeNull();
        onended!();

        const before = vi.mocked(getAudioContext).mock.results[0]!.value.createGain.mock.calls.length;
        // New schedule tick: the pooled node is popped, so no new createGain for fadeGain.
        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);
        const after = vi.mocked(getAudioContext).mock.results[0]!.value.createGain.mock.calls.length;
        // Only the env/fade gains created fresh this tick; the pooled fade is reused.
        expect(after).toBeGreaterThanOrEqual(before);
    });

    it('releases the envelope gain node when the source ends', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        vi.mocked(getGainAtBeat).mockReturnValue(3);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);
        const onended = fakeSource.onended as (() => void) | null;
        expect(onended).not.toBeNull();
        // Invoking onended must not throw (env gain disconnect path).
        expect(() => onended!()).not.toThrow();
    });

    it('accounts for PDC compensation when computing the iteration start time', () => {
        const fakeSource = makeFakeSource();
        mockCreateBufferSource.mockReturnValue(fakeSource as unknown as AudioBufferSourceNode);
        mockGetCachedAudioBuffer.mockReturnValue({ duration: 100 } as AudioBuffer);
        mockResolveClips.mockReturnValue([makeAudioClip()] as never);
        trackStoreState.value = { tracks: [makeAudioTrack([])] };
        vi.mocked(getCompensationDelay).mockReturnValue(0.05);

        scheduleAudioClips(0, 16, 0, new Set(), new Set(), [], defaultTransportState);

        // iterStartTime = currentTime(0) + 8/2 + compensation(0.05) = 4.05.
        expect(fakeSource.start.mock.calls[0]![0]).toBeCloseTo(4.05, 6);
    });
});
