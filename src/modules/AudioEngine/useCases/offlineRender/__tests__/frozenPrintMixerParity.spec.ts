import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { gainToDb } from '#/utils/audioLevelLaw';

import { renderTrackSubgraphOffline } from '../renderTrackSubgraphOffline';

const SAMPLE_RATE = 44_100;
const TEMPO = 120;

/** The project's default stored fader — the value every new track carries. */
const STORED_GAIN = 0.8;

// ---------------------------------------------------------------------------
// Level harness
//
// What is under test is a *level* defect: a frozen take that replays at the
// wrong amplitude and the wrong stereo image. So the assertions are amplitudes.
// Nodes record what they are connected to and what value they carry, and
// `measureLevel` walks the graph the production strip builder actually wired,
// multiplying gains and applying the WebAudio panning law along the way. The
// result is the linear gain a unit-amplitude signal entering at one node
// arrives at the destination with.
// ---------------------------------------------------------------------------

type HarnessNode = {
    __outputs: HarnessNode[];
    __gain?: { value: number };
    __pan?: { value: number };
    connect: (destination: unknown) => unknown;
    disconnect: () => void;
    numberOfInputs: number;
};

/** Amplitude travelling through the graph. `mono` until a panner splits it. */
type Signal = { left: number; right: number; mono: boolean };

/**
 * WebAudio's `StereoPannerNode` law, written out from the specification.
 *
 * Not approximated: the pan half of this file rests on the fact that applying
 * the law twice differs from applying it once, and a linear stand-in would hide
 * exactly the error being asserted. The mono and stereo branches differ, which
 * is why a print is modelled as mono-in and its replay as stereo-in.
 */
function applyPanLaw(signal: Signal, pan: number): Signal {
    if (signal.mono) {
        const x = ((pan + 1) / 2) * (Math.PI / 2);
        return { left: signal.left * Math.cos(x), right: signal.left * Math.sin(x), mono: false };
    }

    if (pan <= 0) {
        const x = (pan + 1) * (Math.PI / 2);
        return {
            left: signal.left + signal.right * Math.cos(x),
            right: signal.right * Math.sin(x),
            mono: false,
        };
    }

    const x = pan * (Math.PI / 2);
    return {
        left: signal.left * Math.cos(x),
        right: signal.right + signal.left * Math.sin(x),
        mono: false,
    };
}

function isHarnessNode(value: unknown): value is HarnessNode {
    return typeof value === 'object' && value !== null && '__outputs' in value;
}

type MeasureLevelInput = {
    from: HarnessNode;
    destination: HarnessNode;
    /** False models a stereo source, such as an already-printed buffer. */
    mono?: boolean;
};

/**
 * Linear gain from `from` to `destination`, summed over every path.
 *
 * The visited set is per-path rather than global, so a node genuinely reachable
 * by two routes contributes twice — what a summing bus does — while a cycle
 * still terminates.
 */
function measureLevel({ from, destination, mono = true }: MeasureLevelInput): Signal {
    const total: Signal = { left: 0, right: 0, mono: false };
    /** Paths that arrived. A measurement of zero is a real answer; no path at all is a broken harness. */
    const arrivals: Signal[] = [];

    function walk(node: HarnessNode, signal: Signal, path: ReadonlySet<HarnessNode>): void {
        if (path.has(node)) {
            return;
        }

        // A signal connected *into* a node is processed by that node, so the
        // entry node's own gain and pan count. Measuring from the fader node —
        // where the mixdown attaches a frozen buffer — has to include the fader.
        let next = signal;
        if (node.__gain) {
            next = { ...next, left: next.left * node.__gain.value, right: next.right * node.__gain.value };
        }
        if (node.__pan) {
            next = applyPanLaw(next, node.__pan.value);
        }

        if (node === destination) {
            total.left += next.left;
            total.right += next.right;
            arrivals.push(next);
            return;
        }

        const nextPath = new Set(path);
        nextPath.add(node);
        for (const output of node.__outputs) {
            walk(output, next, nextPath);
        }
    }

    walk(from, { left: 1, right: 1, mono }, new Set());
    if (arrivals.length === 0) {
        throw new Error('No path from the measured node reached the destination');
    }
    return total;
}

function createHarnessNode(): HarnessNode {
    const node: HarnessNode = {
        __outputs: [],
        connect: (destination: unknown) => {
            if (isHarnessNode(destination)) {
                node.__outputs.push(destination);
            }
            return destination;
        },
        disconnect: () => {},
        numberOfInputs: 1,
    };
    return node;
}

/** Attach an AudioParam-shaped surface backed by the value the walk reads. */
function withParam(node: HarnessNode, name: string, backing: { value: number }): HarnessNode {
    return Object.assign(node, {
        [name]: Object.assign(backing, {
            setValueAtTime: vi.fn(),
            setTargetAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
        }),
    });
}

const contexts: LevelHarnessContext[] = [];

class LevelHarnessContext {
    readonly destination: HarnessNode = createHarnessNode();
    currentTime = 0;

    constructor(
        readonly numberOfChannels: number,
        readonly length: number,
        readonly sampleRate: number
    ) {
        contexts.push(this);
    }

    createGain(): HarnessNode {
        const node = createHarnessNode();
        node.__gain = { value: 1 };
        return withParam(node, 'gain', node.__gain);
    }

    createStereoPanner(): HarnessNode {
        const node = createHarnessNode();
        node.__pan = { value: 0 };
        return withParam(node, 'pan', node.__pan);
    }

    createDelay(): HarnessNode {
        return withParam(createHarnessNode(), 'delayTime', { value: 0 });
    }

    createBufferSource(): HarnessNode {
        const node = withParam(createHarnessNode(), 'playbackRate', { value: 1 });
        return Object.assign(node, { buffer: null, start: vi.fn(), stop: vi.fn() });
    }

    createOscillator(): HarnessNode {
        const node = withParam(createHarnessNode(), 'frequency', { value: 440 });
        return Object.assign(node, { type: 'sine', start: vi.fn(), stop: vi.fn() });
    }

    suspend(): Promise<void> {
        return Promise.resolve();
    }

    resume(): Promise<void> {
        return Promise.resolve();
    }

    startRendering(): Promise<AudioBuffer> {
        return Promise.resolve({
            duration: this.length / this.sampleRate,
            length: this.length,
            numberOfChannels: 2,
            sampleRate: this.sampleRate,
            getChannelData: () => new Float32Array(this.length),
        } as unknown as AudioBuffer);
    }
}

const mocks = vi.hoisted(() => ({
    buildDeviceChain: vi.fn(),
    getAudioContext: vi.fn(() => ({ sampleRate: 44_100 })),
    builtStrips: [] as unknown[],
}));

vi.mock('../../buildDeviceChain', () => ({ buildDeviceChain: mocks.buildDeviceChain }));
vi.mock('../../engineAccess/getAudioContext', () => ({ getAudioContext: mocks.getAudioContext }));

// The real strip builder runs — the values under test are the ones it computes.
// This only keeps a handle on the strips so their nodes can be measured.
vi.mock('../createOfflineTrackStrip', async (importOriginal) => {
    const original = await importOriginal<typeof import('../createOfflineTrackStrip')>();
    return {
        createOfflineTrackStrip: async (
            ...args: Parameters<typeof original.createOfflineTrackStrip>
        ): ReturnType<typeof original.createOfflineTrackStrip> => {
            const strip = await original.createOfflineTrackStrip(...args);
            mocks.builtStrips.push(strip);
            return strip;
        },
    };
});

function makeTrack(overrides: Partial<Track> = {}): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: STORED_GAIN,
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
    };
}

type RenderedStrip = {
    preFaderTap: HarnessNode;
    faderNode: HarnessNode;
    destination: HarnessNode;
};

type RunRenderInput = {
    track: Track;
    targetMixer?: 'bake' | 'keepLive';
};

/** Render one track and hand back the strip and destination the render used. */
async function runRender({ track, targetMixer }: RunRenderInput): Promise<RenderedStrip> {
    mocks.builtStrips.length = 0;
    contexts.length = 0;
    trackStore.set({ tracks: [track], selectedTrackId: null });
    await renderTrackSubgraphOffline({
        targetTrackId: track.id,
        renderTracks: [track],
        startBeat: 0,
        endBeat: 4,
        targetMixer,
    });
    const strip = mocks.builtStrips[0] as RenderedStrip | undefined;
    const context = contexts[0];
    if (!strip || !context) {
        throw new Error('The render built no strip for the target track');
    }
    return { preFaderTap: strip.preFaderTap, faderNode: strip.faderNode, destination: context.destination };
}

/**
 * Freeze prints the target strip's output and both playback paths replay that
 * buffer through the very same fader and panner — live attaches it to
 * `preFaderTap`, the mixdown to the fader node. So whatever the print carries
 * of the fader and the pan position is applied a second time on the way out.
 */
describe('frozen print / replay mixer parity', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.builtStrips.length = 0;
        contexts.length = 0;
        vi.stubGlobal('OfflineAudioContext', LevelHarnessContext);
        mocks.getAudioContext.mockReturnValue({ sampleRate: SAMPLE_RATE });
        mocks.buildDeviceChain.mockImplementation(
            (_ctx: unknown, _devices: unknown, input: HarnessNode, output: HarnessNode) => {
                // An empty chain is a pass-through, as the real builder leaves
                // it. Without this the strip has no signal path and every
                // measurement would read zero.
                input.connect(output);
                return [];
            }
        );

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

        const { midiStore } = await import('#/modules/MIDI/stores');
        const { transportStore } = await import('#/modules/Transport/stores');
        transportStore.set({ ...transportStore.value!, tempo: TEMPO });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('applies the stored fader exactly once across printing and replaying a take', async () => {
        const print = await runRender({ track: makeTrack(), targetMixer: 'keepLive' });
        const printed = measureLevel({ from: print.preFaderTap, destination: print.destination });

        const replay = await runRender({
            track: makeTrack({
                frozen: true,
                frozenBufferId: 'freeze-1',
                freezeState: { status: 'frozen', frozenBufferId: 'freeze-1' },
            }),
        });
        // The print is a stereo buffer by the time it is replayed.
        const replayed = measureLevel({ from: replay.faderNode, destination: replay.destination, mono: false });

        // A take that was never frozen reaches the same destination through one
        // fader. That is the level the frozen one has to match.
        const unfrozen = await runRender({ track: makeTrack() });
        const reference = measureLevel({ from: unfrozen.preFaderTap, destination: unfrozen.destination });

        const totalLeft = printed.left * replayed.left;
        expect(gainToDb(totalLeft)).toBeCloseTo(gainToDb(reference.left), 4);
    });

    it('prints a centred image so the stored pan is imposed once, at replay', async () => {
        const print = await runRender({ track: makeTrack({ pan: 25 }), targetMixer: 'keepLive' });
        const printed = measureLevel({ from: print.preFaderTap, destination: print.destination });

        // Nothing about the stored pan belongs in the buffer: the panner that
        // imposes it is still in front of the buffer at replay.
        expect(gainToDb(printed.right) - gainToDb(printed.left)).toBeCloseTo(0, 4);
    });
});
