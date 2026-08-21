import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';
import { type TransportState } from '#/modules/Transport/stores';

import { exportCancellationState } from '../offlineRender/exportCancellationState';
import { type OfflineRenderContext } from '../offlineRender/resolveRenderContext';
import { type OfflineTrackStrip } from '../offlineRender/types';
import { renderOffline } from '../renderOffline';

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 4;

const emptyMidi: NonNullable<MidiStoreState> = {
    probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

const mocks = vi.hoisted(() => ({
    sidechainStore: { value: { routes: [] as Array<Record<string, unknown>> } },
    resolveRenderContext: vi.fn(),
    createOfflineTrackStrip: vi.fn(),
    scheduleTrackClips: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    schedulePendingSuspends: vi.fn(),
}));

vi.mock('#/modules/Routing/stores', () => ({ sidechainStore: mocks.sidechainStore }));
vi.mock('../offlineRender/resolveRenderContext', () => ({ resolveRenderContext: mocks.resolveRenderContext }));
vi.mock('../offlineRender/createOfflineTrackStrip', () => ({
    createOfflineTrackStrip: mocks.createOfflineTrackStrip,
}));
vi.mock('../offlineRender/scheduleTrackClips', () => ({ scheduleTrackClips: mocks.scheduleTrackClips }));
vi.mock('../offlineRender/schedulePendingSuspends', () => ({
    schedulePendingSuspends: mocks.schedulePendingSuspends,
}));

const renderedBuffer = { duration: DURATION_SECONDS, length: DURATION_SECONDS * SAMPLE_RATE } as AudioBuffer;

/** Suspend/resume-capable stand-in: the render only advances while resumed. */
class SuspendableOfflineContext {
    static latest: SuspendableOfflineContext | null = null;

    suspendResolvers = new Map<number, () => void>();
    resumeCount = 0;
    renderCompleted = false;
    destination = {};
    audioWorklet = { addModule: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    sampleRate = SAMPLE_RATE;

    private resolveRender: ((buffer: AudioBuffer) => void) | null = null;

    constructor() {
        SuspendableOfflineContext.latest = this;
    }

    createGain(): unknown {
        return { gain: { value: 1 }, connect: vi.fn() };
    }

    createDelay(): unknown {
        return { delayTime: { value: 0 }, connect: vi.fn() };
    }

    suspend(seconds: number): Promise<void> {
        return new Promise<void>((resolve) => {
            this.suspendResolvers.set(seconds, resolve);
        });
    }

    resume(): Promise<void> {
        this.resumeCount += 1;
        return Promise.resolve();
    }

    startRendering(): Promise<AudioBuffer> {
        return new Promise<AudioBuffer>((resolve) => {
            this.resolveRender = resolve;
        });
    }

    finishRendering(): void {
        this.renderCompleted = true;
        this.resolveRender?.(renderedBuffer);
    }
}

function makeStrip(trackId = 'track-1'): OfflineTrackStrip {
    const makeNode = () => ({ connect: vi.fn(), gain: { value: 1 } });
    return {
        trackId,
        inputNode: makeNode() as unknown as GainNode,
        preFaderTap: makeNode() as unknown as GainNode,
        faderNode: makeNode() as unknown as GainNode,
        postFaderGain: makeNode() as unknown as GainNode,
        panNode: { connect: vi.fn(), pan: { value: 0 } } as unknown as StereoPannerNode,
        outputNode: makeNode() as unknown as GainNode,
        deviceEntries: [],
    };
}

const track: Track = {
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

function makeContext(): OfflineRenderContext {
    return {
        tracks: { tracks: [track] } as unknown as TrackStoreState,
        midi: emptyMidi,
        transport: { masterGain: 50 } as TransportState,
        defaultTempo: 120,
        changes: [],
        startBeat: 0,
        durationSeconds: DURATION_SECONDS,
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

/** Waits until the render has scheduled the checkpoint at `seconds`, then releases it. */
async function reachCheckpoint(seconds: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        const resolver = SuspendableOfflineContext.latest?.suspendResolvers.get(seconds);
        if (resolver) {
            resolver();
            await new Promise((resolve) => setTimeout(resolve, 0));
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error(`checkpoint at ${seconds}s was never scheduled`);
}

describe('renderOffline — cancelling an in-flight render', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        exportCancellationState.cancelFlag = false;
        exportCancellationState.isRenderingActive = false;
        SuspendableOfflineContext.latest = null;
        vi.stubGlobal('OfflineAudioContext', SuspendableOfflineContext);
        mocks.sidechainStore.value.routes = [];
        mocks.resolveRenderContext.mockReturnValue(makeContext());
        mocks.createOfflineTrackStrip.mockImplementation((_ctx: OfflineAudioContext, track: { id: string }) =>
            Promise.resolve(makeStrip(track.id))
        );
    });

    afterEach(() => {
        exportCancellationState.cancelFlag = false;
        vi.unstubAllGlobals();
    });

    it('stops an already-started render at the next segment boundary instead of letting it finish', async () => {
        const rendering = renderOffline({ durationBeats: 8, sampleRate: SAMPLE_RATE });
        const rejection = expect(rendering).rejects.toThrow('Export cancelled');

        await reachCheckpoint(1);
        const context = SuspendableOfflineContext.latest!;
        expect(context.resumeCount).toBe(1);

        exportCancellationState.cancelFlag = true;
        await reachCheckpoint(2);

        await rejection;
        // The whole point: the render is left suspended at the cancel
        // boundary, so it stops consuming CPU rather than running to completion
        // in the background. A resume here would mean the work continued.
        expect(context.resumeCount).toBe(1);
        expect(context.renderCompleted).toBe(false);
    });

    it('reports real render progress from reached segment boundaries', async () => {
        const progress: number[] = [];
        const rendering = renderOffline({
            durationBeats: 8,
            sampleRate: SAMPLE_RATE,
            onProgress: (fraction) => progress.push(fraction),
        });

        await reachCheckpoint(1);
        await reachCheckpoint(2);
        await reachCheckpoint(3);
        SuspendableOfflineContext.latest!.finishRendering();
        await expect(rendering).resolves.toBe(renderedBuffer);

        // Scheduling owns 0–50%; the render phase maps its real 25/50/75% marks
        // onto the back half, so progress is measured, not eased toward 97%.
        expect(progress).toContain(0.625);
        expect(progress).toContain(0.75);
        expect(progress).toContain(0.875);
        expect(progress.at(-1)).toBe(1);
    });
});
