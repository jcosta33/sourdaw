import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';
import { type TransportState } from '#/modules/Transport/stores';

import { setAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { exportCancellationState } from '../offlineRender/exportCancellationState';
import { type OfflineRenderContext } from '../offlineRender/resolveRenderContext';
import { renderOffline } from '../renderOffline';

const SAMPLE_RATE = 48_000;

const emptyMidi: NonNullable<MidiStoreState> = {
    probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

const mocks = vi.hoisted(() => ({
    sidechainStore: { value: { routes: [] as Array<Record<string, unknown>> } },
    resolveRenderContext: vi.fn(),
    creators: {
        levain: vi.fn(),
    },
}));

vi.mock('#/modules/Routing/stores', () => ({ sidechainStore: mocks.sidechainStore }));
vi.mock('../offlineRender/resolveRenderContext', () => ({ resolveRenderContext: mocks.resolveRenderContext }));
vi.mock('../../engine/LevainNode', () => ({
    isLevainDevice: (t: string) => t === 'levain',
    createLevainNode: mocks.creators.levain,
}));

/**
 * Render-level cancellation across instrument preparation (#4440). Unlike
 * `renderOfflineCancellation.spec.ts`, `createOfflineTrackStrip` is NOT mocked:
 * the real strip builder runs the real `buildDeviceChain`, and only the WASM
 * node construction is faked — so the acceptance's "verify real preparation
 * wiring" holds end to end from `renderOffline` through the backend command to
 * `runOfflineInstrumentSetup`.
 */
class FakeOfflineContext {
    static latest: FakeOfflineContext | null = null;

    destination = {};
    audioWorklet = { addModule: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    sampleRate = SAMPLE_RATE;
    length = 0;

    constructor(
        public readonly channels: number,
        public frameCount: number
    ) {
        FakeOfflineContext.latest = this;
    }

    createGain(): unknown {
        return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    }

    createStereoPanner(): unknown {
        return { pan: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
    }

    startRendering(): Promise<AudioBuffer> {
        return Promise.resolve({
            duration: this.frameCount / SAMPLE_RATE,
            length: this.frameCount,
        } as AudioBuffer);
    }
}

class FakeAudioWorkletNode {
    public readonly port = { postMessage: vi.fn() } as unknown as MessagePort;
    public readonly connect = vi.fn();
    public readonly disconnect = vi.fn();
    constructor(public readonly numberOfInputs: number) {}
}

function makeLevainTrack(): Track {
    return {
        id: 'track-1',
        name: 'Levain track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff00',
        clips: [],
        devices: [{ id: 'levain-1', name: 'levain', type: 'levain', bypassed: false, parameterValues: {} }],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
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
    };
}

function makeContext(): OfflineRenderContext {
    return {
        tracks: { tracks: [makeLevainTrack()] } as unknown as TrackStoreState,
        midi: emptyMidi,
        transport: { masterGain: 50 } as TransportState,
        defaultTempo: 120,
        changes: [],
        startBeat: 0,
        durationSeconds: 2,
        tailSeconds: 0,
        projectMidiEvents: ({ events }) => events,
        selectMidiEventProbability: () => true,
        projectChordPitch: ({ pitch }) => pitch,
        projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => ({
            startSamples: startPpq * sampleRate,
            endSamples: endPpq * sampleRate,
            durationSamples: (endPpq - startPpq) * sampleRate,
            startSeconds: startPpq,
            endSeconds: endPpq,
            durationSeconds: endPpq - startPpq,
        }),
        processYeastMidi: null,
        resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
        evaluateAutomationValue: null,
    };
}

describe('renderOffline — cancelling during offline instrument setup (#4440)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        exportCancellationState.cancelFlag = false;
        exportCancellationState.isRenderingActive = false;
        exportCancellationState.controller = new AbortController();
        FakeOfflineContext.latest = null;
        vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        mocks.sidechainStore.value.routes = [];
        mocks.resolveRenderContext.mockReturnValue(makeContext());
        mocks.creators.levain.mockResolvedValue({
            workletNode: new FakeAudioWorkletNode(0),
            ready: Promise.resolve({}),
            noteOn: vi.fn(),
            noteOff: vi.fn(),
        });
    });

    afterEach(() => {
        exportCancellationState.cancelFlag = false;
        vi.unstubAllGlobals();
        setAudioDeviceRuntimeSink({});
    });

    it('aborts a pending instrument setup at cancellation, releases the lock, and never reports success', async () => {
        let setupSignal: AbortSignal | undefined;
        const settleSetups: Array<(value: void) => void> = [];
        setAudioDeviceRuntimeSink({
            prepareOfflineInstrument: ({ signal }) =>
                new Promise<void>((resolve, reject) => {
                    setupSignal = signal;
                    settleSetups.push(resolve);
                    signal?.addEventListener('abort', () => {
                        reject(new Error('The operation was aborted'));
                    });
                }),
        });

        const rendering = renderOffline({ durationBeats: 4, sampleRate: SAMPLE_RATE });

        // Drive the render until the instrument setup is genuinely in flight —
        // through the real backend command, the real strip builder, and the
        // real chain build, not a mocked seam.
        for (let attempt = 0; attempt < 200 && setupSignal === undefined; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        expect(setupSignal).toBeDefined();
        expect(setupSignal?.aborted).toBe(false);

        const { cancelExport } = await import('../offlineRender/exportCancellation');
        // The bound is the discriminator: without the threading, the same
        // assertions would all pass at the 30-second deadline instead of at
        // Cancel, and the render would unwind only after that wait.
        const cancelledAt = Date.now();
        cancelExport();

        await expect(rendering).rejects.toThrow('Export cancelled');
        expect(Date.now() - cancelledAt).toBeLessThan(5_000);
        // The fetch-side signal aborted at the moment of cancellation — the
        // 30-second deadline was nowhere near firing.
        expect(setupSignal?.aborted).toBe(true);
        // The render lock released with the unwind and the cancel state reset:
        // a second export not only starts, it completes — nothing the first
        // render left behind (lock, flag, aborted scope) blocks it.
        const second = renderOffline({ durationBeats: 4, sampleRate: SAMPLE_RATE });
        for (let attempt = 0; attempt < 200 && settleSetups.length < 2; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        expect(settleSetups.length).toBeGreaterThanOrEqual(2);
        settleSetups[1]?.();
        await expect(second).resolves.toBeTypeOf('object');
        void FakeOfflineContext.latest;
    });
});
