import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';

import { installWorkletGlobals, makeChannels } from '../../../services/__tests__/wasmViewGrowthHarness';
import { buildDeviceChain, type DeviceNodeEntry } from '../../buildDeviceChain';
import { schedulePendingSuspends } from '../schedulePendingSuspends';
import { scheduleTrackClips } from '../scheduleTrackClips';
import { type PendingWorkletEvent } from '../types';

const wasmModule = new WebAssembly.Module(readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm')));

vi.mock('#/infra/audioWorklet/workletInitShared', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/audioWorklet/workletInitShared')>()),
    ensureWorkletRegistered: vi.fn(() => Promise.resolve()),
    fetchWasmModule: vi.fn(() => Promise.resolve({ module: wasmModule, commit: vi.fn(), release: vi.fn() })),
}));
vi.mock('../../../repositories/offlineScheduler/automationScheduling', () => ({
    scheduleTrackAutomation: vi.fn(),
}));
vi.mock('../../latencyCompensation/compensation/getCompensationDelay', () => ({
    getCompensationDelay: vi.fn(() => 0),
}));

type Processor = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};
type SimulatedNode = {
    processor: Processor;
    sent: unknown[];
    received: unknown[];
};

const SAMPLE_RATE = 48_000;
const FRAMES = 128;
const SAMPLE_FRAMES = 4_800;

function makeAudioNode(): AudioNode {
    return { connect: vi.fn(), disconnect: vi.fn(), numberOfInputs: 0 } as unknown as AudioNode;
}

function makeTrack(id: string, withClip: boolean): Track {
    const clips: Track['clips'] = [];
    if (withClip) {
        clips.push({
            id: `clip-${id}`,
            trackId: id,
            name: 'Notes',
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ffffff',
            locked: false,
            muted: false,
        });
    }
    return {
        id,
        name: id,
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ffffff',
        clips,
        devices: [{ id: `levain-${id}`, name: 'Levain', type: 'levain', bypassed: false, parameterValues: {} }],
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
    };
}

function makeMidi(track: Track): NonNullable<MidiStoreState> {
    const clipId = track.clips[0]?.id;
    const notesByClipId: NonNullable<MidiStoreState>['notesByClipId'] = {};
    if (clipId) {
        notesByClipId[clipId] = [{ id: `note-${track.id}`, pitch: 60, startBeat: 0, duration: 1, velocity: 100 }];
    }
    return {
        probabilitySeed: 1,
        notesByClipId,
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

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

async function scheduleTrack(
    offlineCtx: OfflineAudioContext,
    track: Track,
    allTracks: Track[],
    deviceEntriesByTrack: Map<string, DeviceNodeEntry[]>,
    pendingWorkletEvents: PendingWorkletEvent[]
): Promise<void> {
    await scheduleTrackClips({
        offlineCtx,
        track,
        midi: makeMidi(track),
        trackInputNode: makeAudioNode() as GainNode,
        trackGainNode: makeAudioNode() as GainNode,
        trackPanNode: makeAudioNode() as StereoPannerNode,
        destination: makeAudioNode(),
        durationSeconds: 2,
        defaultTempo: 120,
        changes: [],
        projections: {
            projectMidiEvents: ({ events }) => events,
            projectPpqEndpoints,
            processYeastMidi: null,
            resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
            selectMidiEventProbability: () => true,
            projectChordPitch: ({ pitch }) => pitch,
            evaluateAutomationValue: null,
        },
        pendingWorkletEvents,
        allTracks,
        deviceEntriesByTrack,
    });
}

function send(processor: Processor, data: unknown): void {
    processor.port.onmessage?.({ data });
}

function loadBank(processor: Processor, instrumentId: string): void {
    const loadToken = 1;
    send(processor, { type: 'beginSampleBank', bankKey: `bank-${instrumentId}`, instrumentId, loadToken });
    const data = new Float32Array(SAMPLE_FRAMES).map((_, frame) => Math.sin(frame * 0.05) * 0.5);
    send(processor, {
        type: 'addSample',
        loadToken,
        sampleId: 0,
        data,
        frameCount: SAMPLE_FRAMES,
        channels: 1,
        sampleRate: SAMPLE_RATE,
    });
    send(processor, {
        type: 'addZone',
        loadToken,
        zoneId: 0,
        sampleId: 0,
        articulationId: 0,
        rootNote: 60,
        loKey: 0,
        hiKey: 127,
        loVel: 0,
        hiVel: 127,
        rrPos: 0,
        rrLen: 1,
        micId: 0,
        loopMode: 'forward',
        loopStart: 0,
        loopEnd: SAMPLE_FRAMES,
        loopCrossfade: 0,
        gainDb: 0,
        attack: 0.005,
        decay: 0.1,
        sustain: 1,
        release: 0.3,
    });
    send(processor, { type: 'buildZoneMap', loadToken, numArticulations: 1, numMics: 1 });
}

function render(processor: Processor): Float32Array[][] {
    const outputs: Float32Array[][] = [];
    for (let block = 0; block < 4; block++) {
        vi.stubGlobal('currentFrame', block * FRAMES);
        const channels = makeChannels(2, FRAMES);
        expect(processor.process([], [channels])).toBe(true);
        outputs.push(channels);
    }
    return outputs;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('two shipped Levain processors through the offline MIDI route', () => {
    it('sounds only the track the scheduler selected, while both banks are playable', async () => {
        const { registry } = installWorkletGlobals<Processor>();
        await import('../../../services/levainProcessor');
        const ProcessorCtor = registry.get('levain-processor');
        if (!ProcessorCtor) {
            throw new Error('Levain processor was not registered');
        }
        const simulated: SimulatedNode[] = [];
        class FakeAudioContext {}
        class SimulatedAudioWorkletNode {
            port: MessagePort;
            numberOfInputs = 0;
            connect = vi.fn();
            disconnect = vi.fn();
            constructor(_ctx: BaseAudioContext, _name: string, options: AudioWorkletNodeOptions) {
                const processor = new ProcessorCtor({ processorOptions: options.processorOptions });
                const sent: unknown[] = [];
                const received: unknown[] = [];
                const port = {
                    onmessage: null as ((event: { data: unknown }) => void) | null,
                    postMessage(data: unknown) {
                        sent.push(data);
                        send(processor, data);
                    },
                    close: vi.fn(),
                };
                processor.port.postMessage.mockImplementation((data: unknown) => {
                    received.push(data);
                    port.onmessage?.({ data });
                });
                this.port = port as unknown as MessagePort;
                simulated.push({ processor, sent, received });
            }
        }
        vi.stubGlobal('AudioContext', FakeAudioContext);
        vi.stubGlobal('AudioWorkletNode', SimulatedAudioWorkletNode);
        const offlineCtx = { sampleRate: SAMPLE_RATE, currentTime: 0, state: 'running' } as OfflineAudioContext;
        const a = makeTrack('a', true);
        const b = makeTrack('b', false);
        const instruments = new Map([
            ['levain-a', async () => undefined],
            ['levain-b', async () => undefined],
        ]);
        const aEntries = await buildDeviceChain(offlineCtx, a.devices, makeAudioNode(), makeAudioNode(), {
            instruments,
        });
        const bEntries = await buildDeviceChain(offlineCtx, b.devices, makeAudioNode(), makeAudioNode(), {
            instruments,
        });
        expect(aEntries[0]?.instrumentControls).toBeDefined();
        expect(bEntries[0]?.instrumentControls).toBeDefined();
        expect(simulated).toHaveLength(2);
        loadBank(simulated[0]!.processor, 'cello');
        loadBank(simulated[1]!.processor, 'horn');
        for (const node of simulated) {
            expect(node.received).toContainEqual({ type: 'sampleBankLoaded', loadToken: 1 });
            expect(node.received).not.toContainEqual(expect.objectContaining({ type: 'error' }));
        }

        const entries = new Map([
            [a.id, aEntries],
            [b.id, bEntries],
        ]);
        const pending: PendingWorkletEvent[] = [];
        await scheduleTrack(offlineCtx, a, [a, b], entries, pending);
        await scheduleTrack(offlineCtx, b, [a, b], entries, pending);
        const noteOns = pending.filter((event) => event.type === 'on');
        expect(noteOns).toHaveLength(1);
        expect(noteOns[0]).toMatchObject({ instrumentControls: aEntries[0]?.instrumentControls });
        expect(noteOns[0]).not.toMatchObject({ instrumentControls: bEntries[0]?.instrumentControls });
        schedulePendingSuspends(offlineCtx, pending, 2);
        expect(simulated[0]!.sent).toContainEqual(expect.objectContaining({ type: 'noteOn', note: 60 }));
        expect(simulated[1]!.sent).not.toContainEqual(expect.objectContaining({ type: 'noteOn' }));

        const aOutputs = render(simulated[0]!.processor);
        const bOutputs = render(simulated[1]!.processor);
        expect(
            Math.max(...aOutputs.flatMap((channels) => channels.flatMap((channel) => Array.from(channel, Math.abs))))
        ).toBeGreaterThan(1e-6);
        expect(bOutputs.every((channels) => channels.every((channel) => channel.every((sample) => sample === 0)))).toBe(
            true
        );

        const bWithNote = makeTrack('b', true);
        const bControl: PendingWorkletEvent[] = [];
        await scheduleTrack(offlineCtx, bWithNote, [a, bWithNote], entries, bControl);
        expect(bControl.filter((event) => event.type === 'on')).toMatchObject([
            { instrumentControls: bEntries[0]?.instrumentControls },
        ]);
        schedulePendingSuspends(offlineCtx, bControl, 2);
        expect(simulated[1]!.sent).toContainEqual(expect.objectContaining({ type: 'noteOn', note: 60 }));
        const bPlayable = render(simulated[1]!.processor);
        expect(
            Math.max(...bPlayable.flatMap((channels) => channels.flatMap((channel) => Array.from(channel, Math.abs))))
        ).toBeGreaterThan(1e-6);
        expect(simulated.flatMap((node) => node.received)).not.toContainEqual(
            expect.objectContaining({ type: 'error' })
        );
    });
});
