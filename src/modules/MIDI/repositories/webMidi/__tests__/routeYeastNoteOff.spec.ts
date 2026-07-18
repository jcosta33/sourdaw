/**
 * The AudioEngine half of the hung-note fix (MAJOR-B): the offs a removed Yeast
 * processor emits via `yeast.notesOff` must actually reach the live instrument.
 * `routeYeastNoteOffsForTargetTrack` delivers each Note Off to a resolved
 * instrument track's device node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routeYeastNoteOffsForTargetTrack } from '../routeYeastNoteOff';
import { routeYeastNoteOffToInstrument } from '../routeYeastNoteOffToInstrument';

const fermenter_note_off = vi.fn<(note: number) => void>();
const grand_boule_note_off = vi.fn<(note: number, sampleFrame?: number, releaseVelocity?: number) => void>();
const levain_note_off = vi.fn<(note: number) => void>();
const get_track_strip = vi.fn();

type InstrumentStrip = NonNullable<Parameters<typeof routeYeastNoteOffToInstrument>[1]>;
type InstrumentDeviceNode = InstrumentStrip['deviceNodes'][number];
type InstrumentTrack = NonNullable<Parameters<typeof routeYeastNoteOffsForTargetTrack>[0]>;
type InstrumentDevice = InstrumentTrack['devices'][number];

type CreateInstrumentTrackInput = {
    id: string;
    devices?: readonly InstrumentDevice[];
};

function noop_emit(): void {}

function create_device(input: { id: string; type: string }): InstrumentDevice {
    return {
        id: input.id,
        type: input.type,
    };
}

function create_instrument_track(input: CreateInstrumentTrackInput): InstrumentTrack {
    return {
        id: input.id,
        devices: input.devices ?? [],
    };
}

function create_strip(input: { device_nodes: InstrumentDeviceNode[] }): InstrumentStrip {
    return {
        deviceNodes: input.device_nodes,
    };
}

type FermenterControls = NonNullable<InstrumentDeviceNode['fermenterControls']>;
type GrandBouleControls = NonNullable<InstrumentDeviceNode['grandBouleControls']>;
type LevainControls = NonNullable<InstrumentDeviceNode['levainControls']>;

function create_fermenter_controls(overrides: Partial<FermenterControls> = {}): FermenterControls {
    return { noteOff: () => {}, ...overrides };
}

function create_grand_boule_controls(overrides: Partial<GrandBouleControls> = {}): GrandBouleControls {
    return { noteOff: () => {}, ...overrides };
}

function create_levain_controls(overrides: Partial<LevainControls> = {}): LevainControls {
    return { noteOff: () => {}, ...overrides };
}

beforeEach(() => {
    fermenter_note_off.mockReset();
    grand_boule_note_off.mockReset();
    levain_note_off.mockReset();
    get_track_strip.mockReset();
});

describe('routeYeastNoteOffsForTargetTrack', () => {
    it('routes an originating track even when the selected Web MIDI target changed', () => {
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'fermenter', fermenterControls: { noteOff: fermenter_note_off } }],
        });
        const instrument_track = create_instrument_track({
            id: 'track-a',
            devices: [create_device({ id: 'ferm-a', type: 'fermenter' })],
        });

        routeYeastNoteOffsForTargetTrack(instrument_track, [{ channel: 0, note: 60 }], {
            emitGrandBouleEvent: noop_emit,
            getTrackStrip: get_track_strip,
        });

        expect(get_track_strip).toHaveBeenCalledWith('track-a');
        expect(fermenter_note_off).toHaveBeenCalledWith(60);
    });

    it('should deliver each off to the target track fermenter device node', () => {
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'fermenter', fermenterControls: { noteOff: fermenter_note_off } }],
        });
        const instrument_track = create_instrument_track({
            id: 'track-1',
            devices: [create_device({ id: 'ferm-1', type: 'fermenter' })],
        });
        routeYeastNoteOffsForTargetTrack(
            instrument_track,
            [
                { channel: 0, note: 60 },
                { channel: 0, note: 64 },
            ],
            {
                emitGrandBouleEvent: noop_emit,
                getTrackStrip: get_track_strip,
            }
        );

        expect(get_track_strip).toHaveBeenCalledTimes(1);
        expect(get_track_strip).toHaveBeenCalledWith('track-1');
        expect(fermenter_note_off.mock.calls.map((call) => call[0])).toEqual([60, 64]);
    });

    it('routes same-pitch note-offs on distinct channels exactly once each', () => {
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'fermenter', fermenterControls: { noteOff: fermenter_note_off } }],
        });
        const instrument_track = create_instrument_track({
            id: 'track-1',
            devices: [create_device({ id: 'ferm-1', type: 'fermenter' })],
        });

        routeYeastNoteOffsForTargetTrack(
            instrument_track,
            [
                { channel: 1, note: 60 },
                { channel: 2, note: 60 },
                { channel: 2, note: 60 },
            ],
            {
                emitGrandBouleEvent: noop_emit,
                getTrackStrip: get_track_strip,
            }
        );

        expect(fermenter_note_off.mock.calls.map((call) => call[0])).toEqual([60, 60]);
    });

    it('should route forced Grand Boule offs with release velocity zero', () => {
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'grand-boule', grandBouleControls: { noteOff: grand_boule_note_off } }],
        });
        const instrument_track = create_instrument_track({
            id: 'track-2',
            devices: [create_device({ id: 'gb-1', type: 'grand-boule' })],
        });
        const emit_grand_boule_event = vi.fn<(deviceId: string, midiNote: number) => void>();

        routeYeastNoteOffsForTargetTrack(instrument_track, [{ channel: 0, note: 72 }], {
            emitGrandBouleEvent: emit_grand_boule_event,
            getTrackStrip: get_track_strip,
        });

        expect(grand_boule_note_off).toHaveBeenCalledWith(72, undefined, 0);
        expect(emit_grand_boule_event).toHaveBeenCalledWith('gb-1', 72);
    });

    it('should route to a levain device when that is the track instrument', () => {
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'levain', levainControls: { noteOff: levain_note_off } }],
        });
        const instrument_track = create_instrument_track({
            id: 'track-3',
            devices: [create_device({ id: 'lev-1', type: 'levain' })],
        });

        routeYeastNoteOffsForTargetTrack(instrument_track, [{ channel: 0, note: 74 }], {
            emitGrandBouleEvent: noop_emit,
            getTrackStrip: get_track_strip,
        });

        expect(levain_note_off).toHaveBeenCalledWith(74);
    });

    it('should be a no-op when there is no target track', () => {
        routeYeastNoteOffsForTargetTrack(null, [{ channel: 0, note: 60 }], {
            emitGrandBouleEvent: noop_emit,
            getTrackStrip: get_track_strip,
        });

        expect(get_track_strip).not.toHaveBeenCalled();
        expect(fermenter_note_off).not.toHaveBeenCalled();
    });

    it('should be a no-op for an empty off list', () => {
        routeYeastNoteOffsForTargetTrack(null, [], {
            emitGrandBouleEvent: noop_emit,
            getTrackStrip: get_track_strip,
        });
        expect(get_track_strip).not.toHaveBeenCalled();
    });
});

describe('routeYeastNoteOffToInstrument', () => {
    it('should route to fermenter before lower-priority instruments', () => {
        const instrument_track = create_instrument_track({
            id: 'instrument-track',
            devices: [
                create_device({ id: 'ferm-1', type: 'fermenter' }),
                create_device({ id: 'gb-1', type: 'grand-boule' }),
                create_device({ id: 'lev-1', type: 'levain' }),
            ],
        });
        const emit_grand_boule_event = vi.fn<(deviceId: string, midiNote: number) => void>();
        const strip = create_strip({
            device_nodes: [
                { type: 'fermenter', fermenterControls: create_fermenter_controls({ noteOff: fermenter_note_off }) },
                {
                    type: 'grand-boule',
                    grandBouleControls: create_grand_boule_controls({ noteOff: grand_boule_note_off }),
                },
                { type: 'levain', levainControls: create_levain_controls({ noteOff: levain_note_off }) },
            ],
        });

        routeYeastNoteOffToInstrument(instrument_track, strip, 65, 0.5, emit_grand_boule_event);

        expect(fermenter_note_off).toHaveBeenCalledWith(65);
        expect(grand_boule_note_off).not.toHaveBeenCalled();
        expect(levain_note_off).not.toHaveBeenCalled();
        expect(emit_grand_boule_event).not.toHaveBeenCalled();
    });

    it('should still emit a Grand Boule event when the strip control is missing', () => {
        const instrument_track = create_instrument_track({
            id: 'instrument-track',
            devices: [create_device({ id: 'gb-1', type: 'grand-boule' })],
        });
        const emit_grand_boule_event = vi.fn<(deviceId: string, midiNote: number) => void>();

        routeYeastNoteOffToInstrument(
            instrument_track,
            create_strip({ device_nodes: [] }),
            67,
            0.5,
            emit_grand_boule_event
        );

        expect(grand_boule_note_off).not.toHaveBeenCalled();
        expect(emit_grand_boule_event).toHaveBeenCalledWith('gb-1', 67);
    });
});
