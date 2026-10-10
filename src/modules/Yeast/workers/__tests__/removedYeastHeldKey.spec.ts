import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    resetMidiState,
    setMidiInputTrack,
    setWebMidiRealtimeProcessor,
    triggerLiveNoteOff,
    triggerLiveNoteOn,
} from '#/modules/MIDI/useCases';

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { type YeastProcessorProjectionItem } from '../../models/YeastProcessorProjection';
import { MidiRack } from '../MidiRack';
import { createProcessor } from '../processorFactory';

const SAMPLE_RATE = 48_000;
const BLOCK_SAMPLES = 128;
const TRACK_ID = 'track-1';
const YEAST_ID = 'yeast-1';
const LEVAIN_ID = 'lev-1';

const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48_000, baseLatency: 0, outputLatency: 0 }));
const levain_controls = vi.hoisted(() => ({ ready: true, noteOn: vi.fn(), noteOff: vi.fn() }));

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
