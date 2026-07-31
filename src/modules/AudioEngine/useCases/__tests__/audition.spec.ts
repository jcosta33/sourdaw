import { describe, it, expect, vi, beforeEach } from 'vitest';

import { registerFaustDSP } from '#/modules/PluginHost/useCases';
import {
    scheduleDrumKitNote as scheduleDrumKitNoteReal,
    getDrumKitDefByIndex as getDrumKitDefByIndexReal,
} from '#/modules/Synth/useCases';

import { playAuditionNote } from '../audition';
import { startFaustNote as startFaustNoteReal } from '../faustScheduler/startFaustNote';

const scheduleDrumKitNote = vi.mocked(scheduleDrumKitNoteReal);
const getDrumKitDefByIndex = vi.mocked(getDrumKitDefByIndexReal);
const startFaustNote = vi.mocked(startFaustNoteReal);

/**
 * Registered through the real `registerFaustDSP` so the `isInstrument` flag under
 * test is the one production records, not a stubbed lookup.
 */
const PASSTHROUGH_DSP = 'process = _,_;';
const FAUST_INSTRUMENT_TYPE = registerFaustDSP('Osc', PASSTHROUGH_DSP, [], true).id;
const FAUST_EFFECT_TYPE = registerFaustDSP('Audition Fixture Reverb', PASSTHROUGH_DSP, [], false).id;

type MockToasterControls = {
    ready: boolean;
    noteOn: (pad: number, velocity: number, pitch: number) => void;
    noteOff: (pad: number) => void;
};

type MockDeviceNode = {
    deviceId: string;
    type: string;
    toasterControls?: MockToasterControls;
    fermenterControls?: { ready: boolean; noteOn: (p: number, v: number) => void; noteOff: (p: number) => void };
    grandBouleControls?: { ready: boolean; noteOn: (p: number, v: number) => void; noteOff: (p: number) => void };
    levainControls?: { ready: boolean; noteOn: (p: number, v: number) => void; noteOff: (p: number) => void };
};

type MockTrackStrip = {
    gainNode: AudioNode;
    deviceNodes: MockDeviceNode[];
};

const { mocks } = vi.hoisted(() => {
    const cancelScheduledValues = vi.fn();
    const setTargetAtTime = vi.fn();
    const stop = vi.fn();
    const audioContext = { currentTime: 0 };
    const synthParams = { release: 0.3 };
    const defaultTrackStrip: MockTrackStrip = {
        gainNode: {} as AudioNode,
        deviceNodes: [],
    };
    const trackStrips = new Map<string, MockTrackStrip>();
    const ensureTrackStrip = vi.fn((trackId: string) => trackStrips.get(trackId) ?? defaultTrackStrip);

    const trackStoreValue: unknown = null;

    return {
        mocks: {
            trackStoreValue,
            audioContext,
            synthParams,
            defaultTrackStrip,
            trackStrips,
            ensureTrackStrip,
            cancelScheduledValues,
            setTargetAtTime,
            stop,
            getSynthParamsFromDevices: vi.fn(() => synthParams),
            // scheduleNote always attaches the amplitude-envelope GainNode as
            // `_env` (see the built-in synth scheduler). The audition note-off applies the
            // exponential smooth release through it.
            scheduleNote: vi.fn(
                () =>
                    ({
                        stop,
                        _env: { gain: { cancelScheduledValues, setTargetAtTime } },
                    }) as unknown as OscillatorNode & { _env: GainNode }
            ),
        },
    };
});

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        ensureTrackStrip: mocks.ensureTrackStrip,
        context: mocks.audioContext,
    },
}));

vi.mock('#/modules/Synth/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/useCases')>();
    return {
        ...actual,
        getDrumKitDefByIndex: vi.fn(() => null),
        scheduleDrumKitNote: vi.fn(),
        scheduleNote: mocks.scheduleNote,
        getSynthParamsFromDevices: mocks.getSynthParamsFromDevices,
    };
});

vi.mock('../faustScheduler/startFaustNote', () => ({
    startFaustNote: vi.fn(() => () => {}),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            get value() {
                return mocks.trackStoreValue;
            },
        },
    };
});

describe('playAuditionNote', () => {
    beforeEach(() => {
        mocks.trackStoreValue = null;
        mocks.trackStrips.clear();
        mocks.ensureTrackStrip.mockClear();
        mocks.cancelScheduledValues.mockClear();
        mocks.setTargetAtTime.mockClear();
        mocks.stop.mockClear();
        mocks.scheduleNote.mockClear();
        mocks.getSynthParamsFromDevices.mockClear();
    });

    it('falls back to scheduled note when track is missing', () => {
        mocks.trackStoreValue = null;
        playAuditionNote('track-a', 60, 100);
        expect(mocks.scheduleNote).toHaveBeenCalledWith(
            mocks.audioContext,
            mocks.defaultTrackStrip.gainNode,
            60,
            0,
            60,
            100,
            mocks.synthParams
        );
    });

    it('uses track devices to derive synth params when track exists', () => {
        const trackDevices = [
            {
                id: 'synth-device',
                type: 'builtin-poly-synth',
                parameterValues: { attack: 0.1, release: 0.2 },
            },
        ];
        mocks.trackStoreValue = {
            tracks: [{ id: 'track-a', devices: trackDevices, parentId: null }],
        };
        playAuditionNote('track-a', 60, 100);
        expect(mocks.getSynthParamsFromDevices).toHaveBeenCalledWith(trackDevices);
    });

    it('applies the exponential smooth release through _env on note-off (not a hard stop)', () => {
        // Regression: scheduleNote now attaches _env, so the note-off must run
        // the smooth release (cancel + setTargetAtTime) before stopping the
        // oscillator. Before the fix _env was never set and this branch was dead.
        mocks.trackStoreValue = null;
        const stopNote = playAuditionNote('track-a', 60, 100);
        stopNote();

        expect(mocks.cancelScheduledValues).toHaveBeenCalledTimes(1);
        expect(mocks.setTargetAtTime).toHaveBeenCalledTimes(1);
        // setTargetAtTime(target=0, startTime, timeConstant=release/3)
        expect(mocks.setTargetAtTime).toHaveBeenCalledWith(0, expect.any(Number), 0.3 / 3);
        // The oscillator still stops after the release tail.
        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });

    it('maps a parent toaster audition pitch to the expected pad and releases it', () => {
        const toasterNoteOn = vi.fn();
        const toasterNoteOff = vi.fn();
        mocks.trackStrips.set('parent-track', {
            gainNode: {} as AudioNode,
            deviceNodes: [
                {
                    deviceId: 'toaster-device',
                    type: 'toaster',
                    toasterControls: {
                        ready: true,
                        noteOn: toasterNoteOn,
                        noteOff: toasterNoteOff,
                    },
                },
            ],
        });
        mocks.trackStoreValue = {
            tracks: [
                {
                    id: 'parent-track',
                    devices: [{ id: 'toaster-device', type: 'toaster', parameterValues: {} }],
                    parentId: null,
                },
            ],
        };

        const stopNote = playAuditionNote('parent-track', 43, 91);

        expect(toasterNoteOn).toHaveBeenCalledWith(7, 91, 43);
        stopNote();
        expect(toasterNoteOff).toHaveBeenCalledWith(7);
    });

    it('uses the parent toaster strip and matched device when auditioning a child track', () => {
        const decoyNoteOn = vi.fn();
        const toasterNoteOn = vi.fn();
        const toasterNoteOff = vi.fn();
        mocks.trackStrips.set('child-b', {
            gainNode: {} as AudioNode,
            deviceNodes: [],
        });
        mocks.trackStrips.set('parent-track', {
            gainNode: {} as AudioNode,
            deviceNodes: [
                {
                    deviceId: 'other-device',
                    type: 'toaster',
                    toasterControls: {
                        ready: true,
                        noteOn: decoyNoteOn,
                        noteOff: vi.fn(),
                    },
                },
                {
                    deviceId: 'toaster-device',
                    type: 'plugin-wrapper',
                    toasterControls: {
                        ready: true,
                        noteOn: toasterNoteOn,
                        noteOff: toasterNoteOff,
                    },
                },
            ],
        });
        mocks.trackStoreValue = {
            tracks: [
                {
                    id: 'parent-track',
                    devices: [{ id: 'toaster-device', type: 'toaster', parameterValues: {} }],
                    parentId: null,
                },
                {
                    id: 'child-a',
                    devices: [],
                    parentId: 'parent-track',
                },
                {
                    id: 'child-b',
                    devices: [],
                    parentId: 'parent-track',
                },
            ],
        };

        const stopNote = playAuditionNote('child-b', 48, 64);

        expect(mocks.ensureTrackStrip).toHaveBeenNthCalledWith(1, 'child-b');
        expect(mocks.ensureTrackStrip).toHaveBeenNthCalledWith(2, 'parent-track');
        expect(decoyNoteOn).not.toHaveBeenCalled();
        expect(toasterNoteOn).toHaveBeenCalledWith(1, 64, 48);
        stopNote();
        expect(toasterNoteOff).toHaveBeenCalledWith(1);
    });
});

describe('playAuditionNote device dispatch', () => {
    function setTrack(track: unknown): void {
        mocks.trackStoreValue = track;
    }

    function setStrip(trackId: string, deviceNodes: MockDeviceNode[]): void {
        mocks.trackStrips.set(trackId, { gainNode: {} as AudioNode, deviceNodes });
    }

    beforeEach(() => {
        mocks.trackStoreValue = null;
        mocks.trackStrips.clear();
        mocks.ensureTrackStrip.mockClear();
        mocks.scheduleNote.mockClear();
        mocks.getSynthParamsFromDevices.mockClear();
        scheduleDrumKitNote.mockClear();
        getDrumKitDefByIndex.mockReset();
        startFaustNote.mockClear();
    });

    it.each([
        ['builtin-drum-kit', 2],
        ['drum-kit', 3],
        ['builtin-drum-machine-808', 4],
    ] as const)('dispatches a %s device to the drum-kit scheduler using kit index', (type, kitIndex) => {
        const kitDef = { name: 'kit' };
        getDrumKitDefByIndex.mockReturnValueOnce(kitDef as never);
        setTrack({
            tracks: [{ id: 'tk', devices: [{ id: 'd', type, parameterValues: { kit: kitIndex } }], parentId: null }],
        });

        playAuditionNote('tk', 38, 90);

        expect(getDrumKitDefByIndex).toHaveBeenCalledWith(kitIndex);
        expect(scheduleDrumKitNote).toHaveBeenCalledWith(
            mocks.audioContext,
            mocks.defaultTrackStrip.gainNode,
            kitDef,
            38,
            expect.any(Number),
            90
        );
    });

    it('drum-kit falls back to kitId when kit is absent, and no-ops when the kit def is missing', () => {
        // kit absent → uses kitId (5).
        setTrack({
            tracks: [
                { id: 'tk', devices: [{ id: 'd', type: 'drum-kit', parameterValues: { kitId: 5 } }], parentId: null },
            ],
        });
        getDrumKitDefByIndex.mockReturnValueOnce(null);
        playAuditionNote('tk', 38, 90);
        expect(getDrumKitDefByIndex).toHaveBeenCalledWith(5);
        expect(scheduleDrumKitNote).not.toHaveBeenCalled();
    });

    it('fermenter device: triggers noteOn when ready and noteOff on release', () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        setStrip('tk', [
            { deviceId: 'fermenter-d', type: 'fermenter', fermenterControls: { ready: true, noteOn, noteOff } },
        ]);
        setTrack({
            tracks: [
                { id: 'tk', devices: [{ id: 'fermenter-d', type: 'fermenter', parameterValues: {} }], parentId: null },
            ],
        });
        const stop = playAuditionNote('tk', 64, 110);
        expect(noteOn).toHaveBeenCalledWith(64, 110);
        stop();
        expect(noteOff).toHaveBeenCalledWith(64);
    });

    it('fermenter device: no-ops when controls not ready', () => {
        setStrip('tk', [
            {
                deviceId: 'fermenter-d',
                type: 'fermenter',
                fermenterControls: { ready: false, noteOn: vi.fn(), noteOff: vi.fn() },
            },
        ]);
        setTrack({
            tracks: [
                { id: 'tk', devices: [{ id: 'fermenter-d', type: 'fermenter', parameterValues: {} }], parentId: null },
            ],
        });
        const stop = playAuditionNote('tk', 64, 110);
        expect(() => stop()).not.toThrow();
        expect(mocks.scheduleNote).not.toHaveBeenCalled();
    });

    it('grand-boule device: triggers noteOn with normalized velocity (0..1) and noteOff on release', () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        setStrip('tk', [
            { deviceId: 'gb-d', type: 'grand-boule', grandBouleControls: { ready: true, noteOn, noteOff } },
        ]);
        setTrack({
            tracks: [{ id: 'tk', devices: [{ id: 'gb-d', type: 'grand-boule', parameterValues: {} }], parentId: null }],
        });
        const stop = playAuditionNote('tk', 60, 127);
        expect(noteOn).toHaveBeenCalledWith(60, 1); // 127/127
        stop();
        expect(noteOff).toHaveBeenCalledWith(60);
    });

    it('grand-boule device: no-ops when controls not ready (does not trigger noteOn)', () => {
        const noteOn = vi.fn();
        setStrip('tk', [
            { deviceId: 'gb-d', type: 'grand-boule', grandBouleControls: { ready: false, noteOn, noteOff: vi.fn() } },
        ]);
        setTrack({
            tracks: [{ id: 'tk', devices: [{ id: 'gb-d', type: 'grand-boule', parameterValues: {} }], parentId: null }],
        });
        playAuditionNote('tk', 60, 127);
        // Not ready → noteOn never called (the ready guard skips the trigger).
        expect(noteOn).not.toHaveBeenCalled();
    });

    it('levain device: triggers noteOn and noteOff on release', () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        setStrip('tk', [{ deviceId: 'lev-d', type: 'levain', levainControls: { ready: true, noteOn, noteOff } }]);
        setTrack({
            tracks: [{ id: 'tk', devices: [{ id: 'lev-d', type: 'levain', parameterValues: {} }], parentId: null }],
        });
        const stop = playAuditionNote('tk', 55, 80);
        expect(noteOn).toHaveBeenCalledWith(55, 80);
        stop();
        expect(noteOff).toHaveBeenCalledWith(55);
    });

    it('faust instrument: delegates to startFaustNote', () => {
        setTrack({
            tracks: [
                {
                    id: 'tk',
                    devices: [{ id: 'faust-d', type: FAUST_INSTRUMENT_TYPE, parameterValues: {} }],
                    parentId: null,
                },
            ],
        });
        playAuditionNote('tk', 60, 100);
        expect(startFaustNote).toHaveBeenCalledWith('tk', 'faust-d', 60, 100, expect.any(Number));
    });

    /**
     * Same selector defect as the live scheduler: every Faust module carries the
     * `faust-` prefix, so matching it auditioned notes into the first Faust
     * *effect* on the track. `startFaustNote` writes freq/gain/gate params a
     * reverb does not have, so the preview was silent — and the guard is an early
     * `return`, so the builtin-synth fallback below never ran.
     */
    it('faust effect: does not take the audition note, and the builtin synth voices it', () => {
        setTrack({
            tracks: [
                {
                    id: 'tk',
                    devices: [{ id: 'faust-fx', type: FAUST_EFFECT_TYPE, parameterValues: {} }],
                    parentId: null,
                },
            ],
        });
        playAuditionNote('tk', 60, 100);
        expect(startFaustNote).not.toHaveBeenCalled();
        expect(mocks.scheduleNote).toHaveBeenCalledTimes(1);
        // Pitch 60 at velocity 100 — the fallback voices the audition, it does
        // not merely get reached.
        expect(mocks.scheduleNote).toHaveBeenCalledWith(
            mocks.audioContext,
            mocks.defaultTrackStrip.gainNode,
            60,
            0,
            60,
            100,
            mocks.synthParams
        );
    });

    it('toaster device: no-ops when controls not ready', () => {
        setStrip('tk', [
            {
                deviceId: 'toaster-d',
                type: 'toaster',
                toasterControls: { ready: false, noteOn: vi.fn(), noteOff: vi.fn() },
            },
        ]);
        setTrack({
            tracks: [
                { id: 'tk', devices: [{ id: 'toaster-d', type: 'toaster', parameterValues: {} }], parentId: null },
            ],
        });
        playAuditionNote('tk', 43, 100);
        expect(mocks.scheduleNote).not.toHaveBeenCalled();
    });

    // ── kit default and device-node-by-type fallbacks (wiring assertions) ──────

    it('drum-kit defaults to kit index 0 when neither kit nor kitId is set', () => {
        const kitDef = { name: 'default-kit' };
        getDrumKitDefByIndex.mockReturnValueOnce(kitDef as never);
        setTrack({
            tracks: [{ id: 'tk', devices: [{ id: 'd', type: 'drum-kit', parameterValues: {} }], parentId: null }],
        });
        playAuditionNote('tk', 38, 90);
        // Both kit and kitId absent ⇒ `?? 0` default.
        expect(getDrumKitDefByIndex).toHaveBeenCalledWith(0);
    });

    it('fermenter device node is resolved by type when no node matches the device id', () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        // The device-node entry has a different id but type 'fermenter' ⇒ the
        // `|| data.type === 'fermenter'` arm resolves it.
        setStrip('tk', [
            { deviceId: 'mismatch', type: 'fermenter', fermenterControls: { ready: true, noteOn, noteOff } },
        ]);
        setTrack({
            tracks: [
                { id: 'tk', devices: [{ id: 'fermenter-d', type: 'fermenter', parameterValues: {} }], parentId: null },
            ],
        });
        const stop = playAuditionNote('tk', 64, 110);
        expect(noteOn).toHaveBeenCalledWith(64, 110);
        stop();
        expect(noteOff).toHaveBeenCalledWith(64);
    });

    it('toaster device node falls back to a type match when the exact device id is absent', () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        // exactDeviceNode (by id) is undefined; the `?? parentStrip...find(type)` arm
        // resolves the node carrying toasterControls.
        setStrip('tk', [{ deviceId: 'unrelated', type: 'toaster', toasterControls: { ready: true, noteOn, noteOff } }]);
        setTrack({
            tracks: [
                { id: 'tk', devices: [{ id: 'toaster-d', type: 'toaster', parameterValues: {} }], parentId: null },
            ],
        });
        const stop = playAuditionNote('tk', 40, 88);
        // pitch 40 - 36 = pad 4.
        expect(noteOn).toHaveBeenCalledWith(4, 88, 40);
        stop();
        expect(noteOff).toHaveBeenCalledWith(4);
    });

    it('grand-boule device node is resolved by type when no node matches the device id', () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        setStrip('tk', [
            { deviceId: 'mismatch', type: 'grand-boule', grandBouleControls: { ready: true, noteOn, noteOff } },
        ]);
        setTrack({
            tracks: [{ id: 'tk', devices: [{ id: 'gb-d', type: 'grand-boule', parameterValues: {} }], parentId: null }],
        });
        const stop = playAuditionNote('tk', 60, 127);
        expect(noteOn).toHaveBeenCalledWith(60, 1);
        stop();
        expect(noteOff).toHaveBeenCalledWith(60);
    });

    it('levain device node is resolved by type and triggers noteOn when no node matches the device id', () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        setStrip('tk', [{ deviceId: 'mismatch', type: 'levain', levainControls: { ready: true, noteOn, noteOff } }]);
        setTrack({
            tracks: [{ id: 'tk', devices: [{ id: 'lev-d', type: 'levain', parameterValues: {} }], parentId: null }],
        });
        const stop = playAuditionNote('tk', 55, 80);
        expect(noteOn).toHaveBeenCalledWith(55, 80);
        stop();
        expect(noteOff).toHaveBeenCalledWith(55);
    });
});
