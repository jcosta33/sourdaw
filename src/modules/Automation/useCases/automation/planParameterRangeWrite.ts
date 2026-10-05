import { readMusicalRange, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    FADER_MAX_GAIN,
    gainLaneLevelLaw,
    gainToDb,
    type LevelLaw,
    resolveLevelFields,
    SEND_LEVEL_LAW,
    toStereoPan,
} from '#/utils/audioLevelLaw';
import { getDeviceAutomationParameterId } from '#/utils/automationDeviceTarget';
import { type AppAction } from '#/utils/handlerContract';

import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { buildParameterRangePoints } from '../../services/buildParameterRangePoints';
import { sampleStoredLaneCurve } from '../../services/sampleStoredLaneCurve';
import { automationStore } from '../../stores/automationStore';

import { getAutomationLaneCeiling } from './getAutomationLaneCeiling';
import { getAutomationParameterRangeResolver } from './getAutomationParameterRangeResolver';
import { getSendAutomationBusId } from './getSendAutomationBusId';
import { isLinearGainAutomationLane } from './isLinearGainAutomationLane';

type AutomateParameterRangePayload = Extract<AppAction, { type: 'automateParameterRange' }>['payload'];

export type ParameterRangeWriteRefusal =
    | 'unknown-track'
    | 'automation-off'
    | 'unknown-parameter'
    | 'not-automatable'
    | 'no-send'
    | 'no-parameter-value'
    | 'linked-follower'
    | 'ambiguous-section'
    | 'unknown-section'
    | 'invalid-range'
    | 'invalid-target'
    | 'outside-law'
    | 'ramps-exceed-range'
    | 'nonlinear-boundary';

/** The lane a write creates when the track does not automate the parameter yet. */
export type ParameterRangeLaneCreation = Pick<
    AutomationLane,
    'trackId' | 'parameterId' | 'parameterName' | 'minValue' | 'maxValue'
>;

export type ParameterRangeWritePlan = {
    status: 'planned';
    laneId: string;
    /** The name of the lane the write lands on, as the lane shows it. */
    parameterName: string;
    /** Set when the write creates the lane; `null` when it rewrites one the track already has. */
    creation: ParameterRangeLaneCreation | null;
    pointsBefore: AutomationPoint[];
    pointsAfter: AutomationPoint[];
    startBeat: number;
    endBeat: number;
};

export type ParameterRangeWriteResult =
    ParameterRangeWritePlan | { status: 'refused'; refusal: ParameterRangeWriteRefusal; reason: string };

type Refused = Extract<ParameterRangeWriteResult, { status: 'refused' }>;

type ParameterTarget = {
    kind: 'gain' | 'pan' | 'send' | 'device';
    parameterName: string;
    minValue: number;
    maxValue: number;
    /** The value the parameter plays at while no lane drives it, in a new lane's units. */
    staticValue: number;
};

type PlanParameterRangeWriteInput = {
    payload: AutomateParameterRangePayload;
    writeId: string;
};

function refuse(refusal: ParameterRangeWriteRefusal, reason: string): Refused {
    return { status: 'refused', refusal, reason };
}

/** The lane id a write creates, and the id of its n-th point: both owned by the write's identity. */
function createdLaneId(writeId: string): string {
    return `${writeId}-lane`;
}

function sendTarget(track: Track, busId: string): ParameterTarget | Refused {
    const send = track.sends.find((candidate) => candidate.busId === busId);
    if (!send) {
        return refuse('no-send', `Track "${track.name}" has no send to bus ${busId}.`);
    }
    const bus = trackStore.value?.tracks.find((candidate) => candidate.id === busId);
    return {
        kind: 'send',
        parameterName: `Send: ${bus?.name ?? busId}`,
        minValue: 0,
        maxValue: 1,
        staticValue: send.level,
    };
}

/** A device parameter, named the canonical way: the id of a device on this track and its parameter. */
function deviceTarget(track: Track, parameterId: string): ParameterTarget | Refused {
    const separatorIndex = parameterId.indexOf(':');
    const deviceId = separatorIndex > 0 ? parameterId.slice(0, separatorIndex) : null;
    const device = track.devices.find((candidate) => candidate.id === deviceId);
    const paramId = getDeviceAutomationParameterId(parameterId);
    if (!device || !paramId) {
        return refuse('unknown-parameter', `Parameter ${parameterId} names nothing on track "${track.name}".`);
    }
    const range = getAutomationParameterRangeResolver()?.({ trackId: track.id, parameterTargetId: parameterId });
    if (!range) {
        return refuse('not-automatable', `Parameter ${paramId} of "${device.name}" cannot be automated.`);
    }
    const staticValue = device.parameterValues[paramId];
    if (staticValue === undefined || !Number.isFinite(staticValue)) {
        return refuse(
            'no-parameter-value',
            `Parameter ${paramId} of "${device.name}" holds no value for the range to ramp from and back to.`
        );
    }
    return {
        kind: 'device',
        parameterName: `${device.name} → ${paramId}`,
        minValue: range.minValue,
        maxValue: range.maxValue,
        staticValue,
    };
}

function resolveParameterTarget(track: Track, parameterId: string): ParameterTarget | Refused {
    if (parameterId === 'gain') {
        return { kind: 'gain', parameterName: 'Gain', minValue: 0, maxValue: FADER_MAX_GAIN, staticValue: track.gain };
    }
    if (parameterId === 'pan') {
        return { kind: 'pan', parameterName: 'Pan', minValue: -1, maxValue: 1, staticValue: toStereoPan(track.pan) };
    }
    const busId = getSendAutomationBusId(parameterId);
    if (busId !== null) {
        return sendTarget(track, busId);
    }
    if (parameterId.startsWith('send:')) {
        return refuse('unknown-parameter', 'A send target names its bus: send:<busId>.');
    }
    return deviceTarget(track, parameterId);
}

function findTrackLevelLane(trackId: string, parameterId: string): AutomationLane | undefined {
    return automationStore.value?.lanes.find(
        (lane) => !lane.clipId && lane.trackId === trackId && lane.parameterId === parameterId
    );
}

/** The interval the range covers: the beats admission materialized, or the range resolved now. */
function resolveInterval(payload: AutomateParameterRangePayload): { startBeat: number; endBeat: number } | Refused {
    if (payload.startBeat !== undefined && payload.endBeat !== undefined) {
        const { startBeat, endBeat } = payload;
        if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || startBeat < 0 || !(endBeat > startBeat)) {
            return refuse('invalid-range', 'The range must end after it starts, at or after beat 0.');
        }
        return { startBeat, endBeat };
    }
    const resolution = readMusicalRange({ range: payload.range });
    if (resolution.kind === 'resolved') {
        return { startBeat: resolution.startBeat, endBeat: resolution.endBeat };
    }
    return refuse(resolution.kind, resolution.reason);
}

type LaneUnits = {
    lane: AutomationLane | undefined;
    target: ParameterTarget;
};

function laneBounds({ lane, target }: LaneUnits): { minValue: number; maxValue: number } {
    if (lane === undefined) {
        return { minValue: target.minValue, maxValue: target.maxValue };
    }
    return { minValue: lane.minValue, maxValue: getAutomationLaneCeiling(lane) };
}

/** The lane a write creates when the track does not automate the parameter yet, or null when it does. */
function laneCreation(
    lane: AutomationLane | undefined,
    track: Track,
    parameterId: string,
    target: ParameterTarget
): ParameterRangeLaneCreation | null {
    if (lane !== undefined) {
        return null;
    }
    const { parameterName, minValue, maxValue } = target;
    return { trackId: track.id, parameterId, parameterName, minValue, maxValue };
}

/** What the parameter plays at while its lane holds no points, in the lane's own units. */
function laneBaseValue({ lane, target }: LaneUnits): number {
    if (target.kind === 'gain' && lane !== undefined && !isLinearGainAutomationLane(lane)) {
        return gainToDb(target.staticValue);
    }
    return target.staticValue;
}

/** The law a decibel target answers to, or why decibels do not describe this lane. */
function decibelLaw(units: LaneUnits): LevelLaw | Refused {
    const { lane, target } = units;
    if (target.kind === 'send') {
        return SEND_LEVEL_LAW;
    }
    if (target.kind === 'gain' && (lane === undefined || isLinearGainAutomationLane(lane))) {
        return gainLaneLevelLaw(laneBounds(units));
    }
    return refuse(
        'invalid-target',
        `Lane "${lane?.parameterName ?? target.parameterName}" does not hold gain amplitudes, so its target is stated in the lane's own units rather than in decibels.`
    );
}

function resolveTargetValue(
    payload: AutomateParameterRangePayload,
    units: LaneUnits,
    startValue: number
): number | Refused {
    const { value, valueDb, deltaDb } = payload;
    if ([value, valueDb, deltaDb].filter((field) => field !== undefined).length !== 1) {
        return refuse(
            'invalid-target',
            "State the target exactly once: in the lane's own units, as an absolute level in decibels, or as a relative change in decibels."
        );
    }
    if (value !== undefined) {
        const { minValue, maxValue } = laneBounds(units);
        if (!Number.isFinite(value) || value < minValue || value > maxValue) {
            return refuse(
                'outside-law',
                `${String(value)} is outside the lane's range of ${String(minValue)} to ${String(maxValue)}.`
            );
        }
        return value;
    }
    const law = decibelLaw(units);
    if ('status' in law) {
        return law;
    }
    const level = resolveLevelFields(deltaDb === undefined ? { absoluteDb: valueDb } : { deltaDb }, startValue, law);
    return level.ok ? level.linear : refuse('outside-law', level.reason);
}

type RangeLevels = { baseValue: number; targetValue: number };

/**
 * The value the lane draws while it holds no points, and the value the range holds. A silent fader
 * is minus infinity decibels, which no point can hold, so an empty decibel lane on one has no level
 * to ramp from and back to.
 */
function resolveRangeLevels(
    payload: AutomateParameterRangePayload,
    units: LaneUnits,
    startBeat: number
): RangeLevels | Refused {
    const points = units.lane?.points ?? [];
    const baseValue = laneBaseValue(units);
    if (points.length === 0 && !Number.isFinite(baseValue)) {
        return refuse(
            'no-parameter-value',
            `Lane "${units.lane?.parameterName ?? units.target.parameterName}" holds no points and the track's fader is silent, so there is no level for the range to ramp from and back to.`
        );
    }
    const targetValue = resolveTargetValue(payload, units, sampleStoredLaneCurve(points, baseValue, startBeat));
    return typeof targetValue === 'number' ? { baseValue, targetValue } : targetValue;
}

function resolveRamps(payload: AutomateParameterRangePayload): { rampIn: number; rampOut: number } | Refused {
    const rampIn = payload.rampIn ?? 0;
    const rampOut = payload.rampOut ?? 0;
    if (!Number.isFinite(rampIn) || !Number.isFinite(rampOut) || rampIn < 0 || rampOut < 0) {
        return refuse('invalid-range', 'Ramp lengths are a finite, non-negative number of beats.');
    }
    return { rampIn, rampOut };
}

/**
 * The lane points a range write leaves, or the typed reason it writes nothing.
 *
 * Reads the live project and writes nothing, so describing, validating and executing the same
 * command all reach the same plan. The write's lane and point identities come from `writeId`,
 * which is what lets a redo land exactly the points the original write did.
 */
export function planParameterRangeWrite({ payload, writeId }: PlanParameterRangeWriteInput): ParameterRangeWriteResult {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === payload.trackId);
    if (!track) {
        return refuse('unknown-track', `Track is unavailable: ${payload.trackId}`);
    }
    if (track.automationMode === 'off') {
        return refuse('automation-off', `Track "${track.name}" has automation turned off, so no lane would play.`);
    }
    const target = resolveParameterTarget(track, payload.parameterId);
    if ('status' in target) {
        return target;
    }
    const lane = findTrackLevelLane(track.id, payload.parameterId);
    if (lane?.linkedLaneId !== undefined) {
        return refuse(
            'linked-follower',
            `Lane "${lane.parameterName}" follows automation lane ${lane.linkedLaneId}; automate its source lane instead.`
        );
    }
    const interval = resolveInterval(payload);
    if ('status' in interval) {
        return interval;
    }
    const units = { lane, target };
    const pointsBefore = lane?.points ?? [];
    const levels = resolveRangeLevels(payload, units, interval.startBeat);
    if ('status' in levels) {
        return levels;
    }
    const { baseValue, targetValue } = levels;
    const ramps = resolveRamps(payload);
    if ('status' in ramps) {
        return ramps;
    }
    const built = buildParameterRangePoints({
        points: pointsBefore,
        baseValue,
        ...interval,
        targetValue,
        ...ramps,
        pointId: (index) => `${writeId}-point-${String(index)}`,
    });
    if (!built.ok) {
        return refuse(built.refusal, built.reason);
    }
    return {
        status: 'planned',
        laneId: lane?.id ?? createdLaneId(writeId),
        parameterName: lane?.parameterName ?? target.parameterName,
        creation: laneCreation(lane, track, payload.parameterId, target),
        pointsBefore: [...pointsBefore],
        pointsAfter: built.points,
        ...interval,
    };
}
