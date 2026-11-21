import { describe, expect, it, vi } from 'vitest';

import { routeYeastNoteOffsForTargetTrack } from '../routeYeastNoteOff';
import {
    routeYeastNoteOffToInstrument,
    type WebMidiInstrumentTrack,
    type WebMidiNoteReceiver,
} from '../routeYeastNoteOffToInstrument';

const TRACK_ID = 'track-1';

function createControls() {
    return {
        fermenter: vi.fn(),
        levain: vi.fn(),
        crumbs: vi.fn(),
        grandBoule: vi.fn(),
    };
}

function createStrip(controls: ReturnType<typeof createControls>) {
    return {
        deviceNodes: [
            { deviceId: 'fermenter-1', type: 'fermenter', fermenterControls: { noteOff: controls.fermenter } },
            { deviceId: 'levain-1', type: 'levain', levainControls: { noteOff: controls.levain } },
            { deviceId: 'crumbs-1', type: 'builtin-crumbs', crumbsControls: { noteOff: controls.crumbs } },
            { deviceId: 'boule-1', type: 'grand-boule', grandBouleControls: { noteOff: controls.grandBoule } },
        ],
    };
}

const FERMENTER: WebMidiNoteReceiver = { id: 'fermenter-1', type: 'fermenter', controlsKey: 'fermenterControls' };
const LEVAIN: WebMidiNoteReceiver = { id: 'levain-1', type: 'levain', controlsKey: 'levainControls' };
const CRUMBS: WebMidiNoteReceiver = { id: 'crumbs-1', type: 'builtin-crumbs', controlsKey: 'crumbsControls' };
const GRAND_BOULE: WebMidiNoteReceiver = { id: 'boule-1', type: 'grand-boule', controlsKey: 'grandBouleControls' };

function releasePanicNote(receiver: WebMidiNoteReceiver | null) {
    const controls = createControls();
    const emitGrandBouleEvent = vi.fn();
    routeYeastNoteOffsForTargetTrack({ id: TRACK_ID, receiver }, [{ channel: 0, note: 60 }], {
        emitGrandBouleEvent,
        getTrackStrip: () => createStrip(controls),
    });
    return { controls, emitGrandBouleEvent };
}

function releaseNote(receiver: WebMidiNoteReceiver, sampleFrame?: number) {
    const controls = createControls();
    const emitGrandBouleEvent = vi.fn();
    const track: WebMidiInstrumentTrack = { id: TRACK_ID, receiver };
    routeYeastNoteOffToInstrument(track, createStrip(controls), 60, 0.5, emitGrandBouleEvent, sampleFrame);
    return { controls, emitGrandBouleEvent };
}

describe('routeYeastNoteOffsForTargetTrack', () => {
    it('releases the Crumbs voice of a track whose receiver is Crumbs', () => {
        const { controls, emitGrandBouleEvent } = releasePanicNote(CRUMBS);

        expect(controls.crumbs).toHaveBeenCalledExactlyOnceWith(60);
        expect(emitGrandBouleEvent).not.toHaveBeenCalled();
    });

    it('releases only the receiver, leaving the other instruments on the strip alone', () => {
        const { controls, emitGrandBouleEvent } = releasePanicNote(LEVAIN);

        expect(controls.levain).toHaveBeenCalledExactlyOnceWith(60);
        expect(controls.fermenter).not.toHaveBeenCalled();
        expect(emitGrandBouleEvent).not.toHaveBeenCalled();
    });

    it('releases a Grand Boule receiver with a zero release velocity and emits its event', () => {
        const { controls, emitGrandBouleEvent } = releasePanicNote(GRAND_BOULE);

        expect(controls.grandBoule).toHaveBeenCalledExactlyOnceWith(60, undefined, 0);
        expect(emitGrandBouleEvent).toHaveBeenCalledExactlyOnceWith('boule-1', 60);
    });

    it('emits the Grand Boule event even when the strip holds no Grand Boule node', () => {
        const emitGrandBouleEvent = vi.fn();
        routeYeastNoteOffsForTargetTrack({ id: TRACK_ID, receiver: GRAND_BOULE }, [{ channel: 0, note: 60 }], {
            emitGrandBouleEvent,
            getTrackStrip: () => undefined,
        });

        expect(emitGrandBouleEvent).toHaveBeenCalledExactlyOnceWith('boule-1', 60);
    });

    it('releases nothing on a track with no receiving worklet instrument', () => {
        const { controls, emitGrandBouleEvent } = releasePanicNote(null);

        expect(controls.fermenter).not.toHaveBeenCalled();
        expect(controls.levain).not.toHaveBeenCalled();
        expect(controls.crumbs).not.toHaveBeenCalled();
        expect(controls.grandBoule).not.toHaveBeenCalled();
        expect(emitGrandBouleEvent).not.toHaveBeenCalled();
    });
});

describe('routeYeastNoteOffToInstrument', () => {
    it.each([
        ['fermenter', FERMENTER],
        ['levain', LEVAIN],
        ['crumbs', CRUMBS],
    ] as const)('releases %s without a sample frame', (key, receiver) => {
        const { controls, emitGrandBouleEvent } = releaseNote(receiver);

        expect(controls[key]).toHaveBeenCalledExactlyOnceWith(60);
        expect(emitGrandBouleEvent).not.toHaveBeenCalled();
    });

    it.each([
        ['fermenter', FERMENTER],
        ['levain', LEVAIN],
        ['crumbs', CRUMBS],
    ] as const)('releases %s at a sample frame', (key, receiver) => {
        const { controls, emitGrandBouleEvent } = releaseNote(receiver, 4096);

        expect(controls[key]).toHaveBeenCalledExactlyOnceWith(60, 4096);
        expect(emitGrandBouleEvent).not.toHaveBeenCalled();
    });

    it('passes the release velocity and sample frame to Grand Boule', () => {
        const { controls, emitGrandBouleEvent } = releaseNote(GRAND_BOULE, 4096);

        expect(controls.grandBoule).toHaveBeenCalledExactlyOnceWith(60, 4096, 0.5);
        expect(emitGrandBouleEvent).toHaveBeenCalledExactlyOnceWith('boule-1', 60);
    });
});
