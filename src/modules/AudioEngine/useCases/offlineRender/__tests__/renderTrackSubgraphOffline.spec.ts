import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { trackStore, vcaGroupStore, type Track } from '#/modules/Arrangement/stores';
// Statically imported so the barrel load is paid once at module init rather
// than inside a test's time budget.
import { getEffectiveGain } from '#/modules/Arrangement/useCases';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { renderTrackSubgraphOffline } from '../renderTrackSubgraphOffline';

const SAMPLE_RATE = 44_100;
const TEMPO = 120;

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

function midiClip(overrides: Partial<Track['clips'][number]> = {}): Track['clips'][number] {
    return {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'MIDI Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Sample-rendering harness
//
// The offline path is proved on the *samples it produces*, not on which calls
// it made: MD-4's failure is that a Fermenter track bakes as a triangle
// oscillator, and only the waveform tells those apart. Nodes here are
// unity-gain summing points; the two things that can emit signal are a
// `createOscillator()` (which renders its `type` at its `frequency`) and the
// instrument node the device chain hands back (which renders a pure sine for
// each held note). A triangle carries a 3rd harmonic at 1/9 of the fundamental;
// a sine carries none. That ratio is the assertion.
// ---------------------------------------------------------------------------

type Contribution = {
    startFrame: number;
    endFrame: number;
    sample: (frame: number) => number;
};

const contributions: Contribution[] = [];
const createdGains: { gain: { value: number } }[] = [];

class RenderHarnessBuffer {
    readonly duration: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    readonly length: number;
    private readonly channels: Float32Array[];

    constructor({
        length,
        numberOfChannels,
        sampleRate,
    }: {
        length: number;
        numberOfChannels: number;
        sampleRate: number;
    }) {
        this.duration = length / sampleRate;
        this.length = length;
        this.numberOfChannels = numberOfChannels;
        this.sampleRate = sampleRate;
        this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    }

    getChannelData(channel: number): Float32Array {
        return this.channels[channel]!;
    }

    copyToChannel(source: Float32Array, channel: number, startInChannel = 0): void {
        this.channels[channel]!.set(source, startInChannel);
    }
}

function triangleSample(frequency: number, frame: number): number {
    const phase = ((frequency * frame) / SAMPLE_RATE) % 1;
    return 4 * Math.abs(phase - 0.5) - 1;
}

function sineSample(frequency: number, frame: number): number {
    return Math.sin((2 * Math.PI * frequency * frame) / SAMPLE_RATE);
}

function midiFrequency(pitch: number): number {
    return 440 * 2 ** ((pitch - 69) / 12);
}

function createParam(value = 0) {
    return {
        value,
        setValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    };
}

function createNode() {
    return {
        connect: vi.fn((destination: unknown) => destination),
        disconnect: vi.fn(),
        numberOfInputs: 1,
    };
}

class RenderHarnessContext {
    readonly destination = createNode();
    currentTime = 0;

    constructor(
        readonly numberOfChannels: number,
        readonly length: number,
        readonly sampleRate: number
    ) {}

    createGain() {
        const gain = { ...createNode(), gain: createParam(1) };
        createdGains.push(gain);
        return gain;
    }

    createStereoPanner() {
        return { ...createNode(), pan: createParam(0) };
    }

    createDelay() {
        return { ...createNode(), delayTime: createParam(0) };
    }

    createBufferSource() {
        return {
            ...createNode(),
            buffer: null as AudioBuffer | null,
            playbackRate: createParam(1),
            start: vi.fn(),
            stop: vi.fn(),
        };
    }

    createOscillator() {
        const oscillator = {
            ...createNode(),
            type: 'sine',
            frequency: createParam(440),
            start: vi.fn((when = 0) => {
                oscillator.startFrame = Math.round(when * SAMPLE_RATE);
            }),
            stop: vi.fn((when = 0) => {
                contributions.push({
                    startFrame: oscillator.startFrame,
                    endFrame: Math.round(when * SAMPLE_RATE),
                    sample: (frame) => triangleSample(oscillator.frequency.value, frame),
                });
            }),
            startFrame: 0,
        };
        return oscillator;
    }

    suspend(_seconds?: number): Promise<void> {
        return Promise.resolve();
    }

    resume(): Promise<void> {
        return Promise.resolve();
    }

    startRendering(): Promise<AudioBuffer> {
        const buffer = new RenderHarnessBuffer({
            length: this.length,
            numberOfChannels: this.numberOfChannels,
            sampleRate: this.sampleRate,
        });
        const channel = buffer.getChannelData(0);
        for (const contribution of contributions) {
            const end = Math.min(this.length, contribution.endFrame);
            for (let frame = Math.max(0, contribution.startFrame); frame < end; frame++) {
                channel[frame] = channel[frame]! + contribution.sample(frame);
            }
        }
        return Promise.resolve(buffer as unknown as AudioBuffer);
    }
}

/** Magnitude of `data` at `frequency`, normalized by window length. */
function magnitudeAt(data: Float32Array, frequency: number): number {
    let real = 0;
    let imaginary = 0;
    for (let frame = 0; frame < data.length; frame++) {
        const angle = (2 * Math.PI * frequency * frame) / SAMPLE_RATE;
        real += data[frame]! * Math.cos(angle);
        imaginary += data[frame]! * Math.sin(angle);
    }
    return Math.hypot(real, imaginary) / data.length;
}

const mocks = vi.hoisted(() => ({
    buildDeviceChain: vi.fn(),
    getAudioContext: vi.fn(() => ({ sampleRate: SAMPLE_RATE })),
    instrumentNoteOn: vi.fn(),
    instrumentNoteOff: vi.fn(),
    /** Fader level the real strip builder computed, per track, in build order. */
    builtFaderGains: new Map<string, number>(),
}));

vi.mock('../../buildDeviceChain', () => ({ buildDeviceChain: mocks.buildDeviceChain }));
vi.mock('../../engineAccess/getAudioContext', () => ({ getAudioContext: mocks.getAudioContext }));

// The real strip builder runs; this only records the level it computed so a
// rendered track's fader can be read back and compared against live.
vi.mock('../createOfflineTrackStrip', async (importOriginal) => {
    const original = await importOriginal<typeof import('../createOfflineTrackStrip')>();
    return {
        createOfflineTrackStrip: async (
            ...args: Parameters<typeof original.createOfflineTrackStrip>
        ): ReturnType<typeof original.createOfflineTrackStrip> => {
            const strip = await original.createOfflineTrackStrip(...args);
            mocks.builtFaderGains.set(stripKeyForGain(args[1].gain), strip.faderNode.gain.value);
            return strip;
        },
    };
});

/** Tracks in these cases carry distinct stored gains, so gain identifies them. */
function stripKeyForGain(gain: number): string {
    return `gain:${gain}`;
}

/**
 * Stands in for a worklet instrument's control surface: each note it is handed
 * renders as a sine at that pitch, so the buffer says which generator sounded.
 */
function createInstrumentEntry(deviceId: string, deviceType: string): DeviceNodeEntry {
    const heldNotes = new Map<number, number>();
    return {
        deviceId,
        deviceType,
        node: {} as DeviceNodeEntry['node'],
        strategy: {} as DeviceNodeEntry['strategy'],
        instrumentControls: {
            noteOn: ({ noteOrPad: note, velocity, midiNote, sampleFrame }) => {
                mocks.instrumentNoteOn(note, velocity, midiNote, sampleFrame);
                heldNotes.set(note, sampleFrame ?? 0);
            },
            noteOff: ({ noteOrPad: note, sampleFrame }) => {
                mocks.instrumentNoteOff(note, sampleFrame);
                const startFrame = heldNotes.get(note);
                if (startFrame === undefined) {
                    return;
                }
                heldNotes.delete(note);
                const frequency = midiFrequency(note);
                contributions.push({
                    startFrame,
                    endFrame: sampleFrame ?? startFrame,
                    sample: (frame) => sineSample(frequency, frame),
                });
            },
        },
    };
}

function createHistorySensitiveInstrumentEntry(deviceId: string): DeviceNodeEntry {
    let previousPitch: number | null = null;
    const heldNotes = new Map<number, { startFrame: number; amplitude: number }>();
    return {
        deviceId,
        deviceType: 'fermenter',
        node: {} as DeviceNodeEntry['node'],
        strategy: {} as DeviceNodeEntry['strategy'],
        instrumentControls: {
            noteOn: ({ noteOrPad: note, sampleFrame }) => {
                const amplitude = previousPitch === null ? 0.25 : previousPitch / 100;
                previousPitch = note;
                heldNotes.set(note, { startFrame: sampleFrame ?? 0, amplitude });
            },
            noteOff: ({ noteOrPad: note, sampleFrame }) => {
                const held = heldNotes.get(note);
                if (!held) {
                    return;
                }
                heldNotes.delete(note);
                contributions.push({
                    startFrame: held.startFrame,
                    endFrame: sampleFrame ?? held.startFrame,
                    sample: (frame) => held.amplitude * sineSample(midiFrequency(note), frame),
                });
            },
        },
    };
}

describe('renderTrackSubgraphOffline', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        contributions.length = 0;
        createdGains.length = 0;
        vi.stubGlobal('OfflineAudioContext', RenderHarnessContext);
        vi.stubGlobal('AudioBuffer', RenderHarnessBuffer);
        mocks.getAudioContext.mockReturnValue({ sampleRate: SAMPLE_RATE });
        mocks.buildDeviceChain.mockResolvedValue([]);

        const { configureOfflineMidiEventProjection } = await import('../../configureOfflineMidiEventProjection');
        const { configureOfflinePpqEndpointProjection } = await import('../../configureOfflinePpqEndpointProjection');
        const { configureOfflineYeastMidiProcessing } = await import('../../configureOfflineYeastMidiProcessing');
        configureOfflinePpqEndpointProjection({
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
            project: ({ startPpq, endPpq, defaultTempo, sampleRate }) => {
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
            },
        });
        configureOfflineMidiEventProjection({
            createProjector: () => (input) => input.events,
            selectProbability: () => true,
            createChordPitchProjector: () => (input) => input.pitch,
            evaluateAutomationValue: () => 0,
        });
        configureOfflineYeastMidiProcessing({ createProcessor: () => () => [] });

        const { trackStore } = await import('#/modules/Arrangement/stores');
        const { midiStore } = await import('#/modules/MIDI/stores');
        const { transportStore } = await import('#/modules/Transport/stores');
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set({ ...transportStore.value!, tempo: TEMPO });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { 'clip-1': [{ id: 'note-1', pitch: 69, startBeat: 0, duration: 1, velocity: 100 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('bakes the track instrument, not a triangle oscillator, into the rendered samples', async () => {
        const track = TrackDummy.create({
            id: 'track-1',
            kind: 'midi',
            clips: [midiClip()],
            devices: [
                { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
            ],
        });
        mocks.buildDeviceChain.mockResolvedValue([createInstrumentEntry('fermenter-1', 'fermenter')]);

        const buffer = await renderTrackSubgraphOffline({
            targetTrackId: track.id,
            renderTracks: [track],
            startBeat: 0,
            endBeat: 4,
        });

        expect(buffer).not.toBeNull();
        // The note is A4 for one beat at 120 bpm: frames 0..22050.
        const note = buffer!.getChannelData(0).subarray(0, Math.round(0.5 * SAMPLE_RATE));
        const fundamental = magnitudeAt(note, 440);
        const thirdHarmonic = magnitudeAt(note, 1320);

        // The instrument sounded: a fundamental at the note's pitch is present…
        expect(fundamental).toBeGreaterThan(0.4);
        // …and it carries no third harmonic. A triangle-oscillator stub renders
        // the 3rd at 1/9 (≈0.111) of the fundamental — that is the MD-4 signature.
        expect(thirdHarmonic / fundamental).toBeLessThan(0.02);
        expect(mocks.instrumentNoteOn).toHaveBeenCalledWith(69, 100, undefined, 0);
        expect(mocks.instrumentNoteOff).toHaveBeenCalledWith(69, Math.round(0.5 * SAMPLE_RATE));
    });

    it('returns the requested region with the same instrument history as a full playthrough', async () => {
        const track = TrackDummy.create({
            id: 'track-1',
            kind: 'midi',
            clips: [midiClip({ endBeat: 8 })],
            devices: [
                { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
            ],
        });
        const { midiStore } = await import('#/modules/MIDI/stores');
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'clip-1': [
                    { id: 'origin', pitch: 48, startBeat: 0, duration: 1, velocity: 100 },
                    { id: 'region', pitch: 72, startBeat: 4, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        mocks.buildDeviceChain.mockImplementation(() =>
            Promise.resolve([createHistorySensitiveInstrumentEntry('fermenter-1')])
        );
        let scheduleTally = { scheduledNotes: 0, scheduledBuffers: [] as AudioBuffer[] };

        const full = await renderTrackSubgraphOffline({
            targetTrackId: track.id,
            renderTracks: [track],
            startBeat: 0,
            endBeat: 8,
        });
        const expected = full!.getChannelData(0).slice(2 * SAMPLE_RATE, 4 * SAMPLE_RATE);
        contributions.length = 0;

        const region = await renderTrackSubgraphOffline({
            targetTrackId: track.id,
            renderTracks: [track],
            startBeat: 4,
            endBeat: 8,
            onScheduled: (tally) => {
                scheduleTally = tally;
            },
        });

        expect(region!.length).toBe(expected.length);
        expect(region!.getChannelData(0).subarray(0, 2048)).toEqual(expected.subarray(0, 2048));
        expect(scheduleTally.scheduledNotes).toBe(1);
    });

    it('stops history scheduling as soon as the caller aborts', async () => {
        const abortController = new AbortController();
        const track = TrackDummy.create({
            id: 'track-1',
            kind: 'midi',
            clips: [midiClip({ endBeat: 8 })],
            devices: [
                { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
            ],
        });
        const { midiStore } = await import('#/modules/MIDI/stores');
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'clip-1': [
                    { id: 'history-1', pitch: 48, startBeat: 0, duration: 0.5, velocity: 100 },
                    { id: 'history-2', pitch: 60, startBeat: 1, duration: 0.5, velocity: 100 },
                    { id: 'region', pitch: 72, startBeat: 4, duration: 0.5, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const { configureOfflineMidiEventProjection } = await import('../../configureOfflineMidiEventProjection');
        configureOfflineMidiEventProjection({
            createProjector: () => (input) => {
                abortController.abort();
                return input.events;
            },
            selectProbability: () => true,
            createChordPitchProjector: () => (input) => input.pitch,
            evaluateAutomationValue: () => 0,
        });
        mocks.buildDeviceChain.mockResolvedValue([createInstrumentEntry('fermenter-1', 'fermenter')]);

        await expect(
            renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 4,
                endBeat: 8,
                abortSignal: abortController.signal,
            })
        ).rejects.toThrow('Render aborted');
        expect(mocks.instrumentNoteOn).not.toHaveBeenCalled();
    });

    it('includes muted Toaster child content in a deliverable subgraph render', async () => {
        const parent = TrackDummy.create({
            id: 'toaster-parent',
            kind: 'folder',
            clips: [],
            devices: [{ id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} }],
        });
        const child = TrackDummy.create({
            id: 'toaster-kick',
            kind: 'midi',
            parentId: parent.id,
            muted: true,
            clips: [midiClip({ id: 'kick-clip', trackId: 'toaster-kick' })],
        });
        const { midiStore } = await import('#/modules/MIDI/stores');
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'kick-clip': [{ id: 'kick-note', pitch: 36, startBeat: 0, duration: 0.25, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        mocks.buildDeviceChain.mockImplementation((_context: OfflineAudioContext, devices: Track['devices']) =>
            Promise.resolve(
                devices.some((device) => device.type === 'toaster')
                    ? [createInstrumentEntry('toaster-1', 'toaster')]
                    : []
            )
        );

        await renderTrackSubgraphOffline({
            targetTrackId: parent.id,
            renderTracks: [parent, child],
            startBeat: 0,
            endBeat: 4,
        });

        expect(mocks.instrumentNoteOn).toHaveBeenCalledWith(0, 100, 60, 0);
        expect(mocks.instrumentNoteOff).not.toHaveBeenCalled();
    });

    it('builds the target device chain from the project devices and captures its strip output', async () => {
        const track = TrackDummy.create({
            id: 'track-1',
            kind: 'midi',
            clips: [midiClip()],
            devices: [
                { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
            ],
        });
        mocks.buildDeviceChain.mockResolvedValue([createInstrumentEntry('fermenter-1', 'fermenter')]);

        await renderTrackSubgraphOffline({
            targetTrackId: track.id,
            renderTracks: [track],
            startBeat: 0,
            endBeat: 4,
        });

        expect(mocks.buildDeviceChain).toHaveBeenCalledTimes(1);
        expect(mocks.buildDeviceChain.mock.calls[0]?.[1]).toEqual(track.devices);
    });

    it('keeps the instrument but drops the effects when a bounce excludes inserts', async () => {
        const track = TrackDummy.create({
            id: 'track-1',
            kind: 'midi',
            clips: [midiClip()],
            devices: [
                { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
                { id: 'reverb-1', name: 'Reverb', type: 'proof-chamber', bypassed: false, parameterValues: {} },
            ],
        });
        mocks.buildDeviceChain.mockResolvedValue([createInstrumentEntry('fermenter-1', 'fermenter')]);

        await renderTrackSubgraphOffline({
            targetTrackId: track.id,
            renderTracks: [track],
            startBeat: 0,
            endBeat: 4,
            includeInserts: false,
        });

        expect(mocks.buildDeviceChain.mock.calls[0]?.[1]).toEqual([track.devices[0]]);
    });

    // MD-4 review — freeze and bounce are deliverables, not monitoring
    // snapshots. Baking mute in hands back a zeroed buffer, and
    // bounce-to-new-track then installs that silent waveform on a track it
    // marks unmuted. The renderer this replaced never consulted `muted`.
    it('does not bake a muted source track down to silence', async () => {
        const track = TrackDummy.create({
            id: 'track-1',
            kind: 'midi',
            muted: true,
            clips: [midiClip()],
            devices: [
                { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
            ],
        });
        mocks.buildDeviceChain.mockResolvedValue([createInstrumentEntry('fermenter-1', 'fermenter')]);

        const buffer = await renderTrackSubgraphOffline({
            targetTrackId: track.id,
            renderTracks: [track],
            startBeat: 0,
            endBeat: 4,
        });

        // No node in the rendered graph is zeroed: the mute never reached the strip.
        expect(createdGains.filter((node) => node.gain.value === 0)).toEqual([]);
        const note = buffer!.getChannelData(0).subarray(0, Math.round(0.5 * SAMPLE_RATE));
        expect(magnitudeAt(note, 440)).toBeGreaterThan(0.4);
    });

    it('rejects an already-aborted render instead of returning a buffer', async () => {
        const controller = new AbortController();
        controller.abort();
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

        await expect(
            renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
                abortSignal: controller.signal,
            })
        ).rejects.toThrow('Render aborted');
    });

    it('returns null for a region with no duration rather than allocating a context', async () => {
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

        const buffer = await renderTrackSubgraphOffline({
            targetTrackId: track.id,
            renderTracks: [track],
            startBeat: 4,
            endBeat: 4,
        });

        expect(buffer).toBeNull();
        expect(mocks.buildDeviceChain).not.toHaveBeenCalled();
    });

    describe('VCA group levels in a freeze/bounce render', () => {
        const GROUP_GAIN = 0.5;

        function seedVcaSubgraph(): { target: Track; upstream: Track } {
            // Upstream feeds the target, so its audio is summed into the print.
            const upstream = TrackDummy.create({
                id: 'up-1',
                name: 'Upstream',
                kind: 'audio',
                gain: 1,
                vcaGroupId: 'vca-1',
                outputId: 'track-1',
            });
            const target = TrackDummy.create({
                id: 'track-1',
                kind: 'audio',
                gain: 0.5,
                vcaGroupId: 'vca-1',
            });
            trackStore.set({ tracks: [target, upstream], selectedTrackId: null, ghostClips: [] });
            vcaGroupStore.set({
                groups: [{ id: 'vca-1', name: 'Drums', gain: GROUP_GAIN, muted: false, trackIds: ['track-1', 'up-1'] }],
            });
            mocks.builtFaderGains.clear();
            return { target, upstream };
        }

        it('bakes an upstream contributor at the level it plays, not at its raw fader', async () => {
            const { target, upstream } = seedVcaSubgraph();

            await renderTrackSubgraphOffline({
                targetTrackId: target.id,
                renderTracks: [target, upstream],
                startBeat: 0,
                endBeat: 4,
            });

            // The upstream track's contribution is summed into the buffer exactly
            // once and is never recomposed afterwards — the routing edge that got
            // baked stops carrying live signal the moment the target is frozen.
            // So its group master has to be in the print.
            const live = getEffectiveGain(upstream.id, upstream.gain);
            const baked = mocks.builtFaderGains.get(stripKeyForGain(upstream.gain));

            expect(live).toBeCloseTo(0.5, 10);
            expect(baked).toBeCloseTo(live, 10);
        });

        it('leaves the target track uncomposed, because its own strip applies the group live', async () => {
            const { target } = seedVcaSubgraph();

            await renderTrackSubgraphOffline({
                targetTrackId: target.id,
                renderTracks: [target],
                startBeat: 0,
                endBeat: 4,
            });

            // The frozen buffer replays through this same strip, which the live
            // VCA writer keeps driving. Composing the group master here would
            // apply it twice.
            expect(mocks.builtFaderGains.get(stripKeyForGain(target.gain))).toBeCloseTo(target.gain, 10);
        });

        it('leaves an upstream contributor outside every group at its own fader', async () => {
            const upstream = TrackDummy.create({ id: 'up-1', kind: 'audio', gain: 0.6, outputId: 'track-1' });
            const target = TrackDummy.create({ id: 'track-1', kind: 'audio', gain: 0.5 });
            trackStore.set({ tracks: [target, upstream], selectedTrackId: null, ghostClips: [] });
            vcaGroupStore.set({ groups: [] });
            mocks.builtFaderGains.clear();

            await renderTrackSubgraphOffline({
                targetTrackId: target.id,
                renderTracks: [target, upstream],
                startBeat: 0,
                endBeat: 4,
            });

            expect(mocks.builtFaderGains.get(stripKeyForGain(0.6))).toBeCloseTo(0.6, 10);
        });
    });

    describe('render kernel', () => {
        /**
         * A context that never finishes and never reaches a checkpoint — the
         * shape of a wedged render. Freeze and bounce run full track lengths
         * through this path, so a wedge here is an application that never
         * un-freezes.
         */
        class StalledRenderContext extends RenderHarnessContext {
            /** The instance the render under test most recently constructed. */
            static latest: StalledRenderContext | null = null;

            readonly resumeCalls: number[] = [];
            closeCalls = 0;
            private readonly checkpoints = new Map<number, () => void>();

            constructor(channels: number, length: number, sampleRate: number) {
                super(channels, length, sampleRate);
                StalledRenderContext.latest = this;
            }

            override suspend(seconds: number): Promise<void> {
                return new Promise<void>((resolve) => {
                    this.checkpoints.set(seconds, resolve);
                });
            }

            override resume(): Promise<void> {
                this.resumeCalls.push(this.resumeCalls.length);
                return Promise.resolve();
            }

            override startRendering(): Promise<AudioBuffer> {
                return new Promise<AudioBuffer>(() => undefined);
            }

            close(): Promise<void> {
                this.closeCalls += 1;
                return Promise.resolve();
            }

            /** Simulate the render arriving at the earliest scheduled checkpoint. */
            async reachFirstCheckpoint(): Promise<void> {
                const earliest = [...this.checkpoints.keys()].sort((a, b) => a - b)[0];
                if (earliest === undefined) {
                    throw new Error('no checkpoint was scheduled');
                }
                this.checkpoints.get(earliest)?.();
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            }

            scheduledCheckpointCount(): number {
                return this.checkpoints.size;
            }
        }

        afterEach(() => {
            vi.useRealTimers();
        });

        /** The context the render under test built, once it has built one. */
        function renderedContext(): StalledRenderContext {
            const context = StalledRenderContext.latest;
            if (!context) {
                throw new Error('the render never constructed an OfflineAudioContext');
            }
            return context;
        }

        /**
         * Let the render get through strip building, clip scheduling and its
         * yield-to-main before the checkpoints are inspected.
         */
        async function untilCheckpointsScheduled(): Promise<void> {
            for (let tick = 0; tick < 20; tick++) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                if ((StalledRenderContext.latest?.scheduledCheckpointCount() ?? 0) > 0) {
                    return;
                }
            }
        }

        function stubStalledContext(): void {
            StalledRenderContext.latest = null;
            vi.stubGlobal('OfflineAudioContext', StalledRenderContext);
        }

        // SPEC-offline-live-collapse AC-10: the freeze path's backstop is now
        // the no-progress watchdog rather than a total-elapsed budget. This
        // case previously advanced past the 60 s floor and asserted a "timed
        // out" rejection — a wedged render is still rejected, but for making no
        // progress, and after 10 s rather than 60.
        it('rejects a wedged render once it stops making progress instead of hanging forever', async () => {
            vi.useFakeTimers();
            stubStalledContext();
            const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

            const rendering = renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
            });
            const settled = expect(rendering).rejects.toThrow(/made no progress/);

            // Without a backstop this promise never settles at all.
            await vi.advanceTimersByTimeAsync(15_000);
            await settled;

            vi.useRealTimers();
        });

        it('stops at a checkpoint when the caller aborts mid-render and never resumes the context', async () => {
            stubStalledContext();
            const controller = new AbortController();
            const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

            const rendering = renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
                abortSignal: controller.signal,
            });
            const settled = expect(rendering).rejects.toThrow(/abort|cancel/i);

            await untilCheckpointsScheduled();
            expect(renderedContext().scheduledCheckpointCount()).toBeGreaterThan(0);

            controller.abort();
            await renderedContext().reachFirstCheckpoint();
            await settled;

            // Not resuming is what actually stops the work; rejecting alone
            // would leave the render running to completion in the background.
            expect(renderedContext().resumeCalls).toEqual([]);
            // And the abandoned context is torn down rather than left resident
            // with its whole device graph.
            expect(renderedContext().closeCalls).toBe(1);
        });

        it('segments a freeze render so an abort has somewhere to land', async () => {
            stubStalledContext();
            const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

            void renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 8,
            }).catch(() => undefined);

            await untilCheckpointsScheduled();

            // 8 beats at 120 BPM is 4 s of audio; the shared kernel's segment
            // length puts a cancel point strictly inside each second.
            expect(renderedContext().scheduledCheckpointCount()).toBe(3);
        });
    });

    // The silence guard reads this tally instead of predicting what the
    // scheduler ought to have done. These cases pin the property that makes
    // that sound: the count is taken *downstream* of every filter, so a note
    // sitting in the store contributes nothing to it.
    describe('schedule tally', () => {
        it('counts a note the scheduler actually handed to an instrument', async () => {
            const track = TrackDummy.create({
                id: 'track-1',
                kind: 'midi',
                clips: [midiClip()],
                devices: [
                    { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
                ],
            });
            mocks.buildDeviceChain.mockResolvedValue([createInstrumentEntry('fermenter-1', 'fermenter')]);
            const onScheduled = vi.fn();

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
                onScheduled,
            });

            expect(onScheduled).toHaveBeenCalledWith({ scheduledNotes: 1, scheduledBuffers: [] });
        });

        it('counts nothing when the clip length has projected every note away', async () => {
            // What a non-destructive right-edge trim leaves behind: the note is
            // still in `notesByClipId`, and `getGrooveProjection` drops it for
            // starting at or past the clip's own length. Presence in the store
            // is not scheduling, and the tally must agree with the scheduler.
            const { configureOfflineMidiEventProjection } = await import('../../configureOfflineMidiEventProjection');
            configureOfflineMidiEventProjection({
                createProjector: () => () => [],
                selectProbability: () => true,
                createChordPitchProjector: () => (input) => input.pitch,
                evaluateAutomationValue: () => 0,
            });
            const { midiStore } = await import('#/modules/MIDI/stores');
            const track = TrackDummy.create({
                id: 'track-1',
                kind: 'midi',
                clips: [midiClip()],
                devices: [
                    { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
                ],
            });
            mocks.buildDeviceChain.mockResolvedValue([createInstrumentEntry('fermenter-1', 'fermenter')]);
            const onScheduled = vi.fn();

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
                onScheduled,
            });

            expect(midiStore.value?.notesByClipId['clip-1']).toHaveLength(1);
            expect(onScheduled).toHaveBeenCalledWith({ scheduledNotes: 0, scheduledBuffers: [] });
        });

        it('counts nothing when every note loses its probability roll', async () => {
            const { configureOfflineMidiEventProjection } = await import('../../configureOfflineMidiEventProjection');
            configureOfflineMidiEventProjection({
                createProjector: () => (input) => input.events,
                selectProbability: () => false,
                createChordPitchProjector: () => (input) => input.pitch,
                evaluateAutomationValue: () => 0,
            });
            const track = TrackDummy.create({
                id: 'track-1',
                kind: 'midi',
                clips: [midiClip()],
                devices: [
                    { id: 'fermenter-1', name: 'Fermenter', type: 'fermenter', bypassed: false, parameterValues: {} },
                ],
            });
            mocks.buildDeviceChain.mockResolvedValue([createInstrumentEntry('fermenter-1', 'fermenter')]);
            const onScheduled = vi.fn();

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
                onScheduled,
            });

            expect(onScheduled).toHaveBeenCalledWith({ scheduledNotes: 0, scheduledBuffers: [] });
        });

        it('records the source buffer of an audio clip it started, so the caller can read its samples', async () => {
            const { audioBufferCache } = await import('../../../stores/audioBufferCache');
            const sourceBuffer = {
                duration: 2,
                length: 2 * SAMPLE_RATE,
                numberOfChannels: 1,
                sampleRate: SAMPLE_RATE,
                getChannelData: () => new Float32Array(2 * SAMPLE_RATE),
            } as unknown as AudioBuffer;
            audioBufferCache.set('take-1', sourceBuffer);
            const track = TrackDummy.create({
                id: 'track-1',
                kind: 'audio',
                clips: [midiClip({ type: 'audio', audioBufferId: 'take-1' })],
            });
            const onScheduled = vi.fn();

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
                onScheduled,
            });

            expect(onScheduled).toHaveBeenCalledWith({ scheduledNotes: 0, scheduledBuffers: [sourceBuffer] });
        });

        it('records the frozen buffer an already-frozen contributor plays back', async () => {
            // A frozen track inside the subgraph feeds the target from its
            // buffer and never reaches clip scheduling, so this is the only
            // place its contribution can be observed.
            const { audioBufferCache } = await import('../../../stores/audioBufferCache');
            const frozenBuffer = {
                duration: 2,
                length: 2 * SAMPLE_RATE,
                numberOfChannels: 1,
                sampleRate: SAMPLE_RATE,
                getChannelData: () => new Float32Array(2 * SAMPLE_RATE),
            } as unknown as AudioBuffer;
            audioBufferCache.set('frozen-1', frozenBuffer);
            const track = TrackDummy.create({
                id: 'track-1',
                kind: 'audio',
                clips: [midiClip({ type: 'audio' })],
                frozen: true,
                frozenBufferId: 'frozen-1',
                freezeState: { status: 'frozen', frozenBufferId: 'frozen-1' },
            });
            const onScheduled = vi.fn();

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
                onScheduled,
            });

            expect(onScheduled).toHaveBeenCalledWith({ scheduledNotes: 0, scheduledBuffers: [frozenBuffer] });
        });

        it('records nothing for an audio clip whose buffer is missing from the cache', async () => {
            const track = TrackDummy.create({
                id: 'track-1',
                kind: 'audio',
                clips: [midiClip({ type: 'audio', audioBufferId: 'evicted' })],
            });
            const onScheduled = vi.fn();

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
                onScheduled,
            });

            expect(onScheduled).toHaveBeenCalledWith({ scheduledNotes: 0, scheduledBuffers: [] });
        });
    });

    // ── SPEC-offline-live-collapse AC-9 and AC-1 ───────────────────────────
    //
    // Both are properties of the *context this path constructs*, so they share
    // a stub that allocates nothing: the real freeze path builds its
    // `OfflineAudioContext` immediately after the clamp, and a 2^30-frame
    // context is ~8.6 GB, which fails allocation long before the assertion
    // could run. `RenderHarnessContext` above also allocates its channel in
    // `startRendering`, so it cannot be reused here either.
    describe('the context it constructs', () => {
        /** Every `addModule` specifier this render registered, in call order. */
        let registeredModules: string[] = [];
        /** Frame counts the render asked its context for, in construction order. */
        let requestedFrameCounts: number[] = [];

        class ProbeContext {
            readonly destination = createNode();
            readonly audioWorklet = {
                addModule: (specifier: string): Promise<void> => {
                    registeredModules.push(specifier);
                    return Promise.resolve();
                },
            };

            constructor(
                readonly numberOfChannels: number,
                readonly length: number,
                readonly sampleRate: number
            ) {
                requestedFrameCounts.push(length);
            }

            createGain() {
                return { ...createNode(), gain: createParam(1) };
            }
            createStereoPanner() {
                return { ...createNode(), pan: createParam(0) };
            }
            createDelay() {
                return { ...createNode(), delayTime: createParam(0) };
            }
            createBufferSource() {
                return { ...createNode(), buffer: null, playbackRate: createParam(1), start: vi.fn(), stop: vi.fn() };
            }
            createOscillator() {
                return { ...createNode(), type: 'sine', frequency: createParam(440), start: vi.fn(), stop: vi.fn() };
            }
            suspend(): Promise<void> {
                return Promise.resolve();
            }
            resume(): Promise<void> {
                return Promise.resolve();
            }
            startRendering(): Promise<AudioBuffer> {
                // One frame of nothing. The assertions here read what the render
                // *built*, never what it rendered, so the buffer is a stub.
                return Promise.resolve({
                    duration: 0,
                    length: 1,
                    numberOfChannels: 1,
                    sampleRate: this.sampleRate,
                    getChannelData: () => new Float32Array(1),
                } as unknown as AudioBuffer);
            }
        }

        beforeEach(() => {
            registeredModules = [];
            requestedFrameCounts = [];
            vi.stubGlobal('OfflineAudioContext', ProbeContext);
        });

        /**
         * AC-9. The clamp is shared so the truncation is *reported*; the frame
         * count itself is deliberately not asserted, because both sides would
         * read it from `MAX_OFFLINE_FRAMES` and the comparison would survive
         * the only mutation available (re-inlining the `Math.min` leaves the
         * count correct and the warning gone). ADR 0015 rule 3.
         */
        it('reports the truncation when the requested timeline exceeds the renderer cap', async () => {
            const onWarning = vi.fn();
            // 2^30 frames at 44 100 Hz is ~6.8 h; at 120 bpm a beat is 0.5 s, so
            // 200 000 beats (~27.8 h) is comfortably past the cap.
            const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 200_000,
                onWarning,
            });

            expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Export truncated to'));
        });

        it('rejects a bounded range beyond the frame cap before allocating a context', async () => {
            const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

            await expect(
                renderTrackSubgraphOffline({
                    targetTrackId: track.id,
                    renderTracks: [track],
                    startBeat: 100_000,
                    endBeat: 100_004,
                })
            ).rejects.toThrow('requested region exceeds');
            expect(requestedFrameCounts).toEqual([]);
        });

        it('budgets the retained history buffer and cropped output before allocating a context', async () => {
            const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

            await expect(
                renderTrackSubgraphOffline({
                    targetTrackId: track.id,
                    renderTracks: [track],
                    startBeat: 48_691,
                    endBeat: 48_695,
                })
            ).rejects.toThrow();
            expect(requestedFrameCounts).toEqual([]);
        });

        /**
         * AC-1. The freeze/bounce path builds a bare context and registers
         * neither out-of-band module, so freezing a sidechained track bakes
         * self-keyed compression and freezing a bitcrusher bakes no decimation
         * — both silently, because `onWarning` lives on a `prepared` record
         * that was never created.
         */
        it('registers the sidechain key module before any strip is built', async () => {
            const { sidechainStore } = await import('#/modules/Routing/stores');
            const source = TrackDummy.create({ id: 'source-1', kind: 'audio' });
            const target = TrackDummy.create({
                id: 'track-1',
                kind: 'audio',
                devices: [
                    {
                        id: 'sc-1',
                        name: 'Sidechain',
                        type: 'builtin-sidechain-compressor',
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
            });
            sidechainStore.set({
                ...sidechainStore.value!,
                routes: [
                    {
                        id: 'route-1',
                        sourceTrackId: 'source-1',
                        targetTrackId: 'track-1',
                        targetDeviceId: 'sc-1',
                        targetParameterId: 'threshold',
                        gain: 1,
                    },
                ],
            });

            await renderTrackSubgraphOffline({
                targetTrackId: target.id,
                renderTracks: [target, source],
                startBeat: 0,
                endBeat: 4,
            });

            expect(registeredModules).toContain('/audio/worklets/sidechain-compressor-processor.js');
        });

        it('registers the bitcrusher rate module when the subgraph carries a bitcrusher', async () => {
            const track = TrackDummy.create({
                id: 'track-1',
                kind: 'audio',
                devices: [
                    {
                        id: 'bc-1',
                        name: 'Bitcrusher',
                        type: 'builtin-bitcrusher',
                        bypassed: false,
                        parameterValues: {},
                    },
                ],
            });

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
            });

            expect(registeredModules).toHaveLength(1);
        });

        /**
         * The negative half. A prepare that ran unconditionally would satisfy
         * both assertions above while making every freeze pay two module
         * fetches, so the population half is pinned too.
         */
        it('registers neither module for a subgraph that carries neither device', async () => {
            const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

            await renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
            });

            expect(registeredModules).toEqual([]);
        });

        // ── SPEC-offline-live-collapse AC-2 ───────────────────────────────
        //
        // The three exits are asserted separately because they are three
        // different ways out of the same function, and a teardown written after
        // the returned buffer satisfies only the first. A render that times out
        // or is cancelled built exactly as many devices as one that finished,
        // and every metered one is holding a telemetry slot that only
        // `destroy()` gives back.
        describe('device teardown', () => {
            function meteredDevice() {
                return {
                    id: 'gluten-1',
                    name: 'Gluten',
                    type: 'gluten',
                    bypassed: false,
                    parameterValues: {},
                };
            }

            /** A chain entry whose strategy records its own teardown. */
            function meteredEntry(destroy: ReturnType<typeof vi.fn>): DeviceNodeEntry {
                return {
                    deviceId: 'gluten-1',
                    deviceType: 'gluten',
                    node: {} as DeviceNodeEntry['node'],
                    strategy: { destroy } as unknown as DeviceNodeEntry['strategy'],
                };
            }

            it('destroys what it built when the render succeeds', async () => {
                const destroy = vi.fn();
                mocks.buildDeviceChain.mockResolvedValue([meteredEntry(destroy)]);
                const track = TrackDummy.create({ id: 'track-1', kind: 'audio', devices: [meteredDevice()] });

                await renderTrackSubgraphOffline({
                    targetTrackId: track.id,
                    renderTracks: [track],
                    startBeat: 0,
                    endBeat: 4,
                });

                expect(destroy).toHaveBeenCalledTimes(1);
            });

            it('destroys what it built when the render fails', async () => {
                const destroy = vi.fn();
                mocks.buildDeviceChain.mockResolvedValue([meteredEntry(destroy)]);
                class FailingContext extends ProbeContext {
                    override startRendering(): Promise<AudioBuffer> {
                        return Promise.reject(new Error('rendering failed'));
                    }
                }
                vi.stubGlobal('OfflineAudioContext', FailingContext);
                const track = TrackDummy.create({ id: 'track-1', kind: 'audio', devices: [meteredDevice()] });

                await expect(
                    renderTrackSubgraphOffline({
                        targetTrackId: track.id,
                        renderTracks: [track],
                        startBeat: 0,
                        endBeat: 4,
                    })
                ).rejects.toThrow();

                expect(destroy).toHaveBeenCalledTimes(1);
            });

            it('destroys what it built when the caller cancels', async () => {
                const destroy = vi.fn();
                mocks.buildDeviceChain.mockResolvedValue([meteredEntry(destroy)]);
                const controller = new AbortController();
                controller.abort();
                const track = TrackDummy.create({ id: 'track-1', kind: 'audio', devices: [meteredDevice()] });

                await expect(
                    renderTrackSubgraphOffline({
                        targetTrackId: track.id,
                        renderTracks: [track],
                        startBeat: 0,
                        endBeat: 4,
                        abortSignal: controller.signal,
                    })
                ).rejects.toThrow();

                expect(destroy).toHaveBeenCalledTimes(1);
            });
        });
    });
});
