import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Device, markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    addClip,
    createTrack,
    getArrangementHandlers,
    getAutomationParameterRange,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    productionBriefAdmissionPort,
    redo,
    undo,
} from '#/modules/Command/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { productionBriefActionBatchAdmission } from '#/modules/Project/useCases';
import { timeSignatureMapStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { FADER_MAX_GAIN, dbToGain } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { createAutomationLane, type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';
import { automateParameterRange } from '../automateParameterRange';
import { addAutomationPoint } from '../automation/addAutomationPoint';
import { setAutomationParameterRangeResolver } from '../automation/automationParameterRangeDependencies';
import { getAutomationValueAtBeat } from '../automation/getAutomationValueAtBeat';
import { getAutomationHandlers } from '../getAutomationHandlers';

const notificationMocks = vi.hoisted(() => ({ notifyUser: vi.fn<(message: string, level?: string) => void>() }));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notificationMocks.notifyUser }));

type RangePayload = Extract<AppAction, { type: 'automateParameterRange' }>['payload'];

const VOCAL_ID = 'track-lead-vocal';
const BUS_ID = 'track-reverb-bus';
const KEYS_ID = 'track-keys';
const DRIVE_TARGET = 'device-drive:dist-drive';
const GAIN_LANE_ID = 'lane-vocal-gain';

const DRIVE: Device = {
    id: 'device-drive',
    name: 'Distortion',
    type: 'builtin-distortion',
    bypassed: false,
    parameterValues: { 'dist-drive': 20 },
};

/** Verse, Chorus, Bridge, Chorus, Outro: two sections share the name "Chorus". */
const SECTIONS = [
    { id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 16, color: '#000000' },
    { id: 'section-chorus-one', name: 'Chorus', startBeat: 16, endBeat: 32, color: '#000000' },
    { id: 'section-bridge', name: 'Bridge', startBeat: 32, endBeat: 48, color: '#000000' },
    { id: 'section-chorus-two', name: 'Chorus', startBeat: 48, endBeat: 64, color: '#000000' },
    { id: 'section-outro', name: 'Outro', startBeat: 64, endBeat: 80, color: '#000000' },
];

/** A marker halfway into the verse: the range it opens runs to the first chorus, the next section start. */
const MARKERS = [{ id: 'marker-pickup', name: 'Pickup', beat: 8, color: '#000000' }];

/** A gain lane whose second chorus opens inside a step and closes inside a line. */
const GAIN_POINTS: AutomationPoint[] = [
    { id: 'gain-a', beat: 0, value: 0.5, curve: 'linear', tension: 0 },
    { id: 'gain-b', beat: 40, value: 1, curve: 'step', tension: 0 },
    { id: 'gain-c', beat: 56, value: 0.7, curve: 'linear', tension: 0 },
    { id: 'gain-d', beat: 72, value: 0.9, curve: 'linear', tension: 0 },
];

let documentState: Record<string, unknown> = {};

function vocalTrack(overrides: Partial<Track> = {}): Track {
    return {
        ...createTrack({ id: VOCAL_ID, name: 'Lead Vocal', kind: 'audio', withoutDefaultDevice: true }),
        gain: 1,
        pan: 10,
        devices: [DRIVE],
        sends: [{ busId: BUS_ID, level: 0.5, preFader: false }],
        ...overrides,
    };
}

function seed(input: { vocal?: Partial<Track>; lanes?: AutomationLane[] } = {}): void {
    trackStore.set({
        tracks: [vocalTrack(input.vocal), createTrack({ id: BUS_ID, name: 'Reverb Bus', kind: 'bus' })],
        selectedTrackId: null,
    });
    markerStore.set({ markers: structuredClone(MARKERS), sections: structuredClone(SECTIONS) });
    automationStore.set({ lanes: input.lanes ?? [] });
    flushAutomergeStorageWrites();
}

function gainLane(points: AutomationPoint[] = GAIN_POINTS, overrides: Partial<AutomationLane> = {}): AutomationLane {
    return {
        ...createAutomationLane(VOCAL_ID, 'gain', 'Gain', 0, FADER_MAX_GAIN),
        id: GAIN_LANE_ID,
        points: structuredClone(points),
        ...overrides,
    };
}

function rangeAction(payload: Omit<RangePayload, 'trackId'> & { trackId?: string }): AppAction {
    return { type: 'automateParameterRange', payload: { trackId: VOCAL_ID, ...payload } };
}

function laneFor(parameterId: string): AutomationLane | undefined {
    return automationStore.value?.lanes.find((lane) => lane.trackId === VOCAL_ID && lane.parameterId === parameterId);
}

function pointShapes(lane: AutomationLane | undefined): Pick<AutomationPoint, 'beat' | 'value' | 'curve'>[] {
    return (lane?.points ?? []).map(({ beat, value, curve }) => ({ beat, value, curve }));
}

/** Every quarter beat in `[from, to]`. */
function quarterBeats(from: number, to: number): number[] {
    const beats: number[] = [];
    for (let beat = from; beat <= to; beat += 0.25) {
        beats.push(beat);
    }
    return beats;
}

function sampleLane(laneId: string, beats: readonly number[]): (number | null)[] {
    return beats.map((beat) => getAutomationValueAtBeat(laneId, beat));
}

function expectSameSamples(actual: readonly (number | null)[], expected: readonly (number | null)[]): void {
    expect(actual).toHaveLength(expected.length);
    for (const [index, value] of expected.entries()) {
        expect(actual[index]).toBeCloseTo(value ?? Number.NaN, 12);
    }
}

function lanesSnapshot(): string {
    return JSON.stringify(automationStore.value?.lanes ?? []);
}

describe('automateParameterRange', () => {
    beforeEach(() => {
        documentState = {};
        configureAutomergeStoragePort({
            getDoc: () => documentState,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(documentState);
            },
        });
        notificationMocks.notifyUser.mockClear();
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        setAutomationParameterRangeResolver(getAutomationParameterRange);
        timeSignatureMapStore.set({ changes: [] });
        projectStore.set(structuredClone(defaultProjectStoreState));
        seed();
    });

    afterEach(() => {
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        setAutomationParameterRangeResolver(null);
        clearUndoHistory();
        clearHandlerRegistry();
        automationStore.set({ lanes: [] });
        markerStore.set({ markers: [], sections: [] });
        trackStore.set({ tracks: [], selectedTrackId: null });
        timeSignatureMapStore.set({ changes: [] });
        configureAutomergeStoragePort(null);
    });

    it('(a) dips gain 6 dB across the second chorus with ramps and leaves every beat outside it unchanged', async () => {
        seed({ lanes: [gainLane()] });
        const outsideBeats = [...quarterBeats(0, 47.75), ...quarterBeats(64.25, 96)];
        const outsideBefore = sampleLane(GAIN_LANE_ID, outsideBeats);

        await executeAppAction(
            rangeAction({ parameterId: 'gain', range: { section: 'chorus 2' }, deltaDb: -6, rampIn: 1, rampOut: 2 })
        );

        // The step from beat 40 holds 1.0 at the start; the line from 56 to 72 reads 0.8 at the end.
        const target = dbToGain(-6);
        expect(pointShapes(laneFor('gain'))).toEqual([
            { beat: 0, value: 0.5, curve: 'linear' },
            { beat: 40, value: 1, curve: 'step' },
            { beat: 48, value: 1, curve: 'linear' },
            { beat: 49, value: target, curve: 'linear' },
            { beat: 62, value: target, curve: 'linear' },
            { beat: 64, value: 0.8, curve: 'linear' },
            { beat: 72, value: 0.9, curve: 'linear' },
        ]);
        expect(getAutomationValueAtBeat(GAIN_LANE_ID, 48)).toBe(1);
        expect(getAutomationValueAtBeat(GAIN_LANE_ID, 48.5)).toBeCloseTo((1 + target) / 2, 12);
        expectSameSamples(
            sampleLane(GAIN_LANE_ID, quarterBeats(49, 62)),
            quarterBeats(49, 62).map(() => target)
        );
        expect(getAutomationValueAtBeat(GAIN_LANE_ID, 63)).toBeCloseTo((target + 0.8) / 2, 12);
        expectSameSamples(sampleLane(GAIN_LANE_ID, outsideBeats), outsideBefore);
    });

    it('(r) admits the +6 dB fader ceiling as a decibel target on a lane bounded at the fader maximum', async () => {
        // #4964: the lane law derived its ceiling by round-tripping FADER_MAX_GAIN through
        // gainToDb, which reads 5.999999999999998 and refused the top of the fader's own travel.
        seed({ lanes: [gainLane([])] });

        await executeAppAction(rangeAction({ parameterId: 'gain', range: { section: 'Verse' }, valueDb: 6 }));

        expect(pointShapes(laneFor('gain'))).toEqual([
            { beat: 0, value: 1, curve: 'linear' },
            { beat: 0, value: FADER_MAX_GAIN, curve: 'linear' },
            { beat: 16, value: FADER_MAX_GAIN, curve: 'linear' },
            { beat: 16, value: 1, curve: 'linear' },
        ]);
    });

    it('(b) places a pan range on the bars of a 4/4 to 7/8 meter change', async () => {
        // Bars 1–2 are 4/4 (4 beats); from beat 8 the 7/8 bars are 3.5 beats: bar 3 opens at 8, bar 5 at 15.
        timeSignatureMapStore.set({ changes: [{ id: 'seven-eight', beat: 8, numerator: 7, denominator: 8 }] });

        await executeAppAction(rangeAction({ parameterId: 'pan', range: { startBar: 3, endBar: 4 }, value: -0.5 }));

        // The track pans at +10 of 50, so the lane holds 0.2 outside the bars it moves to -0.5.
        expect(pointShapes(laneFor('pan'))).toEqual([
            { beat: 8, value: 0.2, curve: 'linear' },
            { beat: 8, value: -0.5, curve: 'linear' },
            { beat: 15, value: -0.5, curve: 'linear' },
            { beat: 15, value: 0.2, curve: 'linear' },
        ]);
        const panLaneId = laneFor('pan')?.id ?? '';
        expect(sampleLane(panLaneId, [7.75, 8, 14.75, 15, 16])).toEqual([0.2, -0.5, -0.5, 0.2, 0.2]);
    });

    it('(i) writes over the range a marker opens, up to the next section start', async () => {
        await executeAppAction(rangeAction({ parameterId: 'pan', range: { section: 'Pickup' }, value: 0.5 }));

        expect(pointShapes(laneFor('pan'))).toEqual([
            { beat: 8, value: 0.2, curve: 'linear' },
            { beat: 8, value: 0.5, curve: 'linear' },
            { beat: 16, value: 0.5, curve: 'linear' },
            { beat: 16, value: 0.2, curve: 'linear' },
        ]);
    });

    it('(l) opens on the value a linear segment draws at the range start, so the beats before it are unchanged', async () => {
        seed({
            lanes: [
                gainLane([
                    { id: 'line-a', beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                    { id: 'line-b', beat: 16, value: 1, curve: 'linear', tension: 0 },
                ]),
            ],
        });
        const beforeStart = quarterBeats(0, 7.75);
        const samplesBefore = sampleLane(GAIN_LANE_ID, beforeStart);

        await executeAppAction(rangeAction({ parameterId: 'gain', range: { startBeat: 8, endBeat: 12 }, value: 0.5 }));

        expectSameSamples(sampleLane(GAIN_LANE_ID, beforeStart), samplesBefore);
    });

    it.each([
        { name: 'a lane it rewrote', lanes: () => [gainLane()] },
        { name: 'a lane it created', lanes: () => [] },
    ])('(j) undoes a write whose ramps meet inside a bar, on $name', async ({ lanes }) => {
        seed({ lanes: lanes() });
        const before = lanesSnapshot();

        // 0 + 0.3 is 0.3, but 4 - 3.7 is 0.2999999999999998: the two ramps meet at one beat.
        await executeAppAction(
            rangeAction({
                parameterId: 'gain',
                range: { startBar: 1, endBar: 1 },
                value: 0.5,
                rampIn: 0.3,
                rampOut: 3.7,
            })
        );
        expect(lanesSnapshot()).not.toBe(before);

        await undo();
        expect(lanesSnapshot()).toBe(before);
    });

    it('(k) undoes every write whose ramps fill an integer-beat range, wherever the two ramps meet', async () => {
        let exercised = 0;
        for (const length of [1, 2, 3, 4]) {
            for (const startBeat of [0, 1, 2]) {
                for (let tenths = 0; tenths <= length * 10; tenths += 1) {
                    const rampIn = tenths / 10;
                    const rampOut = length - rampIn;
                    if (rampIn + rampOut > length) {
                        continue;
                    }
                    const range = { startBeat, endBeat: startBeat + length };
                    await executeAppAction(rangeAction({ parameterId: 'pan', range, value: 0, rampIn, rampOut }));
                    expect(laneFor('pan')).toBeDefined();

                    await undo();
                    expect(automationStore.value?.lanes).toEqual([]);
                    exercised += 1;
                }
            }
        }
        expect(exercised).toBeGreaterThan(100);
    });

    it('(c) writes a device parameter in its own units', async () => {
        await executeAppAction(
            rangeAction({ parameterId: DRIVE_TARGET, range: { startBeat: 4, endBeat: 8 }, value: 60, rampIn: 1 })
        );

        const lane = laneFor(DRIVE_TARGET);
        expect(lane).toMatchObject({ parameterName: 'Distortion → dist-drive', minValue: 0, maxValue: 100 });
        expect(pointShapes(lane)).toEqual([
            { beat: 4, value: 20, curve: 'linear' },
            { beat: 5, value: 60, curve: 'linear' },
            { beat: 8, value: 60, curve: 'linear' },
            { beat: 8, value: 20, curve: 'linear' },
        ]);
    });

    it('(d) writes a send level in decibels on its send lane and refuses a send the track does not have', async () => {
        await executeAppAction(
            rangeAction({
                parameterId: `send:${BUS_ID}`,
                range: { section: 'Bridge' },
                valueDb: -12,
                rampIn: 2,
                rampOut: 2,
            })
        );

        const level = dbToGain(-12);
        expect(laneFor(`send:${BUS_ID}`)).toMatchObject({
            parameterName: 'Send: Reverb Bus',
            minValue: 0,
            maxValue: 1,
        });
        expect(pointShapes(laneFor(`send:${BUS_ID}`))).toEqual([
            { beat: 32, value: 0.5, curve: 'linear' },
            { beat: 34, value: level, curve: 'linear' },
            { beat: 46, value: level, curve: 'linear' },
            { beat: 48, value: 0.5, curve: 'linear' },
        ]);

        const before = lanesSnapshot();
        await expect(
            executeAppAction(
                rangeAction({ parameterId: 'send:track-missing-bus', range: { section: 'Bridge' }, valueDb: -12 })
            )
        ).rejects.toThrow('has no send to bus track-missing-bus');
        expect(lanesSnapshot()).toBe(before);
        expect(
            automateParameterRange({
                payload: {
                    trackId: VOCAL_ID,
                    parameterId: 'send:track-missing-bus',
                    range: { section: 'Bridge' },
                    valueDb: -12,
                },
                writeId: 'write-no-send',
            })
        ).toMatchObject({ status: 'refused', refusal: 'no-send' });
    });

    describe('(e) refuses, writing nothing', () => {
        const refusals: {
            name: string;
            setup: () => void;
            payload: Omit<RangePayload, 'trackId'>;
            refusal: string;
        }[] = [
            {
                name: 'a track whose automation is off',
                setup: () => seed({ vocal: { automationMode: 'off' }, lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, valueDb: -6 },
                refusal: 'automation-off',
            },
            {
                name: 'a linked follower lane, without redirecting to its source',
                setup: () =>
                    seed({
                        lanes: [
                            gainLane(GAIN_POINTS, { linkedLaneId: 'lane-source' }),
                            { ...gainLane(), id: 'lane-source', trackId: 'track-other' },
                        ],
                    }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, valueDb: -6 },
                refusal: 'linked-follower',
            },
            {
                name: 'ramps longer than the range',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, valueDb: -6, rampIn: 10, rampOut: 7 },
                refusal: 'ramps-exceed-range',
            },
            {
                name: 'a boundary inside an exponential segment',
                setup: () =>
                    seed({
                        lanes: [
                            gainLane([
                                { id: 'curve-a', beat: 8, value: 0.4, curve: 'exponential', tension: 0.5 },
                                { id: 'curve-b', beat: 24, value: 1, curve: 'linear', tension: 0 },
                            ]),
                        ],
                    }),
                payload: { parameterId: 'gain', range: { startBeat: 12, endBeat: 30 }, valueDb: -6 },
                refusal: 'nonlinear-boundary',
            },
            {
                name: 'a level above the fader ceiling',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, valueDb: 12 },
                refusal: 'outside-law',
            },
            {
                name: 'a level a hair above the fader ceiling',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, valueDb: 6.01 },
                refusal: 'outside-law',
            },
            {
                name: 'a pan value outside the lane',
                setup: () => seed(),
                payload: { parameterId: 'pan', range: { section: 'Verse' }, value: 2 },
                refusal: 'outside-law',
            },
            {
                name: 'decibels on a pan lane',
                setup: () => seed(),
                payload: { parameterId: 'pan', range: { section: 'Verse' }, valueDb: -3 },
                refusal: 'invalid-target',
            },
            {
                name: 'an unknown parameter',
                setup: () => seed(),
                payload: { parameterId: 'device-missing:dist-drive', range: { section: 'Verse' }, value: 1 },
                refusal: 'unknown-parameter',
            },
            {
                name: 'a parameter no curve may drive',
                setup: () => seed(),
                payload: { parameterId: 'device-drive:not-a-parameter', range: { section: 'Verse' }, value: 1 },
                refusal: 'not-automatable',
            },
            {
                name: 'an ambiguous section',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Chorus' }, valueDb: -6 },
                refusal: 'ambiguous-section',
            },
            {
                name: 'an unknown section',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Drop' }, valueDb: -6 },
                refusal: 'unknown-section',
            },
            {
                name: 'a reversed bar range',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { startBar: 6, endBar: 4 }, valueDb: -6 },
                refusal: 'invalid-range',
            },
            {
                // A silent fader is minus infinity decibels, which no lane point can hold.
                name: 'a silent track whose decibel gain lane holds no points',
                setup: () => seed({ vocal: { gain: 0 }, lanes: [gainLane([], { minValue: -60, maxValue: 6 })] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, value: -12 },
                refusal: 'no-parameter-value',
            },
            {
                // 1e-5 is -100 dB, below the lane's -60 dB floor: the lane would clamp the points
                // carrying it, and every beat outside the range would rise by 40 dB.
                name: 'a near-silent track whose decibel gain lane holds no points',
                setup: () => seed({ vocal: { gain: 1e-5 }, lanes: [gainLane([], { minValue: -60, maxValue: 6 })] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, value: -12 },
                refusal: 'no-parameter-value',
            },
            {
                name: 'a range end inside an exponential segment',
                setup: () =>
                    seed({
                        lanes: [
                            gainLane([
                                { id: 'curve-a', beat: 0, value: 0.5, curve: 'linear', tension: 0 },
                                { id: 'curve-b', beat: 8, value: 0.4, curve: 'exponential', tension: 0.5 },
                                { id: 'curve-c', beat: 24, value: 1, curve: 'linear', tension: 0 },
                            ]),
                        ],
                    }),
                payload: { parameterId: 'gain', range: { startBeat: 2, endBeat: 12 }, valueDb: -6 },
                refusal: 'nonlinear-boundary',
            },
            {
                // The smooth segment from beat 0 bends toward the value at beat 16, which the range
                // start at beat 8 would replace with the line's own value there.
                name: 'a boundary beside a smooth segment that reads the value it replaces',
                setup: () =>
                    seed({
                        lanes: [
                            gainLane([
                                { id: 'smooth-a', beat: 0, value: 0.2, curve: 'smooth', tension: 0 },
                                { id: 'smooth-b', beat: 4, value: 0.6, curve: 'linear', tension: 0 },
                                { id: 'smooth-c', beat: 16, value: 1, curve: 'linear', tension: 0 },
                            ]),
                        ],
                    }),
                payload: { parameterId: 'gain', range: { startBeat: 8, endBeat: 12 }, value: 0.5 },
                refusal: 'nonlinear-boundary',
            },
            {
                name: 'a negative ramp',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, valueDb: -6, rampIn: -1 },
                refusal: 'invalid-range',
            },
            {
                name: 'a ramp that is not a number',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, valueDb: -6, rampOut: Number.NaN },
                refusal: 'invalid-range',
            },
            {
                // A decibel lane is stated in its own units, as addAutomationPoint requires.
                name: 'decibels on a gain lane that already holds decibels',
                setup: () =>
                    seed({
                        lanes: [
                            gainLane([{ id: 'db-a', beat: 0, value: -6, curve: 'linear', tension: 0 }], {
                                minValue: -60,
                                maxValue: 6,
                            }),
                        ],
                    }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, valueDb: -12 },
                refusal: 'invalid-target',
            },
            {
                name: 'no target',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' } },
                refusal: 'invalid-target',
            },
            {
                name: 'two targets',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { section: 'Verse' }, value: 0.5, valueDb: -6 },
                refusal: 'invalid-target',
            },
            {
                name: 'an empty beat range',
                setup: () => seed({ lanes: [gainLane()] }),
                payload: { parameterId: 'gain', range: { startBeat: 8, endBeat: 8 }, valueDb: -6 },
                refusal: 'invalid-range',
            },
        ];

        it.each(refusals)('$name', async ({ setup, payload, refusal }) => {
            setup();
            const before = lanesSnapshot();

            expect(
                automateParameterRange({ payload: { trackId: VOCAL_ID, ...payload }, writeId: 'write-refused' })
            ).toMatchObject({ status: 'refused', refusal });
            expect(lanesSnapshot()).toBe(before);

            await expect(executeAppAction(rangeAction(payload))).rejects.toThrow(
                'Action conflicts with current project state: automateParameterRange'
            );
            expect(lanesSnapshot()).toBe(before);
            expect(undoStore.value?.past ?? []).toHaveLength(0);
        });
    });

    it('(f) is refused by the production-brief guard when the resolved range overlaps a locked range', async () => {
        productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);
        const project = structuredClone(defaultProjectStoreState);
        projectStore.set({
            ...project,
            productionBrief: {
                ...project.productionBrief,
                locks: [
                    {
                        id: 'lock-chorus-two-hit',
                        scope: { kind: 'range', startBeat: 50, endBeat: 52 },
                        statement: 'Keep the second chorus downbeat as recorded',
                        createdAt: 1,
                    },
                ],
            },
        });
        seed({ lanes: [gainLane()] });
        const before = lanesSnapshot();

        // Only the materialized beats 48–64 reach the lock: the request names the section, not beats.
        await expect(
            executeAppAction(rangeAction({ parameterId: 'gain', range: { section: 'the second chorus' }, deltaDb: -6 }))
        ).rejects.toThrow('Action conflicts with current project state: automateParameterRange');
        expect(lanesSnapshot()).toBe(before);

        await executeAppAction(rangeAction({ parameterId: 'gain', range: { section: 'Verse' }, deltaDb: -6 }));
        expect(lanesSnapshot()).not.toBe(before);
    });

    it('(g) undoes to the exact lane it rewrote, and redo writes the same points again', async () => {
        seed({ lanes: [gainLane()] });
        const before = laneFor('gain');

        await executeAppAction(
            rangeAction({ parameterId: 'gain', range: { section: 'chorus 2' }, deltaDb: -6, rampIn: 1, rampOut: 2 })
        );
        const written = laneFor('gain');
        expect(written).not.toEqual(before);
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();
        expect(laneFor('gain')).toEqual(before);

        await redo();
        expect(laneFor('gain')).toEqual(written);

        await undo();
        expect(laneFor('gain')).toEqual(before);
    });

    it('(h) creates the lane when the track has none, and undo removes it with its points', async () => {
        await executeAppAction(
            rangeAction({ parameterId: 'gain', range: { section: 'Bridge' }, valueDb: -3, rampIn: 1, rampOut: 1 })
        );
        const created = laneFor('gain');
        expect(created?.points).toHaveLength(4);
        expect(automationStore.value?.lanes).toHaveLength(1);

        await undo();
        expect(automationStore.value?.lanes).toEqual([]);

        await redo();
        expect(laneFor('gain')).toEqual(created);
    });

    it.each([
        { name: 'a lane it rewrote', lanes: [gainLane()] },
        { name: 'a lane it created', lanes: [] },
    ])('refuses to undo over a point someone else added to $name, keeping both edits', async ({ lanes }) => {
        seed({ lanes });
        await executeAppAction(rangeAction({ parameterId: 'gain', range: { section: 'Bridge' }, valueDb: -3 }));
        const laneId = laneFor('gain')?.id ?? '';
        addAutomationPoint(laneId, { id: 'collaborator-point', beat: 40, value: 0.6, curve: 'linear', tension: 0 });
        flushAutomergeStorageWrites();
        const edited = laneFor('gain');

        await undo();

        expect(laneFor('gain')).toEqual(edited);
        expect(notificationMocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Cannot undo'), 'warning');
    });

    it('refuses a batch whose earlier member changes the lane this range is measured against', async () => {
        seed({ lanes: [gainLane()] });
        const before = lanesSnapshot();

        await expect(
            executeAppActionBatch([
                { type: 'addAutomationPoint', payload: { laneId: GAIN_LANE_ID, beat: 8, value: 0.3 } },
                rangeAction({ parameterId: 'gain', range: { section: 'Verse' }, valueDb: -6 }),
            ])
        ).resolves.toMatchObject({
            status: 'conflicted',
            reason: expect.stringContaining(
                'changes what the gain range on track track-lead-vocal is measured against'
            ),
        });
        expect(lanesSnapshot()).toBe(before);
    });

    it.each([
        { name: 'the arrangement already ends at beat 40', vocalClipEnd: 40 },
        { name: 'the arrangement holds no clip yet', vocalClipEnd: null },
    ])(
        '(m) refuses a marker range that runs to the arrangement end after an earlier clip in its batch, when $name',
        async ({ vocalClipEnd }) => {
            registerHandlerMap(getArrangementHandlers());
            const seededTracks = trackStore.value?.tracks ?? [];
            trackStore.set({
                tracks: [
                    ...seededTracks,
                    createTrack({ id: KEYS_ID, name: 'Keys', kind: 'audio', withoutDefaultDevice: true }),
                ],
                selectedTrackId: null,
            });
            if (vocalClipEnd !== null) {
                addClip({
                    id: 'clip-vocal',
                    trackId: VOCAL_ID,
                    startBeat: 0,
                    endBeat: vocalClipEnd,
                    name: 'Vocal',
                    type: 'audio',
                });
            }
            // "Tail" has no marker or section after it, so its range ends where the last clip does.
            markerStore.set({
                markers: [{ id: 'marker-tail', name: 'Tail', beat: 20, color: '#000000' }],
                sections: [],
            });
            flushAutomergeStorageWrites();
            const before = lanesSnapshot();

            await expect(
                executeAppActionBatch([
                    {
                        type: 'addClip',
                        payload: { trackId: KEYS_ID, startBeat: 60, endBeat: 100, name: 'Keys', type: 'audio' },
                    },
                    rangeAction({ parameterId: 'pan', range: { section: 'Tail' }, value: 0.5 }),
                ])
            ).resolves.toMatchObject({
                status: 'conflicted',
                reason: expect.stringContaining('can move the beats the pan range is resolved to'),
            });
            expect(lanesSnapshot()).toBe(before);
            expect(trackStore.value?.tracks.find((track) => track.id === KEYS_ID)?.clips).toEqual([]);
        }
    );

    it('(o) admits an earlier clip before a marker range a later marker closes, and writes up to that marker', async () => {
        registerHandlerMap(getArrangementHandlers());
        addKeysTrack();
        addClip({ id: 'clip-vocal', trackId: VOCAL_ID, startBeat: 0, endBeat: 60, name: 'Vocal', type: 'audio' });
        // "Last" runs to the arrangement end, but "Tail" ends where "Last" starts.
        markerStore.set({
            markers: [
                { id: 'marker-tail', name: 'Tail', beat: 20, color: '#000000' },
                { id: 'marker-last', name: 'Last', beat: 30, color: '#000000' },
            ],
            sections: [],
        });
        flushAutomergeStorageWrites();

        await expect(
            executeAppActionBatch([
                keysClipAction(),
                rangeAction({ parameterId: 'pan', range: { section: 'Tail' }, value: 0.5 }),
            ])
        ).resolves.toMatchObject({ status: 'committed' });
        expect(pointShapes(laneFor('pan'))).toEqual([
            { beat: 20, value: 0.2, curve: 'linear' },
            { beat: 20, value: 0.5, curve: 'linear' },
            { beat: 30, value: 0.5, curve: 'linear' },
            { beat: 30, value: 0.2, curve: 'linear' },
        ]);
    });

    it('(n) ramps from the value the first point holds when the range opens before it', async () => {
        seed({
            lanes: [
                gainLane([
                    { id: 'late-a', beat: 16, value: 0.5, curve: 'linear', tension: 0 },
                    { id: 'late-b', beat: 32, value: 1, curve: 'linear', tension: 0 },
                ]),
            ],
        });

        // The track fader is at 1; the lane holds 0.5 before its first point, and that is what plays.
        await executeAppAction(rangeAction({ parameterId: 'gain', range: { startBeat: 4, endBeat: 8 }, deltaDb: -6 }));

        expect(getAutomationValueAtBeat(GAIN_LANE_ID, 6)).toBeCloseTo(0.5 * dbToGain(-6), 12);
    });

    it('(p) drops beats a caller states and resolves the named range itself, refusing a name the project lacks', async () => {
        seed({ lanes: [gainLane()] });
        const before = lanesSnapshot();

        await expect(
            executeAppAction(
                rangeAction({ parameterId: 'gain', range: { section: 'Drop' }, startBeat: 0, endBeat: 8, valueDb: -6 })
            )
        ).rejects.toThrow('Action conflicts with current project state: automateParameterRange');
        expect(lanesSnapshot()).toBe(before);
    });

    describe('(q) earlier members of the batch that can move what the range is read against', () => {
        const panOverVerse = rangeAction({ parameterId: 'pan', range: { section: 'Verse' }, value: 0.5 });

        function expectRefused(reason: string) {
            return expect.objectContaining({ status: 'conflicted', reason: expect.stringContaining(reason) });
        }

        it('refuses a bar range after a meter change', async () => {
            registerHandlerMap(getTransportHandlers());

            await expect(
                executeAppActionBatch([
                    { type: 'setTimeSignature', payload: { numerator: 3, denominator: 4 } },
                    rangeAction({ parameterId: 'pan', range: { startBar: 1, endBar: 2 }, value: 0.5 }),
                ])
            ).resolves.toEqual(expectRefused('can move the beats the pan range is resolved to'));
            expect(laneFor('pan')).toBeUndefined();
        });

        it('refuses a section range after a member that adds a section', () => {
            // Every action that moves a section or marker executes as a singleton batch, so no
            // batch can carry one ahead of a range today; the handler's own refusal is read
            // directly, against the batch context it would be validated in.
            const addSection: AppAction = {
                type: 'addSection',
                payload: { startBeat: 80, endBeat: 96, name: 'Coda' },
            };
            const range: Extract<AppAction, { type: 'automateParameterRange' }> = {
                type: 'automateParameterRange',
                payload: { trackId: VOCAL_ID, parameterId: 'pan', range: { section: 'Verse' }, value: 0.5 },
            };
            const handler = getAutomationHandlers().automateParameterRange;

            expect(
                handler.validationRefusalReason?.(range, { actions: [addSection, range], actionIndex: 1 })
            ).toContain('An earlier addSection in this batch can move the beats the pan range is resolved to');
        });

        it('refuses a section range after a member whose effect Command does not declare', async () => {
            const busLane: AutomationLane = {
                ...createAutomationLane(BUS_ID, 'gain', 'Gain', 0, FADER_MAX_GAIN),
                id: 'lane-bus-gain',
            };
            seed({ lanes: [busLane] });

            await expect(
                executeAppActionBatch([
                    { type: 'removeAutomationLane', payload: { laneId: 'lane-bus-gain' } },
                    panOverVerse,
                ])
            ).resolves.toEqual(expectRefused('can move the beats the pan range is resolved to'));
            expect(laneFor('pan')).toBeUndefined();
        });

        it('admits a section range after a new track, which moves no section, marker or clip', async () => {
            registerHandlerMap(getArrangementHandlers());

            await expect(
                executeAppActionBatch([{ type: 'addTrack', payload: { name: 'Pad', kind: 'audio' } }, panOverVerse])
            ).resolves.toMatchObject({ status: expect.stringMatching(/^committed/) });
            expect(laneFor('pan')).toBeDefined();
        });
    });
});

function addKeysTrack(): void {
    const seededTracks = trackStore.value?.tracks ?? [];
    trackStore.set({
        tracks: [
            ...seededTracks,
            createTrack({ id: KEYS_ID, name: 'Keys', kind: 'audio', withoutDefaultDevice: true }),
        ],
        selectedTrackId: null,
    });
}

function keysClipAction(): AppAction {
    return { type: 'addClip', payload: { trackId: KEYS_ID, startBeat: 60, endBeat: 100, name: 'Keys', type: 'audio' } };
}
