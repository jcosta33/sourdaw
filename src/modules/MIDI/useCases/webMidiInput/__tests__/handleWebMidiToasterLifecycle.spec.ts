import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const targetTrackId = vi.hoisted(() => ({ value: 'child-a-0' }));
const ensureTrackStrip = vi.hoisted(() => vi.fn());
const getTrackStrip = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => false,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => targetTrackId.value,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: {
            currentTime: 2,
            sampleRate: 48000,
            baseLatency: 0,
            outputLatency: 0,
        },
        ensureTrackStrip,
        getTrackStrip,
    },
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: async () => true,
}));

const { handleWebMidiNoteOn } = await import('../handleWebMidiNoteOn');
const { handleWebMidiNoteOff } = await import('../handleWebMidiNoteOff');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

/**
 * Frame a live pad hit lands on with the harness clock at 2 s / 48 kHz and no
 * event timestamp: the arrival frame plus the one-render-quantum scheduling
 * budget `resolveInputDispatchFrame` applies (audit MD-1).
 */
const LIVE_DISPATCH_FRAME = 96_128;

type NoteOnDependencies = Parameters<typeof handleWebMidiNoteOn._factory>[0];
type NoteOffDependencies = Parameters<typeof handleWebMidiNoteOff._factory>[0];

type TestTrack = {
    id: string;
    parentId: string | null;
    devices: Array<{ id: string; type: string }>;
    clips: never[];
    armed: boolean;
};

const parentA: TestTrack = {
    id: 'parent-a',
    parentId: null,
    devices: [{ id: 'toaster-a', type: 'toaster' }],
    clips: [],
    armed: false,
};
const childA0: TestTrack = {
    id: 'child-a-0',
    parentId: 'parent-a',
    devices: [],
    clips: [],
    armed: false,
};
const childA1: TestTrack = {
    id: 'child-a-1',
    parentId: 'parent-a',
    devices: [],
    clips: [],
    armed: false,
};
const parentB: TestTrack = {
    id: 'parent-b',
    parentId: null,
    devices: [{ id: 'toaster-b', type: 'toaster' }],
    clips: [],
    armed: false,
};
const childB0: TestTrack = {
    id: 'child-b-0',
    parentId: 'parent-b',
    devices: [],
    clips: [],
    armed: false,
};

const trackState = {
    value: {
        tracks: [parentA, childA0, childA1, parentB, childB0],
        selectedTrackId: 'child-a-0',
    },
};

function makeNoteOffDependencies(): NoteOffDependencies {
    return {
        getCompensationDelay: () => 0,
        getTrackStoreState: () => trackState.value,
        getTransportStoreValue: () => ({ isRecording: false }),
        playheadPositionRef: { current: 0 },
        createMidiNote: () => ({
            id: 'recorded-note',
            pitch: 60,
            startBeat: 0,
            duration: 1,
            velocity: 100,
        }),
        appendRecordedMidiNote: () => {},
        getSynthParamsForTrack: () => ({ release: 0.3 }),
        processRealtimeMidiInput: () => Promise.resolve([]),
        stepRecordNoteOff: () => {},
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
    };
}

function makeNoteOnDependencies(
    noteOff: (channel: number, note: number, velocity?: number) => Promise<void>
): NoteOnDependencies {
    return {
        getTrackStoreState: () => trackState.value,
        getTransportStoreValue: () => ({ isRecording: false }),
        playheadPositionRef: { current: 0 },
        stepRecordNoteOn: () => {},
        processRealtimeMidiInput: () => Promise.resolve([]),
        getSynthParamsForTrack: () => ({ detune: 0, release: 0.3 }),
        scheduleNote: () => null,
        scheduleKitNote: () => null,
        getDrumKitByIndex: () => null,
        getDrumKitDefByIndex: () => null,
        scheduleDrumKitNote: () => {},
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        handleWebMidiNoteOff: noteOff,
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiNote: () => Promise.resolve(true),
    };
}

function installToasterStrips() {
    const toasterANoteOn = vi.fn<(pad: number, velocity: number, note: number) => void>();
    const toasterANoteOff = vi.fn<(pad: number) => void>();
    const toasterBNoteOn = vi.fn<(pad: number, velocity: number, note: number) => void>();
    const toasterBNoteOff = vi.fn<(pad: number) => void>();
    const strips = new Map([
        [
            'parent-a',
            {
                gainNode: {},
                deviceNodes: [
                    {
                        type: 'toaster',
                        deviceId: 'toaster-a',
                        toasterControls: { noteOn: toasterANoteOn, noteOff: toasterANoteOff },
                    },
                ],
            },
        ],
        [
            'parent-b',
            {
                gainNode: {},
                deviceNodes: [
                    {
                        type: 'toaster',
                        deviceId: 'toaster-b',
                        toasterControls: { noteOn: toasterBNoteOn, noteOff: toasterBNoteOff },
                    },
                ],
            },
        ],
    ]);
    ensureTrackStrip.mockImplementation((trackId: string) => strips.get(trackId));
    getTrackStrip.mockImplementation((trackId: string) => strips.get(trackId));
    return { toasterANoteOn, toasterANoteOff, toasterBNoteOn, toasterBNoteOff };
}

describe('Web MIDI Toaster note lifecycle', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        ensureTrackStrip.mockReset();
        getTrackStrip.mockReset();
        targetTrackId.value = 'child-a-0';
        trackState.value = {
            tracks: [parentA, childA0, childA1, parentB, childB0],
            selectedTrackId: 'child-a-0',
        };
    });

    it('releases the exact resolved pad after selection changes and the source track is removed', async () => {
        const { toasterANoteOn, toasterANoteOff, toasterBNoteOff } = installToasterStrips();
        const noteOff = handleWebMidiNoteOff._factory(makeNoteOffDependencies());
        const noteOn = handleWebMidiNoteOn._factory(makeNoteOnDependencies(noteOff));

        await noteOn(1, 61, 100);

        expect(toasterANoteOn).toHaveBeenCalledWith(0, 100, 61, LIVE_DISPATCH_FRAME);
        expect(activeNotes.get(createWebMidiNoteKey(1, 61))).toEqual(
            expect.objectContaining({
                trackId: 'child-a-0',
                instrumentTrackId: 'parent-a',
                toasterRoute: { deviceId: 'toaster-a', pad: 0 },
            })
        );

        trackState.value = {
            tracks: [parentA, parentB, childB0],
            selectedTrackId: 'child-b-0',
        };
        await noteOff(1, 61);

        expect(toasterANoteOff).toHaveBeenCalledExactlyOnceWith(0);
        expect(toasterBNoteOff).not.toHaveBeenCalled();
        expect(activeNotes.size).toBe(0);
    });

    it('keeps same-pitch child-pad routes distinct across channels and parents', async () => {
        const { toasterANoteOn, toasterANoteOff, toasterBNoteOn, toasterBNoteOff } = installToasterStrips();
        const noteOff = handleWebMidiNoteOff._factory(makeNoteOffDependencies());
        const noteOn = handleWebMidiNoteOn._factory(makeNoteOnDependencies(noteOff));

        targetTrackId.value = 'child-a-1';
        await noteOn(1, 61, 90);
        targetTrackId.value = 'child-b-0';
        await noteOn(2, 61, 80);

        expect(toasterANoteOn).toHaveBeenCalledWith(1, 90, 61, LIVE_DISPATCH_FRAME);
        expect(toasterBNoteOn).toHaveBeenCalledWith(0, 80, 61, LIVE_DISPATCH_FRAME);

        trackState.value.selectedTrackId = 'child-a-0';
        await noteOff(2, 61);
        await noteOff(1, 61);

        expect(toasterANoteOff).toHaveBeenCalledExactlyOnceWith(1);
        expect(toasterBNoteOff).toHaveBeenCalledExactlyOnceWith(0);
    });

    it('settles the stored route before a same-key retrigger replaces it', async () => {
        const { toasterANoteOn, toasterANoteOff } = installToasterStrips();
        const noteOff = handleWebMidiNoteOff._factory(makeNoteOffDependencies());
        const noteOn = handleWebMidiNoteOn._factory(makeNoteOnDependencies(noteOff));

        await noteOn(4, 61, 100);
        targetTrackId.value = 'child-a-1';
        await noteOn(4, 61, 110);

        expect(toasterANoteOn.mock.calls.map(([pad]) => pad)).toEqual([0, 1]);
        expect(toasterANoteOff.mock.calls.map(([pad]) => pad)).toEqual([0]);
        expect(activeNotes.get(createWebMidiNoteKey(4, 61))).toEqual(
            expect.objectContaining({
                trackId: 'child-a-1',
                instrumentTrackId: 'parent-a',
                toasterRoute: { deviceId: 'toaster-a', pad: 1 },
            })
        );
    });
});
