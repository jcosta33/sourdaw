import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

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
        const channel = new Float32Array(this.length);
        for (const contribution of contributions) {
            const end = Math.min(this.length, contribution.endFrame);
            for (let frame = Math.max(0, contribution.startFrame); frame < end; frame++) {
                channel[frame] = channel[frame]! + contribution.sample(frame);
            }
        }
        const buffer = {
            duration: this.length / this.sampleRate,
            length: this.length,
            numberOfChannels: 1,
            sampleRate: this.sampleRate,
            getChannelData: () => channel,
            copyFromChannel: vi.fn(),
            copyToChannel: vi.fn(),
        };
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
}));

vi.mock('../../buildDeviceChain', () => ({ buildDeviceChain: mocks.buildDeviceChain }));
vi.mock('../../engineAccess/getAudioContext', () => ({ getAudioContext: mocks.getAudioContext }));

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
            noteOn: (note, velocity, midiNote, sampleFrame) => {
                mocks.instrumentNoteOn(note, velocity, midiNote, sampleFrame);
                heldNotes.set(note, sampleFrame ?? 0);
            },
            noteOff: (note, sampleFrame) => {
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

describe('renderTrackSubgraphOffline', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        contributions.length = 0;
        createdGains.length = 0;
        vi.stubGlobal('OfflineAudioContext', RenderHarnessContext);
        mocks.getAudioContext.mockReturnValue({ sampleRate: SAMPLE_RATE });
        mocks.buildDeviceChain.mockResolvedValue([]);

        const { configureOfflineMidiEventProjection } = await import('../../configureOfflineMidiEventProjection');
        const { configureOfflinePpqEndpointProjection } = await import('../../configureOfflinePpqEndpointProjection');
        const { configureOfflineYeastMidiProcessing } = await import('../../configureOfflineYeastMidiProcessing');
        configureOfflinePpqEndpointProjection({
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

        it('rejects a wedged render once its wall-clock budget is spent instead of hanging forever', async () => {
            vi.useFakeTimers();
            stubStalledContext();
            const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });

            const rendering = renderTrackSubgraphOffline({
                targetTrackId: track.id,
                renderTracks: [track],
                startBeat: 0,
                endBeat: 4,
            });
            const settled = expect(rendering).rejects.toThrow(/timed out/);

            // Past the 60 s floor the export paths already apply. Without a
            // backstop this promise never settles at all.
            await vi.advanceTimersByTimeAsync(70_000);
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
});
