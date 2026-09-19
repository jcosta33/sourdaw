import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane, getAutomationHandlers } from '#/modules/Automation/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { dbToGain, gainToDb } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { macroStore } from '../../stores/macroStore';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';
import { undo } from '../undo';

const engineMocks = vi.hoisted(() => ({
    engineRemoveSend: vi.fn(),
    engineSetSend: vi.fn(),
    engineSetTrackGain: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: engineMocks.engineSetTrackGain,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: engineMocks.getAllSidechainRoutes,
    removeSend: engineMocks.engineRemoveSend,
    setSend: engineMocks.engineSetSend,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const TRACK_ID = 'track-1';
const BUS_ID = 'bus-1';
const CLIP_ID = 'clip-1';
const LANE_ID = 'lane-gain';
const PAN_LANE_ID = 'lane-pan';

function trackGain(): number | undefined {
    return trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.gain;
}

function clipGain(): number | undefined {
    return trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips[0]?.gain;
}

function sendLevel(): number | undefined {
    return trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.sends.find((send) => send.busId === BUS_ID)
        ?.level;
}

function lanePointValues(laneId: string): number[] {
    return (automationStore.value?.lanes.find((lane) => lane.id === laneId)?.points ?? []).map((point) => point.value);
}

/** The refusal a dispatch answered with, or `null` when it wrote. */
async function refusalOf(action: AppAction): Promise<string | null> {
    try {
        await executeAppAction(action);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

/** A minimal clip for these fixtures; only its gain matters here. */
function fixtureClip(id: string, trackId: string, gain: number): Clip {
    return {
        id,
        trackId,
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'buffer-1',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
}

function seedProject({ trackGain: gain = 0.8, withSend = true }: { trackGain?: number; withSend?: boolean } = {}) {
    const track = {
        ...createTrack({ id: TRACK_ID, name: 'Track', kind: 'audio' }),
        gain,
        clips: [fixtureClip(CLIP_ID, TRACK_ID, 0.5)],
        sends: withSend ? [{ busId: BUS_ID, level: 0.5, preFader: false }] : [],
    };
    const bus = createTrack({ id: BUS_ID, name: 'Bus', kind: 'bus' });
    trackStore.set({ tracks: [track, bus], selectedTrackId: TRACK_ID, ghostClips: [] });
}

describe('decibel arguments on level-bearing commands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setNotificationEventBus(createEventBus<NotificationEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('decibel command arguments');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getTransportHandlers());
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        seedProject();
        transportStore.set({ ...defaultTransportState, masterGain: 80 });
        const gainLane = { ...createAutomationLane(TRACK_ID, 'gain', 'Gain', 0, 1), id: LANE_ID };
        const panLane = { ...createAutomationLane(TRACK_ID, 'pan', 'Pan', -1, 1), id: PAN_LANE_ID };
        automationStore.set({
            lanes: [
                { ...gainLane, points: [{ id: 'point-0', beat: 0, value: 0.5, curve: 'linear', tension: 0 }] },
                { ...panLane, points: [] },
            ],
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    // The fader sits at 0.8 (≈ -1.9 dB), so an absolute request and a relative
    // one of the same size land on different amplitudes.
    it.each([
        { label: 'absolute unity', payload: { gainDb: 0 }, expected: 1 },
        { label: 'absolute -6 dB', payload: { gainDb: -6 }, expected: 0.501187 },
        { label: 'relative -6 dB', payload: { deltaDb: -6 }, expected: 0.40095 },
        { label: 'relative +6 dB', payload: { deltaDb: 6 }, expected: 1.59621 },
        { label: 'linear passthrough', payload: { gain: 0.5 }, expected: 0.5 },
    ])('setTrackGain writes $label as a linear amplitude', async ({ payload, expected }) => {
        await executeAppAction({ type: 'setTrackGain', payload: { trackId: TRACK_ID, expectedGain: 0.8, ...payload } });

        expect(trackGain()).toBeCloseTo(expected, 5);
    });

    it('setTrackGain refuses a request above the fader ceiling and leaves the fader alone', async () => {
        const refusal = await refusalOf({
            type: 'setTrackGain',
            payload: { trackId: TRACK_ID, expectedGain: 0.8, gainDb: 12 },
        });

        expect(refusal).toContain("above this control's ceiling of 6.0 dB");
        expect(trackGain()).toBe(0.8);
    });

    it('setTrackGain refuses two level forms at once', async () => {
        const refusal = await refusalOf({
            type: 'setTrackGain',
            payload: { trackId: TRACK_ID, expectedGain: 0.8, gain: 0.5, gainDb: 0 },
        });

        expect(refusal).toContain('exactly once');
        expect(trackGain()).toBe(0.8);
    });

    it('setTrackGain refuses both decibel forms at once', async () => {
        const refusal = await refusalOf({
            type: 'setTrackGain',
            payload: { trackId: TRACK_ID, expectedGain: 0.8, gainDb: 0, deltaDb: -2 },
        });

        expect(refusal).toContain('exactly once');
        expect(trackGain()).toBe(0.8);
    });

    it('setTrackGain refuses a relative request against a silent fader', async () => {
        seedProject({ trackGain: 0 });

        const refusal = await refusalOf({
            type: 'setTrackGain',
            payload: { trackId: TRACK_ID, expectedGain: 0, deltaDb: 6 },
        });

        expect(refusal).toContain('silent');
        expect(trackGain()).toBe(0);
    });

    it('setTrackGain undoes a compounding batch back to the pre-batch gain', async () => {
        // The fader starts at 0.8; the second action's `deltaDb` must measure from
        // what the first one left it at (-6 dB, 0.501187), landing at 0.251189, not
        // from the live pre-batch 0.8 — the describe fix this pin guards.
        const groupId = 'track-gain-group';
        const result = await executeAppActionBatch(
            [
                { type: 'setTrackGain', payload: { trackId: TRACK_ID, expectedGain: 0.8, gainDb: -6 } },
                { type: 'setTrackGain', payload: { trackId: TRACK_ID, expectedGain: dbToGain(-6), deltaDb: -6 } },
            ],
            { groupId }
        );

        expect(result.status).toBe('committed');
        expect(trackGain()).toBeCloseTo(0.251189, 6);

        const undoResult = await undo();

        expect(undoResult.headConsumed).toBe(true);
        expect(trackGain()).toBe(0.8);
    });

    it.each([
        { label: 'absolute unity', payload: { gainDb: 0 }, expected: 100 },
        { label: 'relative -6 dB', payload: { deltaDb: -6 }, expected: 40.095 },
    ])('setMasterGain writes $label as a percent of unity', async ({ payload, expected }) => {
        await executeAppAction({ type: 'setMasterGain', payload });

        expect(transportStore.value?.masterGain).toBeCloseTo(expected, 3);
    });

    it('setMasterGain refuses a request above the fader ceiling', async () => {
        const refusal = await refusalOf({ type: 'setMasterGain', payload: { gainDb: 12 } });

        expect(refusal).toContain("above this control's ceiling of 6.0 dB");
        expect(transportStore.value?.masterGain).toBe(80);
    });

    it('setMasterGain undoes a compounding batch back to the pre-batch percent', async () => {
        // The first action is absolute (unity-referenced), landing at 100 *
        // dbToGain(-6); the second action's `deltaDb` must measure from that
        // planned percent, not from the live pre-batch 80 — the projection this
        // pin guards.
        const groupId = 'master-gain-group';
        const result = await executeAppActionBatch(
            [
                { type: 'setMasterGain', payload: { gainDb: -6 } },
                { type: 'setMasterGain', payload: { deltaDb: -6 } },
            ],
            { groupId }
        );

        expect(result.status).toBe('committed');
        expect(transportStore.value?.masterGain).toBeCloseTo(100 * dbToGain(-12), 3);

        const undoResult = await undo();

        expect(undoResult.headConsumed).toBe(true);
        expect(transportStore.value?.masterGain).toBe(80);
    });

    // The clip sits at 0.5 (-6 dB) and its own law stops at +6.02 dB, the
    // linear ceiling of 2 the writer clamps to.
    it.each([
        { label: 'absolute unity', payload: { gainDb: 0 }, expected: 1 },
        { label: 'absolute +6 dB', payload: { gainDb: 6 }, expected: 1.995262 },
        { label: 'relative +6 dB', payload: { deltaDb: 6 }, expected: 0.997631 },
        { label: 'linear passthrough', payload: { gain: 1.25 }, expected: 1.25 },
    ])('setClipGain writes $label as a linear amplitude', async ({ payload, expected }) => {
        await executeAppAction({ type: 'setClipGain', payload: { clipId: CLIP_ID, ...payload } });

        expect(clipGain()).toBeCloseTo(expected, 5);
    });

    it('setClipGain refuses a request above the clip ceiling', async () => {
        const refusal = await refusalOf({ type: 'setClipGain', payload: { clipId: CLIP_ID, gainDb: 12 } });

        expect(refusal).toContain("above this control's ceiling of 6.0 dB");
        expect(clipGain()).toBe(0.5);
    });

    it('setClipGain refuses both decibel forms at once', async () => {
        const refusal = await refusalOf({ type: 'setClipGain', payload: { clipId: CLIP_ID, gainDb: 0, deltaDb: 3 } });

        expect(refusal).toContain('exactly once');
        expect(clipGain()).toBe(0.5);
    });

    it('setClipGain compounds a batch against the clip an earlier action in it just planned', async () => {
        // The clip starts at +4 dB; the second action's `deltaDb` must measure from
        // the -10 dB the first action left it at, not from the +4 dB still on the
        // live store, or the legal two-step batch would be refused as conflicted.
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => {
                if (track.id !== TRACK_ID) {
                    return track;
                }
                return {
                    ...track,
                    clips: track.clips.map((clip) => {
                        if (clip.id !== CLIP_ID) {
                            return clip;
                        }
                        return { ...clip, gain: dbToGain(4) };
                    }),
                };
            }),
        });

        const result = await executeAppActionBatch([
            { type: 'setClipGain', payload: { clipId: CLIP_ID, gainDb: -10 } },
            { type: 'setClipGain', payload: { clipId: CLIP_ID, deltaDb: 3 } },
        ]);

        expect(result.status).toBe('committed');
        expect(clipGain()).toBeCloseTo(dbToGain(-7), 5);
    });

    it('setClipGain undoes a compounding batch back to the pre-batch gain', async () => {
        // The clip starts at +4 dB; the linear request clamps to the ceiling of 2,
        // and the second action's `deltaDb` must measure from that clamped 2, not
        // from the live +4 dB, landing at dbToGain(gainToDb(2) - 6).
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => {
                if (track.id !== TRACK_ID) {
                    return track;
                }
                return {
                    ...track,
                    clips: track.clips.map((clip) => (clip.id !== CLIP_ID ? clip : { ...clip, gain: dbToGain(4) })),
                };
            }),
        });

        const groupId = 'clip-gain-group';
        const result = await executeAppActionBatch(
            [
                { type: 'setClipGain', payload: { clipId: CLIP_ID, gain: 3 } },
                { type: 'setClipGain', payload: { clipId: CLIP_ID, deltaDb: -6 } },
            ],
            { groupId }
        );

        expect(result.status).toBe('committed');
        expect(clipGain()).toBeCloseTo(dbToGain(gainToDb(2) - 6), 5);

        const undoResult = await undo();

        expect(undoResult.headConsumed).toBe(true);
        expect(clipGain()).toBeCloseTo(dbToGain(4), 5);
    });

    it.each([
        { label: 'absolute -6 dB', payload: { levelDb: -6 }, expected: 0.501187 },
        { label: 'relative -6 dB', payload: { deltaDb: -6 }, expected: 0.250594 },
        { label: 'linear passthrough', payload: { level: 0.75 }, expected: 0.75 },
    ])('setSend writes $label as a linear level', async ({ payload, expected }) => {
        await executeAppAction({ type: 'setSend', payload: { trackId: TRACK_ID, busId: BUS_ID, ...payload } });

        expect(sendLevel()).toBeCloseTo(expected, 5);
    });

    it('setSend refuses a level above unity', async () => {
        const refusal = await refusalOf({
            type: 'setSend',
            payload: { trackId: TRACK_ID, busId: BUS_ID, levelDb: 3 },
        });

        expect(refusal).toContain("above this control's ceiling of 0.0 dB");
        expect(sendLevel()).toBe(0.5);
    });

    it('setSend refuses both decibel forms at once', async () => {
        const refusal = await refusalOf({
            type: 'setSend',
            payload: { trackId: TRACK_ID, busId: BUS_ID, levelDb: -6, deltaDb: -3 },
        });

        expect(refusal).toContain('exactly once');
        expect(sendLevel()).toBe(0.5);
    });

    it('setSend undoes a compounding batch back to the pre-batch level', async () => {
        // The first action is absolute (unity-referenced), landing at
        // dbToGain(-12); the second action's `deltaDb` must measure from that
        // planned level, not from the live pre-batch 0.5.
        const groupId = 'send-level-group';
        const result = await executeAppActionBatch(
            [
                { type: 'setSend', payload: { trackId: TRACK_ID, busId: BUS_ID, levelDb: -12 } },
                { type: 'setSend', payload: { trackId: TRACK_ID, busId: BUS_ID, deltaDb: 3 } },
            ],
            { groupId }
        );

        expect(result.status).toBe('committed');
        expect(sendLevel()).toBeCloseTo(dbToGain(-12) * dbToGain(3), 5);

        const undoResult = await undo();

        expect(undoResult.headConsumed).toBe(true);
        expect(sendLevel()).toBe(0.5);
    });

    // A send being created has no level yet, so a relative request measures
    // from the full copy of the signal it taps.
    it.each([
        { label: 'absolute -6 dB', payload: { levelDb: -6 }, expected: 0.501187 },
        { label: 'relative -12 dB', payload: { deltaDb: -12 }, expected: 0.251189 },
        { label: 'linear passthrough', payload: { level: 0.75 }, expected: 0.75 },
    ])('addSend creates the send at $label', async ({ payload, expected }) => {
        seedProject({ withSend: false });

        await executeAppAction({ type: 'addSend', payload: { trackId: TRACK_ID, busId: BUS_ID, ...payload } });

        expect(sendLevel()).toBeCloseTo(expected, 5);
    });

    it('addSend refuses a level above unity and creates nothing', async () => {
        seedProject({ withSend: false });

        const refusal = await refusalOf({
            type: 'addSend',
            payload: { trackId: TRACK_ID, busId: BUS_ID, levelDb: 3 },
        });

        expect(refusal).toContain("above this control's ceiling of 0.0 dB");
        expect(sendLevel()).toBeUndefined();
    });

    // The lane holds linear amplitudes and already draws 0.5 at beat 1.
    it.each([
        { label: 'absolute unity', payload: { valueDb: 0 }, expected: 1 },
        { label: 'relative -6 dB', payload: { deltaDb: -6 }, expected: 0.250594 },
        { label: 'lane units passthrough', payload: { value: 0.3 }, expected: 0.3 },
    ])('addAutomationPoint writes $label into the lane', async ({ payload, expected }) => {
        await executeAppAction({ type: 'addAutomationPoint', payload: { laneId: LANE_ID, beat: 1, ...payload } });

        const values = lanePointValues(LANE_ID);
        expect(values).toHaveLength(2);
        expect(values[1]).toBeCloseTo(expected, 5);
    });

    it('addAutomationPoint refuses a decibel value above the lane ceiling', async () => {
        const refusal = await refusalOf({
            type: 'addAutomationPoint',
            payload: { laneId: LANE_ID, beat: 1, valueDb: 12 },
        });

        expect(refusal).toContain("above this control's ceiling of 6.0 dB");
        expect(lanePointValues(LANE_ID)).toHaveLength(1);
    });

    it('addAutomationPoint refuses both decibel forms at once', async () => {
        const refusal = await refusalOf({
            type: 'addAutomationPoint',
            payload: { laneId: LANE_ID, beat: 1, valueDb: -6, deltaDb: -3 },
        });

        expect(refusal).toContain('exactly once');
        expect(lanePointValues(LANE_ID)).toHaveLength(1);
    });

    it('addAutomationPoint refuses a decibel value on a lane that does not hold amplitudes', async () => {
        const refusal = await refusalOf({
            type: 'addAutomationPoint',
            payload: { laneId: PAN_LANE_ID, beat: 1, valueDb: 0 },
        });

        expect(refusal).toContain('Pan');
        expect(lanePointValues(PAN_LANE_ID)).toHaveLength(0);
    });
});
