import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';
import { projectPpqEndpoints as projectTempoPpqEndpoints } from '#/modules/Transport/useCases';

import { MICRO_FADE_SECONDS } from '../constants';
import { scheduleTrackClips } from '../scheduleTrackClips';

// Local, field-identical replica of Arrangement's TrackDummy fixture — foreign
// test fixtures have no compliant cross-module path (models are not re-exported).
const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => ({
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    }),
};

type Clip = Track['clips'][number];

function projectPpqEndpoints({
    startPpq,
    endPpq,
    defaultTempo,
    sampleRate,
}: {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
}) {
    const startSamples = Math.round((startPpq / defaultTempo) * 60 * sampleRate);
    const endSamples = Math.round((endPpq / defaultTempo) * 60 * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
}

function makeAudioClip(overrides?: Partial<Clip>): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Audio Clip',
        startBeat: 2,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'buf-1',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 0.8,
        color: '#fff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

const mocks = vi.hoisted(() => {
    const takeLaneValue: { value: unknown } = { value: null };
    const automationValue: { value: unknown } = { value: null };
    return {
        getCompensationDelay: vi.fn<(trackId: string) => number>(() => 0),
        scheduleTrackAutomation: vi.fn(),
        takeLaneValue,
        automationValue,
        audioBufferCache: { get: vi.fn<(id: string) => AudioBuffer | undefined>(() => undefined) },
        buildDeviceChain: vi.fn(() => Promise.resolve([])),
    };
});

vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: mocks.getCompensationDelay,
}));

vi.mock('../../../repositories/offlineScheduler/automationScheduling', () => ({
    scheduleTrackAutomation: mocks.scheduleTrackAutomation,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        takeLaneStore: mocks.takeLaneValue,
    };
});

vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...actual,
        automationStore: mocks.automationValue,
    };
});

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: mocks.audioBufferCache,
}));

vi.mock('../../buildDeviceChain', () => ({
    buildDeviceChain: mocks.buildDeviceChain,
}));

vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: vi.fn(() => null),
    getSynthParamsFromDevices: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: vi.fn(),
    scheduleNoteOffline: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/services/deviceResolution', () => ({
    resolveDrumKit: vi.fn(() => null),
}));

type FakeParam = {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
};

type FakeSource = {
    buffer: AudioBuffer | null;
    playbackRate: FakeParam;
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
};

type FakeGain = {
    gain: FakeParam;
    connect: ReturnType<typeof vi.fn>;
};

function makeParam(): FakeParam {
    return { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
}

function makeRecordingOfflineCtx(): {
    ctx: OfflineAudioContext;
    sources: FakeSource[];
    gains: FakeGain[];
} {
    const sources: FakeSource[] = [];
    const gains: FakeGain[] = [];
    const ctx = {
        sampleRate: 48_000,
        currentTime: 0,
        createBufferSource: vi.fn(() => {
            const source: FakeSource = {
                buffer: null,
                playbackRate: makeParam(),
                connect: vi.fn(),
                start: vi.fn(),
            };
            sources.push(source);
            return source;
        }),
        createGain: vi.fn(() => {
            const gain: FakeGain = { gain: makeParam(), connect: vi.fn() };
            gains.push(gain);
            return gain;
        }),
    } as unknown as OfflineAudioContext;
    return { ctx, sources, gains };
}

function makeBuffer(durationSeconds: number): AudioBuffer {
    return { duration: durationSeconds } as AudioBuffer;
}

const emptyMidi: NonNullable<MidiStoreState> = {
    probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

type ProjectableMidiEvent = {
    id: string;
    startBeat: number;
    duration: number;
    velocity: number;
};

function projectMidiEvents<Event extends ProjectableMidiEvent>(input: {
    events: readonly Event[];
    phase?: 'clip-groove' | 'complete' | 'sequencer-groove';
}): readonly Event[] {
    return input.events;
}

type RunInput = {
    track: Track;
    ctx: OfflineAudioContext;
    onWarning?: (message: string) => void;
    regionStartBeat?: number;
    withPrebuiltChain?: boolean;
    changes?: Parameters<typeof scheduleTrackClips>[0]['changes'];
    projector?: Parameters<typeof scheduleTrackClips>[0]['projections']['projectPpqEndpoints'];
};

async function run({
    track,
    ctx,
    onWarning,
    regionStartBeat = 0,
    withPrebuiltChain = true,
    changes = [],
    projector = projectPpqEndpoints,
}: RunInput): Promise<{
    trackInputNode: GainNode;
    trackGainNode: GainNode;
    trackPanNode: StereoPannerNode;
    destination: AudioNode;
}> {
    const trackInputNode = { connect: vi.fn() } as unknown as GainNode;
    const trackGainNode = { connect: vi.fn() } as unknown as GainNode;
    const trackPanNode = { connect: vi.fn() } as unknown as StereoPannerNode;
    const destination = { connect: vi.fn() } as unknown as AudioNode;

    await scheduleTrackClips({
        offlineCtx: ctx,
        track,
        midi: emptyMidi,
        trackInputNode,
        trackGainNode,
        trackPanNode,
        destination,
        durationSeconds: 60,
        defaultTempo: 120,
        changes,
        projections: {
            projectMidiEvents,
            projectPpqEndpoints: projector,
            processYeastMidi: null,
            selectMidiEventProbability: () => true,
            projectChordPitch: ({ pitch }) => pitch,
            evaluateAutomationValue: null,
        },
        onWarning,
        pendingWorkletEvents: [],
        allTracks: [track],
        deviceEntriesByTrack: withPrebuiltChain ? new Map([[track.id, []]]) : undefined,
        regionStartBeat,
    });

    return { trackInputNode, trackGainNode, trackPanNode, destination };
}

describe('scheduleTrackClips — audio clip scheduling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneValue.value = null;
        mocks.automationValue.value = null;
        mocks.getCompensationDelay.mockReturnValue(0);
        mocks.audioBufferCache.get.mockReturnValue(undefined);
        mocks.buildDeviceChain.mockResolvedValue([]);
    });

    it('schedules a plain clip at its beat-converted start with micro fades on both edges', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources, gains } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 2, endBeat: 4, gain: 0.8 })] });

        const { trackInputNode } = await run({ track, ctx });

        expect(sources).toHaveLength(1);
        const source = sources[0]!;
        const fadeGain = gains[0]!;
        // 2 beats at 120bpm = 1.0s start, 2 beats visual length = 1.0s duration.
        expect(source.start).toHaveBeenCalledWith(1, 0, 1);
        expect(source.buffer).toEqual(makeBuffer(10));
        expect(source.connect).toHaveBeenCalledWith(fadeGain);
        expect(fadeGain.connect).toHaveBeenCalledWith(trackInputNode);
        // Micro fade-in from silence at the clip head…
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 1);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 1 + MICRO_FADE_SECONDS);
        // …and a micro fade-out into the clip tail.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0.8, 2 - MICRO_FADE_SECONDS);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 2);
    });

    it('honours explicit fade-in and fade-out lengths in beats', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, gains } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 4, gain: 1, fadeInBeats: 1, fadeOutBeats: 1 })],
        });

        await run({ track, ctx });

        const fadeGain = gains[0]!;
        // Fade-in: 1 beat = 0.5s ramp from silence.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 0.5);
        // Fade-out: starts at endBeat - fadeOutBeats = beat 3 = 1.5s, lands at 2.0s.
        expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 1.5);
        expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 2);
    });

    it('skips muted clips entirely', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ muted: true })] });

        await run({ track, ctx });

        expect(sources).toHaveLength(0);
    });

    it('warns and skips a clip with zero duration', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const onWarning = vi.fn();
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 2, endBeat: 2 })] });

        await run({ track, ctx, onWarning });

        expect(sources).toHaveLength(0);
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('zero or negative duration'));
    });

    it('warns and renders silence when the clip buffer is missing from the cache', async () => {
        mocks.audioBufferCache.get.mockReturnValue(undefined);
        const { ctx, sources } = makeRecordingOfflineCtx();
        const onWarning = vi.fn();
        const track = TrackDummy.create({ clips: [makeAudioClip()] });

        await run({ track, ctx, onWarning });

        expect(sources).toHaveLength(0);
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('missing its audio buffer'));
    });

    it('applies the clamped stretch ratio to playbackRate and limits play length to the sped-up buffer', async () => {
        // 0.4s of source audio at 2x consumes in 0.2s of timeline, so the clip
        // sounds for 0.2s and reads all 0.4s of the material.
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(0.4));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 2, stretchMode: 'repitch', stretchRatio: 2 })],
        });

        await run({ track, ctx });

        const source = sources[0]!;
        expect(source.playbackRate.value).toBe(2);
        expect(source.start).toHaveBeenCalledWith(0, 0, 0.4);
    });

    /// Regression (#2098): `start`'s duration argument is measured in the
    /// source buffer's own time — the node stops after consuming that many
    /// source seconds, which takes `duration / playbackRate` of the timeline.
    /// Passing the destination span unscaled made a half-speed clip bounce for
    /// twice its region length and a sped-up clip stop short. The live
    /// scheduler already scales; this is the export agreeing with it.
    it('asks for the source seconds a half-speed clip consumes, not its destination span', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 2, stretchMode: 'timestretch', stretchRatio: 0.5 })],
        });

        await run({ track, ctx });

        const source = sources[0]!;
        expect(source.playbackRate.value).toBe(0.5);
        // 2 beats at 120bpm is 1.0s of timeline; at half speed that is 0.5s of
        // material. Handing 1.0 here would sound the clip for 2.0s.
        expect(source.start).toHaveBeenCalledWith(0, 0, 0.5);
    });

    it('asks for the source seconds a double-speed clip consumes when the buffer is not the limit', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 2, stretchMode: 'timestretch', stretchRatio: 2 })],
        });

        await run({ track, ctx });

        // 1.0s of timeline at 2x is 2.0s of material; handing 1.0 here would
        // cut the clip off half way through its region.
        expect(sources[0]!.start).toHaveBeenCalledWith(0, 0, 2);
    });

    it('never reads past the end of the material when the region outlasts the stretched buffer', async () => {
        // 0.6s of material at 1.5x sounds for 0.4s, and the clip's region is
        // 1.0s — the clamp, restated in source seconds, is the whole buffer.
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(0.6));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 2, stretchMode: 'timestretch', stretchRatio: 1.5 })],
        });

        await run({ track, ctx });

        // Exactly the buffer, from its head: the clamp bounds the destination
        // span, and scaling it back by the rate lands on the material's end
        // rather than past it.
        expect(sources[0]!.start).toHaveBeenCalledWith(0, 0, expect.closeTo(0.6, 12));
    });

    it('reads a stretched clip trimmed by the region start from the offset it already advanced', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        // Region starts at beat 2 (1.0s); the clip spans beats 0-4 (2.0s) at 2x.
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 4, stretchMode: 'timestretch', stretchRatio: 2 })],
        });

        await run({ track, ctx, regionStartBeat: 2 });

        // 1.0s of timeline was trimmed, which is 2.0s of material; the
        // remaining 1.0s of timeline is another 2.0s of material.
        expect(sources[0]!.start).toHaveBeenCalledWith(0, 2, 2);
    });

    it('clamps a corrupt zero stretch ratio instead of dividing by zero', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 2, stretchMode: 'repitch', stretchRatio: 0 })],
        });

        await run({ track, ctx });

        expect(sources[0]!.playbackRate.value).toBe(0.01);
    });

    it('ignores the stored stretch ratio when stretch mode is off', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 2, stretchMode: 'off', stretchRatio: 2 })],
        });

        await run({ track, ctx });

        // playbackRate is left untouched at its default.
        expect(sources[0]!.playbackRate.value).toBe(1);
    });

    it('unrolls a looped clip into one source per loop iteration', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 4, loopEnabled: true, loopLength: 1 })],
        });

        await run({ track, ctx });

        expect(sources).toHaveLength(4);
        expect(sources[0]!.start).toHaveBeenCalledWith(0, 0, 0.5);
        expect(sources[1]!.start).toHaveBeenCalledWith(0.5, 0, 0.5);
        expect(sources[2]!.start).toHaveBeenCalledWith(1, 0, 0.5);
        expect(sources[3]!.start).toHaveBeenCalledWith(1.5, 0, 0.5);
    });

    it('falls back to the visual length when loopLength is corrupt instead of looping forever', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 2, loopEnabled: true, loopLength: 0 })],
        });

        await run({ track, ctx });

        expect(sources).toHaveLength(1);
        expect(sources[0]!.start).toHaveBeenCalledWith(0, 0, 1);
    });

    it('bounds malformed persisted loop expansion at the shared maximum iteration count', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 10, loopEnabled: true, loopLength: 1 / 4097 })],
        });

        await run({ track, ctx });

        expect(sources).toHaveLength(4096);
    });

    it('trims a clip that straddles the export region start by advancing the buffer offset', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        // Region starts at beat 2 (1.0s); the clip spans beats 0-4.
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 0, endBeat: 4 })] });

        await run({ track, ctx, regionStartBeat: 2 });

        expect(sources).toHaveLength(1);
        // Starts at t=0 in region time, reading 1.0s into the buffer, for the remaining 1.0s.
        expect(sources[0]!.start).toHaveBeenCalledWith(0, 1, 1);
    });

    it('projects cropped audio timing and fades through a linear tempo ramp', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        mocks.getCompensationDelay.mockReturnValue(0.1);
        const { ctx, sources, gains } = makeRecordingOfflineCtx();
        const changes = [
            { id: 'start', beat: 0, tempo: 60, curve: 'linear' as const },
            { id: 'end', beat: 8, tempo: 180, curve: 'instant' as const },
        ];
        function project(startPpq: number, endPpq: number) {
            return projectTempoPpqEndpoints({
                startPpq,
                endPpq,
                defaultTempo: 120,
                sampleRate: ctx.sampleRate,
                changes,
            });
        }
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 2, endBeat: 6, fadeInBeats: 1, fadeOutBeats: 1 })],
        });

        await run({ track, ctx, regionStartBeat: 2, changes, projector: projectTempoPpqEndpoints });

        expect(sources[0]!.start).toHaveBeenCalledWith(expect.closeTo(0.1, 12), 0, project(2, 6).durationSeconds);
        expect(gains[0]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
            0.8,
            expect.closeTo(0.1 + project(2, 3).durationSeconds, 12)
        );
        expect(gains[0]!.gain.setValueAtTime).toHaveBeenCalledWith(
            0.8,
            expect.closeTo(0.1 + project(2, 5).durationSeconds, 12)
        );
        expect(gains[0]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.1 + project(2, 6).durationSeconds);
    });

    it('drops clips that end before the export region starts', async () => {
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(10));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 0, endBeat: 2 })] });

        await run({ track, ctx, regionStartBeat: 2 });

        expect(sources).toHaveLength(0);
    });

    it('builds the device chain and routes pan to the destination when no pre-built chain is supplied', async () => {
        const { ctx } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [] });

        const { trackInputNode, trackPanNode, destination } = await run({ track, ctx, withPrebuiltChain: false });

        // The chain is handed the track name and the export's warning channel:
        // a device that fails to load has to be reportable against the track
        // the user has to go and fix.
        expect(mocks.buildDeviceChain).toHaveBeenCalledWith(
            ctx,
            track.devices,
            trackInputNode,
            trackPanNode,
            expect.objectContaining({ trackName: track.name })
        );
        expect(trackPanNode.connect).toHaveBeenCalledWith(destination);
    });
});

describe('scheduleTrackClips — frozen tracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneValue.value = null;
        mocks.automationValue.value = null;
        mocks.getCompensationDelay.mockReturnValue(0);
        mocks.audioBufferCache.get.mockReturnValue(undefined);
    });

    it('plays the frozen buffer through the fader (bypassing the device chain) and skips clip scheduling', async () => {
        const frozenBuffer = makeBuffer(3);
        mocks.audioBufferCache.get.mockImplementation((id) => (id === 'frozen-buf' ? frozenBuffer : undefined));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buf' },
            clips: [makeAudioClip({ audioBufferId: 'other-buf' })],
        });

        const { trackGainNode } = await run({ track, ctx });

        expect(sources).toHaveLength(1);
        const source = sources[0]!;
        expect(source.buffer).toBe(frozenBuffer);
        expect(source.connect).toHaveBeenCalledWith(trackGainNode);
        // Default region (start 0): the fixture clip at beat 2 (1.0s)
        // anchors the frozen buffer, so it starts 1.0s into the export.
        expect(source.start).toHaveBeenCalledWith(1, 0, 3);
        // Automation still runs for the frozen strip.
        expect(mocks.scheduleTrackAutomation).toHaveBeenCalledTimes(1);
        // The device chain is never built for a frozen track.
        expect(mocks.buildDeviceChain).not.toHaveBeenCalled();
    });

    /// Regression (M-036): a frozen buffer is rendered from timeline 0, so
    /// a region export must start regionStartSec INTO the buffer — starting
    /// at 0 shifted the frozen content early by the region offset.
    it('starts region exports regionStartSec into the frozen buffer', async () => {
        const frozenBuffer = makeBuffer(3);
        mocks.audioBufferCache.get.mockImplementation((id) => (id === 'frozen-buf' ? frozenBuffer : undefined));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buf' },
        });

        // regionStartBeat 2 at 120bpm = 1.0s region start.
        await run({ track, ctx, regionStartBeat: 2 });

        expect(sources).toHaveLength(1);
        expect(sources[0]!.start).toHaveBeenCalledWith(0, 1, 2);
    });

    /// Regression (PR #616 review): frozen buffers render from the track's
    /// EARLIEST CLIP startBeat, not timeline 0 — the anchor must use the
    /// clip-derived track start, and a region starting before the track
    /// content starts the buffer later at offset 0.
    it('anchors the frozen buffer at the earliest clip start, not timeline 0', async () => {
        const frozenBuffer = makeBuffer(3);
        mocks.audioBufferCache.get.mockImplementation((id) => (id === 'frozen-buf' ? frozenBuffer : undefined));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buf' },
            clips: [makeAudioClip({ startBeat: 4, endBeat: 8 })],
        });

        // Track content starts at beat 4 (2.0s); region starts at beat 2
        // (1.0s) — the buffer must start 1.0s into the export at offset 0.
        await run({ track, ctx, regionStartBeat: 2 });

        expect(sources).toHaveLength(1);
        expect(sources[0]!.start).toHaveBeenCalledWith(1, 0, 3);
    });

    it('starts into the frozen buffer by region minus track start when the region begins mid-track', async () => {
        const frozenBuffer = makeBuffer(3);
        mocks.audioBufferCache.get.mockImplementation((id) => (id === 'frozen-buf' ? frozenBuffer : undefined));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buf' },
            clips: [makeAudioClip({ startBeat: 4, endBeat: 8 })],
        });

        // Track starts at 2.0s, region starts at 3.0s — 1.0s into the buffer.
        await run({ track, ctx, regionStartBeat: 6 });

        expect(sources).toHaveLength(1);
        expect(sources[0]!.start).toHaveBeenCalledWith(0, 1, 2);
    });

    it('renders nothing when the region starts beyond the frozen buffer', async () => {
        const frozenBuffer = makeBuffer(3);
        mocks.audioBufferCache.get.mockImplementation((id) => (id === 'frozen-buf' ? frozenBuffer : undefined));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buf' },
        });

        // regionStartBeat 8 at 120bpm = 4.0s > 3s buffer.
        await run({ track, ctx, regionStartBeat: 8 });

        expect(sources).toHaveLength(0);
    });

    it('warns when the frozen buffer is gone so the user knows the track will be silent', async () => {
        mocks.audioBufferCache.get.mockReturnValue(undefined);
        const { ctx, sources } = makeRecordingOfflineCtx();
        const onWarning = vi.fn();
        const track = TrackDummy.create({
            name: 'Pad',
            freezeState: { status: 'frozen', frozenBufferId: 'frozen-buf' },
        });

        await run({ track, ctx, onWarning });

        expect(sources).toHaveLength(0);
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('frozen but its frozen buffer is missing'));
        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Pad'));
    });
});

// Comping (take-lane) resolution: resolveTrackClipsWithComping expands a track's
// clips into the comp-region segments plus the gap-fills between them. Each
// resolved clip schedules one source, so the source count is the observable
// proof of which resolution branches ran.
describe('scheduleTrackClips — comping (take-lane) resolution edges', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.takeLaneValue.value = null;
        mocks.automationValue.value = null;
        mocks.getCompensationDelay.mockReturnValue(0);
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(20));
        mocks.buildDeviceChain.mockResolvedValue([]);
    });

    function setLane(lane: unknown): void {
        mocks.takeLaneValue.value = { lanes: [lane] };
    }

    it('falls back to the plain clip when the lane exists but has no comp regions', async () => {
        // lane.activeCompRegions is empty → the `length === 0` guard returns the
        // original clip unchanged (one source, at the original beat range).
        setLane({ id: 'lane-1', trackId: 'track-1', takes: [], activeCompRegions: [] });
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 0, endBeat: 4 })] });

        await run({ track, ctx });

        expect(sources).toHaveLength(1);
    });

    it('skips a comp region whose takeId is not in the lane takes (silence, no gap-fill)', async () => {
        // region references 'take-missing' but takes only has 'take-1' → the
        // `!take` continue drops the segment. The gap-fill loop still treats the
        // declared region as covered (it iterates activeCompRegions, not resolved
        // segments), so NO gap is emitted either → the clip renders silence.
        setLane({
            id: 'lane-1',
            trackId: 'track-1',
            takes: [{ id: 'take-1', clipId: 'clip-1', name: 'T1', startBeat: 0, endBeat: 4, selected: true }],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-missing' }],
        });
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 0, endBeat: 4 })] });

        await run({ track, ctx });

        // Neither segment nor gap → zero sources (the take-less region is a hole).
        expect(sources).toHaveLength(0);
    });

    it('skips a comp region whose take clipId is not among the track clips (silence)', async () => {
        setLane({
            id: 'lane-1',
            trackId: 'track-1',
            takes: [{ id: 'take-1', clipId: 'clip-other', name: 'T1', startBeat: 0, endBeat: 4, selected: true }],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-1' }],
        });
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 0, endBeat: 4 })] });

        await run({ track, ctx });

        // No source clip matched → segment dropped; region still counts as
        // covered for gap purposes → silence.
        expect(sources).toHaveLength(0);
    });

    it('skips a comp region that does not overlap its source clip', async () => {
        // The region range is checked against the SOURCE CLIP's beat range, not
        // the take's. Region 10..12 vs source clip 0..8 → overlap empty
        // (max(10,0)=10 >= min(12,8)=8) → segment dropped. The gap loop then
        // treats the disjoint region as before-the-clip (skipped), so the whole
        // clip 0..8 fills as one gap.
        setLane({
            id: 'lane-1',
            trackId: 'track-1',
            takes: [{ id: 'take-1', clipId: 'clip-src', name: 'T1', startBeat: 0, endBeat: 8, selected: true }],
            activeCompRegions: [{ startBeat: 10, endBeat: 12, takeId: 'take-1' }],
        });
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ id: 'clip-src', startBeat: 0, endBeat: 8 })] });

        await run({ track, ctx });

        // Region disjoint from clip in the gap loop too (startBeat 10 >= endBeat 8)
        // → no split → whole clip is one gap → 1 source.
        expect(sources).toHaveLength(1);
    });

    it('splits a clip into a comp segment plus the trailing gap', async () => {
        // Clip 0..8, one comp region 0..4 from take-1. The region covers the first
        // half; the gap loop fills 4..8 as a trailing gap (the `cursor < endBeat`
        // branch). Two resolved clips → two sources.
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(40));
        setLane({
            id: 'lane-1',
            trackId: 'track-1',
            takes: [{ id: 'take-1', clipId: 'clip-1', name: 'T1', startBeat: 0, endBeat: 8, selected: true }],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'take-1' }],
        });
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 0, endBeat: 8 })] });

        await run({ track, ctx });

        expect(sources).toHaveLength(2);
    });

    it('skips a region disjoint from the clip in the gap-detection loop', async () => {
        // Clip 0..4. A region wholly before (endBeat <= clip.startBeat) and one
        // wholly after (startBeat >= clip.endBeat) are both skipped by the
        // disjoint guard, so neither injects a gap split — the clip renders once.
        setLane({
            id: 'lane-1',
            trackId: 'track-1',
            takes: [{ id: 'take-1', clipId: 'clip-1', name: 'T1', startBeat: 0, endBeat: 4, selected: true }],
            activeCompRegions: [
                { startBeat: -2, endBeat: 0, takeId: 'take-1' }, // before clip
                { startBeat: 4, endBeat: 6, takeId: 'take-1' }, // after clip
                { startBeat: 1, endBeat: 3, takeId: 'take-1' }, // inside → 1 segment
            ],
        });
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(40));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({ clips: [makeAudioClip({ startBeat: 0, endBeat: 4 })] });

        await run({ track, ctx });

        // One comp segment (1..3) plus two gaps (0..1, 3..4) → 3 sources.
        expect(sources).toHaveLength(3);
    });

    it('honours audioOffsetBeats on split or slipped audio clips', async () => {
        const { ctx, sources } = makeRecordingOfflineCtx();
        const buf = makeBuffer(10);
        mocks.audioBufferCache.get.mockReturnValue(buf);

        const track = TrackDummy.create({
            clips: [
                makeAudioClip({
                    startBeat: 0,
                    endBeat: 4, // 2.0s at 120bpm
                    audioOffsetBeats: 2, // 1.0s offset into buffer
                }),
            ],
        });

        await run({ track, ctx });

        expect(sources).toHaveLength(1);
        // start(when = 0, offset = 1.0, duration = 2.0)
        expect(sources[0]?.start).toHaveBeenCalledWith(0, 1, 2);
    });
});
