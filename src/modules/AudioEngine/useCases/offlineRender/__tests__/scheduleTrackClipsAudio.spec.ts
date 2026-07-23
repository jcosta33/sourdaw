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
        // 0.4s of source audio at 2x consumes in 0.2s of timeline.
        mocks.audioBufferCache.get.mockReturnValue(makeBuffer(0.4));
        const { ctx, sources } = makeRecordingOfflineCtx();
        const track = TrackDummy.create({
            clips: [makeAudioClip({ startBeat: 0, endBeat: 2, stretchMode: 'repitch', stretchRatio: 2 })],
        });

        await run({ track, ctx });

        const source = sources[0]!;
        expect(source.playbackRate.value).toBe(2);
        expect(source.start).toHaveBeenCalledWith(0, 0, 0.2);
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

        expect(mocks.buildDeviceChain).toHaveBeenCalledWith(ctx, track.devices, trackInputNode, trackPanNode);
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
