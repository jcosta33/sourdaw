import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    destroyWebMidi,
    initWebMidi,
    resetMidiState,
    setMidiInputTrack,
    setWebMidiRealtimeProcessor,
    setWebMidiRuntimeEventBus,
    triggerLiveNoteOff,
    triggerLiveNoteOn,
} from '#/modules/MIDI/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { applyYeastRuntimeProjection, destroyYeastRuntime } from '../../engine/yeastRuntime';
import { type YeastNotesOffPayload } from '../../events';
import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { type YeastProcessorProjectionItem } from '../../models/YeastProcessorProjection';
import { setYeastEventBus, yeastStore, type YeastProcessorInfo } from '../../stores';
import { configureYeastRuntime, hydrateYeastState, processRealtimeMidiInput, processYeastMidi } from '../../useCases';
import { MidiRack } from '../MidiRack';
import { createProcessor } from '../processorFactory';

const SAMPLE_RATE = 48_000;
const BLOCK_SAMPLES = 128;
const TRACK_ID = 'track-1';
const YEAST_ID = 'yeast-1';
const LEVAIN_ID = 'lev-1';

const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48_000, baseLatency: 0, outputLatency: 0 }));
const levain_controls = vi.hoisted(() => ({ ready: true, noteOn: vi.fn(), noteOff: vi.fn() }));
const worker_hook = vi.hoisted(() => ({
    create: undefined as ((context: BaseAudioContext) => Promise<unknown>) | undefined,
}));

vi.mock('../../engine/YeastWorkerClient', () => ({
    createYeastWorker: (context: BaseAudioContext) => {
        if (!worker_hook.create) {
            throw new Error('No Yeast worker is wired for this spec');
        }
        return worker_hook.create(context);
    },
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const strip = {
        gainNode: {},
        deviceNodes: [{ type: 'levain', deviceId: 'lev-1', levainControls: levain_controls }],
    };
    return {
        ...actual,
        audioEngine: {
            context: audio_clock,
            ensureTrackStrip: () => strip,
            getTrackStrip: () => strip,
        },
        getCompensationDelay: () => 0,
        getDefaultBendRangeSemitones: () => 48,
        getFactoryDrumKitByIndex: () => null,
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiControl: async () => true,
        sendNativeLiveMidiNote: async () => true,
        soundsNativeNotes: () => false,
    };
});

const TRANSPORT: TransportInfo = {
    isPlaying: true,
    ppqPosition: 0,
    bpm: 120,
    sampleRate: SAMPLE_RATE,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

/** The arpeggiator the Yeast device owns, as its persisted rack projects it. */
const ARPEGGIATOR_PROJECTION: YeastProcessorProjectionItem[] = [
    { id: 'arp-1', type: 'arpeggiator', bypassed: false, params: {} },
];

function device(id: string, type: string): Track['devices'][number] {
    return { id, name: type, type, bypassed: false, parameterValues: {} };
}

const YEAST_DEVICE = device(YEAST_ID, 'yeast');
const LEVAIN_DEVICE = device(LEVAIN_ID, 'levain');

function setChain(devices: Track['devices']): void {
    const track = createTrack({ id: TRACK_ID, name: 'Keys', kind: 'midi', withoutDefaultDevice: true });
    track.devices.push(...devices);
    trackStore.set({ ...defaultTrackState, tracks: [track], selectedTrackId: TRACK_ID });
}

/**
 * The live-input path over one real worker rack. Rack state lives in the
 * persisted rack of a Yeast device, which outlives the device's place in the
 * chain; the runtime applies a rack's projection before every block, a no-op
 * while it is unchanged.
 */
function createRackHarness() {
    const rack = new MidiRack();
    const persistedRacks = new Map([[YEAST_ID, ARPEGGIATOR_PROJECTION]]);
    let cursorSamples = 0;
    const deliveredRackIds: string[] = [];

    const dispose = setWebMidiRealtimeProcessor({
        processor: async (input) => {
            deliveredRackIds.push(input.rackId);
            const projection = persistedRacks.get(input.rackId);
            if (!projection) {
                return [];
            }
            rack.replaceProjection(projection, createProcessor);
            const event: MidiEvent = {
                timeSamples: input.sampleTime,
                trackId: input.trackId,
                noteInstanceId: input.noteInstanceId,
                kind: { type: 'noteOff', channel: input.channel, note: input.note },
            };
            if (input.isNoteOn) {
                event.kind = { type: 'noteOn', channel: input.channel, note: input.note, velocity: input.velocity };
            }
            const blockEnd = input.sampleTime + BLOCK_SAMPLES;
            cursorSamples = blockEnd;
            return rack.processBlock([event], input.sampleTime, blockEnd, TRANSPORT, input.trackId);
        },
    });

    /** Pitches the playing rack generates over the next `seconds` of empty blocks. */
    function play(seconds: number): number[] {
        replayProjection();
        const pitches: number[] = [];
        const endSamples = cursorSamples + seconds * SAMPLE_RATE;
        while (cursorSamples < endSamples) {
            const start = cursorSamples;
            const output = rack.processBlock(
                [],
                start,
                start + BLOCK_SAMPLES,
                { ...TRANSPORT, ppqPosition: (start / SAMPLE_RATE) * 2 },
                TRACK_ID
            );
            for (const event of output) {
                if (event.kind.type === 'noteOn') {
                    pitches.push(event.kind.note);
                }
            }
            cursorSamples = start + BLOCK_SAMPLES;
        }
        audio_clock.currentTime = cursorSamples / SAMPLE_RATE;
        return pitches;
    }

    /** What the runtime does on the first block after an undo: apply the rack's projection again. */
    function replayProjection(): void {
        rack.replaceProjection(ARPEGGIATOR_PROJECTION, createProcessor);
    }

    return { dispose, play, replayProjection, deliveredRackIds };
}

describe('a key released after its Yeast left the chain', () => {
    let harness: ReturnType<typeof createRackHarness>;

    beforeEach(() => {
        audio_clock.currentTime = 2;
        levain_controls.noteOn.mockClear();
        levain_controls.noteOff.mockClear();
        setChain([YEAST_DEVICE, LEVAIN_DEVICE]);
        setMidiInputTrack(TRACK_ID);
        harness = createRackHarness();
    });

    afterEach(() => {
        harness.dispose();
        resetMidiState();
        setMidiInputTrack(null);
        trackStore.set(defaultTrackState);
    });

    it('arpeggiates a held key, then nothing once it is released with the Yeast in the chain', async () => {
        await triggerLiveNoteOn(0, 60, 100);
        expect(new Set(harness.play(1))).toEqual(new Set([60]));

        await triggerLiveNoteOff(0, 60);

        expect(harness.play(1)).toEqual([]);
    });

    it('starts an undone removal with no held key', async () => {
        await triggerLiveNoteOn(0, 60, 100);
        expect(new Set(harness.play(1))).toEqual(new Set([60]));

        setChain([LEVAIN_DEVICE]);
        await triggerLiveNoteOff(0, 60);
        setChain([YEAST_DEVICE, LEVAIN_DEVICE]);

        expect(harness.play(1)).toEqual([]);
    });

    it('arpeggiates only the key held after the undo, and nothing once it is released', async () => {
        await triggerLiveNoteOn(0, 60, 100);
        harness.play(1);
        setChain([LEVAIN_DEVICE]);
        await triggerLiveNoteOff(0, 60);
        setChain([YEAST_DEVICE, LEVAIN_DEVICE]);
        harness.play(1);

        await triggerLiveNoteOn(0, 64, 100);
        expect(new Set(harness.play(1))).toEqual(new Set([64]));

        await triggerLiveNoteOff(0, 64);
        expect(harness.play(1)).toEqual([]);
    });

    it('delivers the key-up to the rack the key went into and sounds nothing for it', async () => {
        await triggerLiveNoteOn(0, 60, 100);
        harness.play(1);
        const noteOnsBeforeRemoval = levain_controls.noteOn.mock.calls.length;
        const rackIdsBeforeKeyUp = harness.deliveredRackIds.length;

        setChain([LEVAIN_DEVICE]);
        await triggerLiveNoteOff(0, 60);

        expect(harness.deliveredRackIds.slice(rackIdsBeforeKeyUp)).toEqual([YEAST_ID]);
        expect(levain_controls.noteOn.mock.calls).toHaveLength(noteOnsBeforeRemoval);
    });
});

const REPLACEMENT_YEAST_ID = 'yeast-c';

const ARPEGGIATOR_RACK: YeastProcessorInfo[] = [
    { id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false, params: {} },
];
const TRANSPOSER_RACK: YeastProcessorInfo[] = [
    { id: 'tr-c', type: 'transposer', name: 'Transposer', bypassed: false, params: {} },
];

/**
 * The Yeast worker holds one rack that every delivery installs. This fake
 * worker node is that rack, a real `MidiRack`, behind the node interface the
 * runtime drives, and forwards the notes a projection change settles the way
 * the worker's acknowledgement does.
 */
function createRackBackedWorker(context: BaseAudioContext) {
    const rack = new MidiRack();
    const installedProjections: string[][] = [];
    const blockEnds: number[] = [];
    const createdProcessorIds: string[] = [];
    const settledNotesOff: YeastNotesOffPayload[] = [];
    const notesOffHandlers = new Set<(notesOff: YeastNotesOffPayload[]) => void>();
    const node = {
        context,
        processBlock: (
            events: readonly MidiEvent[],
            blockStart: number,
            blockEnd: number,
            transport: TransportInfo,
            trackId: string,
            previewEnabled?: boolean,
            rackId?: string,
            routeId?: string,
            captureEpoch?: number,
            preserveInputTrackIds?: boolean
        ): Promise<MidiEvent[]> => {
            blockEnds.push(blockEnd);
            return Promise.resolve([
                ...rack.processBlock(
                    events,
                    blockStart,
                    blockEnd,
                    transport,
                    trackId,
                    previewEnabled,
                    rackId,
                    routeId,
                    captureEpoch,
                    preserveInputTrackIds
                ),
            ]);
        },
        setProjection: (projection: readonly YeastProcessorProjectionItem[]): Promise<void> => {
            installedProjections.push(projection.map((processor) => processor.id));
            const settled = rack.replaceProjection(projection, (type, id) => {
                createdProcessorIds.push(id);
                return createProcessor(type, id);
            });
            const noteOffsByTrack = new Map<string, YeastNotesOffPayload['noteOffs']>();
            for (const event of settled) {
                if (event.kind.type !== 'noteOff' || event.trackId === undefined) {
                    continue;
                }
                const noteOffs = noteOffsByTrack.get(event.trackId) ?? [];
                noteOffs.push({ channel: event.kind.channel, note: event.kind.note });
                noteOffsByTrack.set(event.trackId, noteOffs);
            }
            const payloads = Array.from(noteOffsByTrack, ([trackId, noteOffs]) => ({ trackId, noteOffs }));
            if (payloads.length > 0) {
                settledNotesOff.push(...payloads);
                for (const handler of notesOffHandlers) {
                    handler(payloads);
                }
            }
            return Promise.resolve();
        },
        sendCommand: () => Promise.resolve({ accepted: true }),
        allNotesOff: () => Promise.resolve(),
        releasePreview: () => {},
        onNotesOff: (handler: (notesOff: YeastNotesOffPayload[]) => void) => {
            notesOffHandlers.add(handler);
            return () => notesOffHandlers.delete(handler);
        },
        onPreview: () => () => {},
        onTerminalError: () => () => {},
        destroy: () => {},
    };
    return { node, installedProjections, createdProcessorIds, settledNotesOff, blockEnds };
}

function createSynchronousEventBus() {
    const handlers = new Map<string, Set<(payload: never) => void>>();
    return {
        emit: (event: string, payload: unknown): Promise<void> => {
            for (const handler of handlers.get(event) ?? []) {
                (handler as (payload: unknown) => void)(payload);
            }
            return Promise.resolve();
        },
        on: (event: string, handler: (payload: never) => void) => {
            const registered = handlers.get(event) ?? new Set();
            registered.add(handler);
            handlers.set(event, registered);
            return () => registered.delete(handler);
        },
    };
}

describe('a key released after its Yeast left the chain, through the real Yeast runtime', () => {
    let worker: ReturnType<typeof createRackBackedWorker>;
    let disposeProcessor: () => void;
    let document: Doc<Record<string, unknown>>;

    /** Pitches the worker's rack generates over the next `seconds` of empty blocks on `rackId`, after the last block it processed. */
    async function generatedPitches(rackId: string, seconds: number): Promise<number[]> {
        const pitches: number[] = [];
        let cursorSamples = worker.blockEnds.at(-1) ?? 0;
        const endSamples = cursorSamples + seconds * SAMPLE_RATE;
        while (cursorSamples < endSamples) {
            const start = cursorSamples;
            const output = await processYeastMidi({
                context: audio_clock as unknown as BaseAudioContext,
                rackId,
                trackId: TRACK_ID,
                events: [],
                blockStartSamples: start,
                blockEndSamples: start + 1024,
                transport: { ...TRANSPORT, ppqPosition: (start / SAMPLE_RATE) * 2 },
            });
            for (const event of output) {
                if (event.kind.type === 'noteOn') {
                    pitches.push(event.kind.note);
                }
            }
            cursorSamples = start + 1024;
        }
        return pitches;
    }

    function levainPitchesOn(): number[] {
        return levain_controls.noteOn.mock.calls.map((call) => call[0] as number);
    }

    function levainPitchesOff(): number[] {
        return levain_controls.noteOff.mock.calls.map((call) => call[0] as number);
    }

    beforeEach(async () => {
        audio_clock.currentTime = 2;
        levain_controls.noteOn.mockClear();
        levain_controls.noteOff.mockClear();
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
        document = from({});
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft));
            },
        });
        yeastStore.hydrate();
        setChain([YEAST_DEVICE, device(REPLACEMENT_YEAST_ID, 'yeast'), LEVAIN_DEVICE]);
        hydrateYeastState({
            racks: {
                [YEAST_ID]: { processors: ARPEGGIATOR_RACK },
                [REPLACEMENT_YEAST_ID]: { processors: TRANSPOSER_RACK },
            },
        });
        setChain([YEAST_DEVICE, LEVAIN_DEVICE]);
        setMidiInputTrack(TRACK_ID);

        worker = createRackBackedWorker(audio_clock as unknown as BaseAudioContext);
        worker_hook.create = () => Promise.resolve(worker.node);
        const bus = createSynchronousEventBus();
        setYeastEventBus(bus);
        setWebMidiRuntimeEventBus({ eventBus: bus });
        configureYeastRuntime({ panicOutputNotes: () => {} });
        await initWebMidi();
        disposeProcessor = setWebMidiRealtimeProcessor({ processor: processRealtimeMidiInput });
    });

    afterEach(() => {
        disposeProcessor();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        destroyWebMidi();
        destroyYeastRuntime();
        worker_hook.create = undefined;
        resetMidiState();
        setMidiInputTrack(null);
        trackStore.set(defaultTrackState);
        transportStore.set(defaultTransportState);
    });

    it('leaves the replacement Yeast’s held key and processor state alone when the removed Yeast’s key comes up', async () => {
        await triggerLiveNoteOn(0, 60, 100);
        setChain([device(REPLACEMENT_YEAST_ID, 'yeast'), LEVAIN_DEVICE]);
        await triggerLiveNoteOn(0, 64, 100);
        expect(levainPitchesOn()).toContain(64);
        const projectionsBeforeKeyUp = worker.installedProjections.length;

        await triggerLiveNoteOff(0, 60);

        expect(levainPitchesOff()).not.toContain(64);
        expect(worker.installedProjections.slice(projectionsBeforeKeyUp)).toEqual([]);
        expect(worker.createdProcessorIds).toEqual(['arp-1', 'tr-c']);

        await triggerLiveNoteOff(0, 64);

        expect(levainPitchesOff().filter((pitch) => pitch === 64)).toHaveLength(1);
    });

    it('delivers the key-up to the rack the worker still runs, so an undone removal replays no key', async () => {
        await triggerLiveNoteOn(0, 60, 100);
        expect(new Set(await generatedPitches(YEAST_ID, 1))).toEqual(new Set([60]));

        setChain([LEVAIN_DEVICE]);
        await triggerLiveNoteOff(0, 60);
        setChain([YEAST_DEVICE, LEVAIN_DEVICE]);

        expect(await generatedPitches(YEAST_ID, 1)).toEqual([]);
    });

    it('still releases the key when only the removed rack’s parameters changed, without settling any rack', async () => {
        await triggerLiveNoteOn(0, 60, 100);
        expect(new Set(await generatedPitches(YEAST_ID, 1))).toEqual(new Set([60]));

        setChain([LEVAIN_DEVICE]);
        hydrateYeastState({
            racks: {
                [YEAST_ID]: { processors: [{ ...ARPEGGIATOR_RACK[0]!, params: { gate: 1.2 } }] },
                [REPLACEMENT_YEAST_ID]: { processors: TRANSPOSER_RACK },
            },
        });
        await triggerLiveNoteOff(0, 60);
        setChain([YEAST_DEVICE, LEVAIN_DEVICE]);

        expect(await generatedPitches(YEAST_ID, 1)).toEqual([]);
        expect(worker.installedProjections.every((ids) => ids.join() === 'arp-1')).toBe(true);
        expect(worker.createdProcessorIds).toEqual(['arp-1']);
        expect(worker.settledNotesOff).toEqual([]);
    });

    it('withholds the removed Yeast’s key-up once a projection applied outside any transaction moved the worker to another rack', async () => {
        await triggerLiveNoteOn(0, 60, 100);
        expect(new Set(await generatedPitches(YEAST_ID, 1))).toEqual(new Set([60]));

        setChain([LEVAIN_DEVICE]);
        await applyYeastRuntimeProjection([{ id: 'tr-c', type: 'transposer', bypassed: false, params: {} }]);
        const projectionsBeforeKeyUp = worker.installedProjections.length;
        await triggerLiveNoteOff(0, 60);

        expect(worker.installedProjections.slice(projectionsBeforeKeyUp)).toEqual([]);
        expect(worker.createdProcessorIds).toEqual(['arp-1', 'tr-c']);
    });

    it('withholds the removed Yeast’s key-up once the runtime was torn down, creating no worker for it', async () => {
        let workersCreated = 0;
        worker_hook.create = () => {
            workersCreated += 1;
            return Promise.resolve(worker.node);
        };
        await triggerLiveNoteOn(0, 60, 100);
        expect(workersCreated).toBe(1);

        setChain([LEVAIN_DEVICE]);
        destroyYeastRuntime();
        const projectionsBeforeKeyUp = worker.installedProjections.length;
        await triggerLiveNoteOff(0, 60);

        expect(workersCreated).toBe(1);
        expect(worker.installedProjections.slice(projectionsBeforeKeyUp)).toEqual([]);
    });

    it('judges the removed Yeast’s key-up after the replacement’s queued install, not when it was called', async () => {
        await triggerLiveNoteOn(0, 60, 100);

        setChain([device(REPLACEMENT_YEAST_ID, 'yeast'), LEVAIN_DEVICE]);
        const replacementKeyDown = triggerLiveNoteOn(0, 64, 100);
        const removedKeyUp = triggerLiveNoteOff(0, 60);
        await Promise.all([replacementKeyDown, removedKeyUp]);

        expect(worker.installedProjections).toEqual([['arp-1'], ['tr-c']]);
        expect(levainPitchesOn()).toContain(64);
        expect(levainPitchesOff()).not.toContain(64);
    });

    it('withholds the removed Yeast’s key-up from a replacement rack with the same processor id but another type', async () => {
        setChain([YEAST_DEVICE, device(REPLACEMENT_YEAST_ID, 'yeast'), LEVAIN_DEVICE]);
        hydrateYeastState({
            racks: {
                [YEAST_ID]: { processors: ARPEGGIATOR_RACK },
                [REPLACEMENT_YEAST_ID]: {
                    processors: [{ ...TRANSPOSER_RACK[0]!, id: 'arp-1' }],
                },
            },
        });
        setChain([YEAST_DEVICE, LEVAIN_DEVICE]);

        await triggerLiveNoteOn(0, 60, 100);
        setChain([device(REPLACEMENT_YEAST_ID, 'yeast'), LEVAIN_DEVICE]);
        await triggerLiveNoteOn(0, 64, 100);
        expect(levainPitchesOn()).toContain(64);
        const projectionsBeforeKeyUp = worker.installedProjections.length;

        await triggerLiveNoteOff(0, 60);

        expect(worker.installedProjections.slice(projectionsBeforeKeyUp)).toEqual([]);
        expect(levainPitchesOff()).not.toContain(64);
    });
});
