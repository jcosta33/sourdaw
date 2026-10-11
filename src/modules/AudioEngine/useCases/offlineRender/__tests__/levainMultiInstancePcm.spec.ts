import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';
import { captureOfflineLevain, prepareOfflineLevain } from '#/modules/Levain/useCases';
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
    const instrumentId = id === 'a' ? 'cello' : 'horn';
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
        devices: [
            {
                id: `levain-${id}`,
                name: 'Levain',
                type: 'levain',
                bypassed: false,
                parameterValues: {},
                deviceState: { version: 1, data: { instrumentId, currentArticulation: 'sustain' } },
            },
        ],
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

function manifest(instrumentId: 'cello' | 'horn') {
    return {
        version: 1,
        instrumentId,
        sampleRate: SAMPLE_RATE,
        micPositions: ['close'],
        articulations: [
            {
                type: 'sustain',
                id: 0,
                zones: [
                    {
                        file: 'sustain-c4.wav',
                        rootNote: 60,
                        loKey: 0,
                        hiKey: 127,
                        loVel: 0,
                        hiVel: 127,
                        rrPos: 0,
                        rrLen: 1,
                        micId: 0,
                        isRelease: false,
                        loopMode: 'forward',
                        loopStart: 0,
                        loopEnd: SAMPLE_FRAMES,
                        loopCrossfade: 0,
                        gainDb: 0,
                        attack: 0.005,
                        decay: 0.1,
                        sustain: 1,
                        release: 0.3,
                    },
                ],
            },
        ],
        legatoTransitions: [],
    };
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('two shipped Levain processors through the offline MIDI route', () => {
    it('sounds only the track the scheduler selected, while both banks are playable', async () => {
        vi.useFakeTimers();
        const { registry } = installWorkletGlobals<Processor>();
        await import('../../../services/levainProcessor');
        const ProcessorCtor = registry.get('levain-processor');
        if (!ProcessorCtor) {
            throw new Error('Levain processor was not registered');
        }
        const simulated: SimulatedNode[] = [];
        const decodedIdentities: number[] = [];
        class FakeAudioContext {}
        class FakeOfflineAudioContext {
            decodeAudioData = vi.fn(async (encoded: ArrayBuffer) => {
                const sample = new Float32Array(SAMPLE_FRAMES);
                const identity = new Uint8Array(encoded)[0];
                decodedIdentities.push(identity ?? -1);
                for (let frame = 0; frame < SAMPLE_FRAMES; frame++) {
                    sample[frame] = Math.sin(frame * 0.05) * (identity === 1 ? 0.5 : 0.4);
                }
                return {
                    numberOfChannels: 1,
                    length: SAMPLE_FRAMES,
                    sampleRate: SAMPLE_RATE,
                    getChannelData: (channel: number) => {
                        expect(channel).toBe(0);
                        return sample;
                    },
                } as AudioBuffer;
            });
        }
        const requested: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                requested.push(url);
                const match = /^\/samples\/levain\/(cello|horn)\/(manifest\.json|sustain-c4\.wav)$/.exec(url);
                if (!match) {
                    throw new Error(`Unexpected Levain sample request: ${url}`);
                }
                const instrumentId = match[1] as 'cello' | 'horn';
                return {
                    ok: true,
                    json: async () => manifest(instrumentId),
                    arrayBuffer: async () => new Uint8Array([instrumentId === 'cello' ? 1 : 2]).buffer,
                } as Response;
            })
        );
        class SimulatedAudioWorkletNode {
            port: MessagePort;
            numberOfInputs = 0;
            connect = vi.fn();
            disconnect = vi.fn();
            constructor(_ctx: BaseAudioContext, _name: string, options: AudioWorkletNodeOptions) {
                const processor = new ProcessorCtor({ processorOptions: options.processorOptions });
                const sent: unknown[] = [];
                const received: unknown[] = [];
                const listeners = new Set<EventListenerOrEventListenerObject>();
                const port = {
                    onmessage: null as ((event: { data: unknown }) => void) | null,
                    postMessage(data: unknown) {
                        sent.push(data);
                        send(processor, data);
                    },
                    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
                        if (type === 'message') {
                            listeners.add(listener);
                        }
                    },
                    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
                        if (type === 'message') {
                            listeners.delete(listener);
                        }
                    },
                    close: vi.fn(),
                };
                processor.port.postMessage.mockImplementation((data: unknown) => {
                    received.push(data);
                    const event = { data } as MessageEvent<unknown>;
                    port.onmessage?.(event);
                    for (const listener of [...listeners]) {
                        if (typeof listener === 'function') {
                            listener(event);
                        } else {
                            listener.handleEvent(event);
                        }
                    }
                });
                this.port = port as unknown as MessagePort;
                simulated.push({ processor, sent, received });
            }
        }
        vi.stubGlobal('AudioContext', FakeAudioContext);
        vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
        vi.stubGlobal('AudioWorkletNode', SimulatedAudioWorkletNode);
        const offlineCtx = { sampleRate: SAMPLE_RATE, currentTime: 0, state: 'running' } as OfflineAudioContext;
        const a = makeTrack('a', true);
        const b = makeTrack('b', false);
        const aCaptured = captureOfflineLevain({ deviceId: a.devices[0]!.id, device: a.devices[0], state: null });
        const bCaptured = captureOfflineLevain({ deviceId: b.devices[0]!.id, device: b.devices[0], state: null });
        expect([aCaptured.patch.instrumentId, bCaptured.patch.instrumentId]).toEqual(['cello', 'horn']);
        const prepared: string[] = [];
        const instruments = new Map([
            [
                a.devices[0]!.id,
                async ({ port, signal }: { port: MessagePort; signal?: AbortSignal }) => {
                    await prepareOfflineLevain({ deviceId: a.devices[0]!.id, port, signal, captured: aCaptured });
                    prepared.push('cello');
                },
            ],
            [
                b.devices[0]!.id,
                async ({ port, signal }: { port: MessagePort; signal?: AbortSignal }) => {
                    await prepareOfflineLevain({ deviceId: b.devices[0]!.id, port, signal, captured: bCaptured });
                    prepared.push('horn');
                },
            ],
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
        expect(prepared).toEqual(['cello', 'horn']);
        expect(requested).toEqual([
            '/samples/levain/cello/manifest.json',
            '/samples/levain/cello/sustain-c4.wav',
            '/samples/levain/horn/manifest.json',
            '/samples/levain/horn/sustain-c4.wav',
        ]);
        expect(decodedIdentities).toEqual([1, 2]);
        const begun = simulated.map(
            (node) =>
                node.sent.find((message) => (message as { type?: string }).type === 'beginSampleBank') as
                    { loadToken: number; instrumentId: string } | undefined
        );
        expect(begun.map((message) => message?.instrumentId)).toEqual(['cello', 'horn']);
        for (const [index, node] of simulated.entries()) {
            const begin = begun[index];
            expect(begin).toBeDefined();
            expect(node.received).toContainEqual({
                type: 'sampleBankUploadDecision',
                loadToken: begin?.loadToken,
                uploadRequired: true,
            });
            expect(node.sent).toContainEqual(
                expect.objectContaining({ type: 'addSample', loadToken: begin?.loadToken })
            );
            const sample = node.sent.find((message) => (message as { type?: string }).type === 'addSample') as
                { data: Float32Array; frameCount: number; channels: number; sampleRate: number } | undefined;
            expect(sample?.data.buffer).toBeInstanceOf(SharedArrayBuffer);
            expect(sample).toMatchObject({ frameCount: SAMPLE_FRAMES, channels: 1, sampleRate: SAMPLE_RATE });
            expect(node.sent).toContainEqual(expect.objectContaining({ type: 'addZone', loadToken: begin?.loadToken }));
            expect(node.received).toContainEqual({ type: 'sampleBankLoaded', loadToken: begin?.loadToken });
            expect(node.received).not.toContainEqual(expect.objectContaining({ type: 'sampleBankError' }));
            expect(node.received).not.toContainEqual(expect.objectContaining({ type: 'error' }));
        }
        vi.runOnlyPendingTimers();

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
