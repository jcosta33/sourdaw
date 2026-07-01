/**
 * The AudioEngine half of the hung-note fix (MAJOR-B): the offs a removed Yeast
 * processor emits via `yeast.notesOff` must actually reach the live instrument.
 * `routeYeastNoteOffsForTargetTrack` resolves the target track's instrument and
 * delivers each Note Off to its device node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Device, Track, TrackStoreState } from '#/modules/Arrangement/stores';

const { fermenter_note_off, grand_boule_note_off, levain_note_off, get_track_strip, get_target_track_id } = vi.hoisted(
    () => ({
        fermenter_note_off: vi.fn<(note: number) => void>(),
        grand_boule_note_off: vi.fn<(note: number, sampleFrame?: number, releaseVelocity?: number) => void>(),
        levain_note_off: vi.fn<(note: number) => void>(),
        get_track_strip: vi.fn(),
        get_target_track_id: vi.fn<() => string | null>(),
    })
);

vi.mock('../state', () => ({
    getTargetTrackId: get_target_track_id,
}));

vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: { getTrackStrip: get_track_strip },
}));

const { resolveInstrumentTrack } = await import('../resolveInstrumentTrack');
const { routeYeastNoteOffsForTargetTrack } = await import('../routeYeastNoteOff');
const { routeYeastNoteOffToInstrument } = await import('../routeYeastNoteOffToInstrument');

type InstrumentStrip = NonNullable<Parameters<typeof routeYeastNoteOffToInstrument>[1]>;
type InstrumentDeviceNode = InstrumentStrip['deviceNodes'][number];

type CreateTrackInput = {
    id: string;
    devices?: Device[];
    parent_id?: string | null;
};

function noop_emit(): void {}

function create_device(input: { id: string; type: string }): Device {
    return {
        id: input.id,
        name: input.type,
        type: input.type,
        bypassed: false,
        parameterValues: {},
    };
}

function create_track(input: CreateTrackInput): Track {
    return {
        id: input.id,
        name: input.id,
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: input.devices ?? [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: input.parent_id ?? null,
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
    };
}

function create_track_state(input: { tracks: Track[] }): TrackStoreState {
    return {
        tracks: input.tracks,
        selectedTrackId: null,
        ghostClips: [],
    };
}

function create_strip(input: { device_nodes: InstrumentDeviceNode[] }): InstrumentStrip {
    return {
        deviceNodes: input.device_nodes,
    };
}

beforeEach(() => {
    fermenter_note_off.mockReset();
    grand_boule_note_off.mockReset();
    levain_note_off.mockReset();
    get_track_strip.mockReset();
    get_target_track_id.mockReset();
});

describe('routeYeastNoteOffsForTargetTrack', () => {
    it('should deliver each off to the target track fermenter device node', () => {
        get_target_track_id.mockReturnValue('track-1');
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'fermenter', fermenterControls: { noteOff: fermenter_note_off } }],
        });
        const track_state = create_track_state({
            tracks: [create_track({ id: 'track-1', devices: [create_device({ id: 'ferm-1', type: 'fermenter' })] })],
        });
        const get_track_store_state = vi.fn(() => track_state);

        routeYeastNoteOffsForTargetTrack([60, 64], {
            getTrackStoreState: get_track_store_state,
            emitGrandBouleEvent: noop_emit,
        });

        expect(get_track_store_state).toHaveBeenCalledTimes(1);
        expect(get_track_strip).toHaveBeenCalledTimes(1);
        expect(get_track_strip).toHaveBeenCalledWith('track-1');
        expect(fermenter_note_off.mock.calls.map((call) => call[0])).toEqual([60, 64]);
    });

    it('should route forced Grand Boule offs with release velocity zero', () => {
        get_target_track_id.mockReturnValue('track-2');
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'grand-boule', grandBouleControls: { noteOff: grand_boule_note_off } }],
        });
        const track_state = create_track_state({
            tracks: [create_track({ id: 'track-2', devices: [create_device({ id: 'gb-1', type: 'grand-boule' })] })],
        });
        const emit_grand_boule_event = vi.fn<(deviceId: string, midiNote: number) => void>();

        routeYeastNoteOffsForTargetTrack([72], {
            getTrackStoreState: () => track_state,
            emitGrandBouleEvent: emit_grand_boule_event,
        });

        expect(grand_boule_note_off).toHaveBeenCalledWith(72, undefined, 0);
        expect(emit_grand_boule_event).toHaveBeenCalledWith('gb-1', 72);
    });

    it('should route to a levain device when that is the track instrument', () => {
        get_target_track_id.mockReturnValue('track-3');
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'levain', levainControls: { noteOff: levain_note_off } }],
        });
        const track_state = create_track_state({
            tracks: [create_track({ id: 'track-3', devices: [create_device({ id: 'lev-1', type: 'levain' })] })],
        });

        routeYeastNoteOffsForTargetTrack([74], {
            getTrackStoreState: () => track_state,
            emitGrandBouleEvent: noop_emit,
        });

        expect(levain_note_off).toHaveBeenCalledWith(74);
    });

    it('should be a no-op when there is no target track', () => {
        get_target_track_id.mockReturnValue(null);

        routeYeastNoteOffsForTargetTrack([60], {
            getTrackStoreState: () => null,
            emitGrandBouleEvent: noop_emit,
        });

        expect(get_track_strip).not.toHaveBeenCalled();
        expect(fermenter_note_off).not.toHaveBeenCalled();
    });

    it('should be a no-op for an empty off list', () => {
        get_target_track_id.mockReturnValue('track-1');
        routeYeastNoteOffsForTargetTrack([], {
            getTrackStoreState: () => create_track_state({ tracks: [] }),
            emitGrandBouleEvent: noop_emit,
        });
        expect(get_track_strip).not.toHaveBeenCalled();
    });
});

describe('resolveInstrumentTrack', () => {
    it('should resolve a child target to its toaster parent instrument track', () => {
        get_target_track_id.mockReturnValue('child-track');
        const parent_track = create_track({
            id: 'parent-track',
            devices: [create_device({ id: 'toaster-1', type: 'toaster' })],
        });
        const child_track = create_track({ id: 'child-track', parent_id: 'parent-track' });

        const result = resolveInstrumentTrack(create_track_state({ tracks: [parent_track, child_track] }));

        expect(result).toBe(parent_track);
    });

    it('should resolve the target track when the parent is not a toaster host', () => {
        get_target_track_id.mockReturnValue('child-track');
        const parent_track = create_track({ id: 'parent-track' });
        const child_track = create_track({ id: 'child-track', parent_id: 'parent-track' });

        const result = resolveInstrumentTrack(create_track_state({ tracks: [parent_track, child_track] }));

        expect(result).toBe(child_track);
    });
});

describe('routeYeastNoteOffToInstrument', () => {
    it('should route to fermenter before lower-priority instruments', () => {
        const instrument_track = create_track({
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
                { type: 'fermenter', fermenterControls: { noteOff: fermenter_note_off } },
                { type: 'grand-boule', grandBouleControls: { noteOff: grand_boule_note_off } },
                { type: 'levain', levainControls: { noteOff: levain_note_off } },
            ],
        });

        routeYeastNoteOffToInstrument(instrument_track, strip, 65, 0.5, emit_grand_boule_event);

        expect(fermenter_note_off).toHaveBeenCalledWith(65);
        expect(grand_boule_note_off).not.toHaveBeenCalled();
        expect(levain_note_off).not.toHaveBeenCalled();
        expect(emit_grand_boule_event).not.toHaveBeenCalled();
    });

    it('should be a no-op when the Grand Boule strip control is missing', () => {
        const instrument_track = create_track({
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
        expect(emit_grand_boule_event).not.toHaveBeenCalled();
    });
});
