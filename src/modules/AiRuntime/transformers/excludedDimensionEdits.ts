import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type ExcludingPerceptualConstraint, type PerceptualExcludedDimension } from '../models/PerceptualConstraint';
import {
    readDimensionEditedByEveryWrite,
    readPerceptualDimensionOfDeviceType,
} from '../models/PerceptualDimensionByDeviceType';
import { type ProjectContext } from '../models/ProjectContext';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

/** `unclassified` is an edit that reaches a scoped track in a way no reader here can place, so it fails every exclusion. */
export type EditDimension = PerceptualExcludedDimension | 'unclassified';
export type Edit = { dimension: EditDimension; trackId: string | null; detail: string };
type DeviceFacts = { type: string | null; trackId: string | null };
export type AutomatedParameter = { trackId: string | null; parameterId: string };

/** Parameters on other devices that set where their low end is cut or summed to mono. */
const LOW_END_PARAMETER_IDS = new Set(['rev-lowcut', 'delay-lowcut', 'conv-lowcut', 'width-mono-bass']);
const SPATIAL_PARAMETER_PREFIXES = ['rev-', 'conv-', 'delay-', 'chorus-', 'width-'];
/** The channel strip's own level and pan lanes, as the automation lanes name them. */
const CHANNEL_PARAMETER_IDS = new Set(['gain', 'pan']);
const SEND_PARAMETER_PREFIX = 'send:';

const DIMENSION_LABELS: Readonly<Record<PerceptualExcludedDimension, string>> = {
    'low-frequency-band': 'low end',
    ambience: 'ambience',
};

function readDeviceFacts(deviceId: string, actions: readonly AppAction[], context: ProjectContext): DeviceFacts {
    for (const track of context.tracks) {
        const device = track.devices.find((candidate) => candidate.id === deviceId);
        if (device !== undefined) {
            return { type: device.type, trackId: track.id };
        }
    }
    for (const action of actions) {
        if (action.type === 'addDevice' && action.payload.deviceId === deviceId) {
            return { type: action.payload.deviceType, trackId: action.payload.trackId };
        }
    }
    return { type: null, trackId: null };
}

/** A device of unknown type is judged by its parameter's prefix, a known one by its type. */
function isSpatialParameter(deviceType: string | null, paramId: string): boolean {
    if (deviceType === null) {
        return SPATIAL_PARAMETER_PREFIXES.some((prefix) => paramId.startsWith(prefix));
    }
    return readDimensionEditedByEveryWrite(deviceType) === 'ambience';
}

/** A device of unknown type is judged by its parameter's prefix, a known one by what every write on it edits. */
function isLowEndFilterWrite(deviceType: string | null, paramId: string): boolean {
    if (deviceType === null) {
        return paramId.startsWith('filter-');
    }
    return readDimensionEditedByEveryWrite(deviceType) === 'low-frequency-band';
}

/**
 * The dimensions one parameter write edits. A filter's type and cutoff decide together whether it
 * removes the low end, and either may stay at its current value, so every filter write counts. A
 * device whose type is unknown is read by its parameter id alone, which every built-in names uniquely.
 */
function parameterDimensions(deviceType: string | null, paramId: string): PerceptualExcludedDimension[] {
    const dimensions: PerceptualExcludedDimension[] = [];
    const eqLowBand =
        paramId.startsWith('eq-low-') &&
        (deviceType === null || readPerceptualDimensionOfDeviceType(deviceType) === 'low-frequency-band');
    if (eqLowBand || isLowEndFilterWrite(deviceType, paramId) || LOW_END_PARAMETER_IDS.has(paramId)) {
        dimensions.push('low-frequency-band');
    }
    if (isSpatialParameter(deviceType, paramId)) {
        dimensions.push('ambience');
    }
    return dimensions;
}

function deviceTypeDimensions(deviceType: string | null): PerceptualExcludedDimension[] {
    if (deviceType === null) {
        return [];
    }
    const dimension = readPerceptualDimensionOfDeviceType(deviceType);
    return dimension === null ? [] : [dimension];
}

/** Every dimension a chain of these device types shapes, once each. */
function chainDimensions(deviceTypes: readonly string[]): PerceptualExcludedDimension[] {
    return [...new Set(deviceTypes.flatMap(deviceTypeDimensions))];
}

export function edits(dimensions: readonly EditDimension[], trackId: string | null, detail: string): Edit[] {
    return dimensions.map((dimension) => ({ dimension, trackId, detail }));
}

/**
 * What a lane's parameter id automates: the channel's own fader or pan, a send, or a device
 * parameter as `<deviceId>:<paramId>`. Any other id is one this reader cannot place.
 */
export function automatedParameterDimensions(
    parameterId: string,
    actions: readonly AppAction[],
    context: ProjectContext
): EditDimension[] {
    if (CHANNEL_PARAMETER_IDS.has(parameterId)) {
        return [];
    }
    if (parameterId.startsWith(SEND_PARAMETER_PREFIX)) {
        return ['ambience'];
    }
    const separator = parameterId.indexOf(':');
    if (separator < 0) {
        return ['unclassified'];
    }
    const deviceId = parameterId.slice(0, separator);
    const paramId = parameterId.slice(separator + 1);
    return parameterDimensions(readDeviceFacts(deviceId, actions, context).type, paramId);
}

/** A lane by id, in the project or created earlier in the same batch. */
export function readLane(
    laneId: string,
    actions: readonly AppAction[],
    context: ProjectContext
): AutomatedParameter | null {
    const lane = (context.automationLanes ?? []).find((candidate) => candidate.id === laneId);
    if (lane !== undefined) {
        return { trackId: lane.trackId, parameterId: lane.parameterId };
    }
    for (const action of actions) {
        if (action.type === 'addAutomationLane' && action.payload.laneId === laneId) {
            return { trackId: action.payload.trackId, parameterId: action.payload.parameterId };
        }
    }
    return null;
}

/** Every dimension the devices on these tracks shape, as the project holds them. */
export function reachedChainDimensions(
    trackIds: ReadonlySet<string>,
    context: ProjectContext
): PerceptualExcludedDimension[] {
    const deviceTypes = context.tracks
        .filter((track) => trackIds.has(track.id))
        .flatMap((track) => track.devices.map((device) => device.type));
    return chainDimensions(deviceTypes);
}

/**
 * Where a track's signal goes once the batch has run: its sends and output as the project holds them,
 * with the batch's own routing commands applied in order. A later output replaces an earlier one, and
 * a removed send no longer reaches its bus. The batch is applied and heard as one change.
 */
export function readRouting(
    trackId: string,
    actions: readonly AppAction[],
    context: ProjectContext
): { sends: string[]; outputId: string | undefined } {
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    let sends = (track?.sends ?? []).map((send) => send.busId);
    let outputId = track?.outputId;
    for (const action of actions) {
        if (action.type === 'addSend' && action.payload.trackId === trackId) {
            sends.push(action.payload.busId);
        }
        if (action.type === 'removeSend' && action.payload.trackId === trackId) {
            sends = sends.filter((busId) => busId !== action.payload.busId);
        }
        if (action.type === 'setTrackOutput' && action.payload.trackId === trackId) {
            outputId = action.payload.outputId;
        }
    }
    return { sends, outputId };
}

function readDestinations(trackId: string, actions: readonly AppAction[], context: ProjectContext): string[] {
    const { sends, outputId } = readRouting(trackId, actions, context);
    return outputId === undefined ? sends : [...sends, outputId];
}

/**
 * The tracks a constraint's scope sounds through: each scoped track and every bus its sends or output
 * reach, bus to bus, since processing on a return or a bus it feeds shapes the scoped track as heard.
 */
export function readReachedTrackIds(
    trackIds: readonly string[],
    actions: readonly AppAction[],
    context: ProjectContext
): Set<string> {
    const reached = new Set<string>();
    const pending = [...trackIds];
    while (pending.length > 0) {
        const trackId = pending.pop();
        if (trackId === undefined || reached.has(trackId)) {
            continue;
        }
        reached.add(trackId);
        pending.push(...readDestinations(trackId, actions, context));
    }
    return reached;
}

/** An owner the batch does not reveal is inside every scope: an unknown edit is never assumed elsewhere. */
export function inScope(reached: ReadonlySet<string> | null, trackId: string | null): boolean {
    return reached === null || trackId === null || reached.has(trackId);
}

function nameOf(trackId: string | null, context: ProjectContext): string {
    if (trackId === null) {
        return 'a track the batch does not name';
    }
    return `“${context.tracks.find((track) => track.id === trackId)?.name ?? trackId}”`;
}

export function describeEdit(
    constraint: ExcludingPerceptualConstraint,
    edit: Edit,
    command: string,
    context: ProjectContext
): string {
    const label = DIMENSION_LABELS[constraint.protection.dimension];
    const owner = nameOf(edit.trackId, context);
    if (edit.dimension === 'unclassified') {
        return `The request says “${constraint.clause}”, but ${command} changes ${owner} in a way the application cannot show leaves its ${label} alone.`;
    }
    return `The request says “${constraint.clause}”, but ${command} edits the ${label} of ${owner}.`;
}

/** A mix-scoped constraint holds every track, so it reads no routing. */
export function readConstraintReach(
    constraint: ExcludingPerceptualConstraint,
    actions: readonly AppAction[],
    context: ProjectContext
): Set<string> | null {
    if (constraint.scope.kind === 'mix') {
        return null;
    }
    return readReachedTrackIds(constraint.scope.trackIds, actions, context);
}

/** Every other track that sends into this one, in the routing as the batch leaves it. */
export function readSenderIds(trackId: string, actions: readonly AppAction[], context: ProjectContext): string[] {
    return context.tracks
        .filter((track) => track.id !== trackId && readRouting(track.id, actions, context).sends.includes(trackId))
        .map((track) => track.id);
}

/** An output a later output on the same track replaces never survives the batch, so it edits nothing. */
function isSupersededOutput(action: ActionOf<'setTrackOutput'>, actions: readonly AppAction[]): boolean {
    return actions
        .slice(actions.indexOf(action) + 1)
        .some((later) => later.type === 'setTrackOutput' && later.payload.trackId === action.payload.trackId);
}

/**
 * A track routed into a bus takes on the processing of everything that bus reaches, bus to bus: its
 * space, or its spectral shaping.
 */
export function readOutputEdits(
    action: ActionOf<'setTrackOutput'>,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] {
    if (isSupersededOutput(action, actions)) {
        return [];
    }
    const destinationId = action.payload.outputId;
    const dimensions = reachedChainDimensions(readReachedTrackIds([destinationId], actions, context), context);
    const destination = context.tracks.find((track) => track.id === destinationId);
    return edits(dimensions, action.payload.trackId, `to ${destination?.name ?? destinationId}`);
}

/**
 * A send, added, changed or removed, moves a processed parallel copy, so it is always space and also
 * reshapes the low end when a reached track holds a spectral device.
 */
export function readSendRoutingEdits(
    action: ActionOf<'addSend' | 'setSend' | 'removeSend'>,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] {
    const dimensions = reachedChainDimensions(readReachedTrackIds([action.payload.busId], actions, context), context);
    const lowEnd = dimensions.filter((dimension) => dimension === 'low-frequency-band');
    return edits(['ambience', ...lowEnd], action.payload.trackId, 'send');
}

export function readParameterEdits(
    action: ActionOf<'setDeviceParameter'>,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] {
    const facts = readDeviceFacts(action.payload.deviceId, actions, context);
    const deviceType = action.payload.expectedDeviceType ?? facts.type;
    const trackId = action.payload.expectedTrackId ?? facts.trackId;
    return edits(parameterDimensions(deviceType, action.payload.paramId), trackId, action.payload.paramId);
}

export function readAddedDeviceEdits(action: ActionOf<'addDevice'>): Edit[] {
    // An added EQ or filter sits at its defaults until a parameter write shapes it; added space is space.
    const spatial = readPerceptualDimensionOfDeviceType(action.payload.deviceType) === 'ambience';
    return edits(spatial ? ['ambience'] : [], action.payload.trackId, action.payload.deviceType);
}

export function readRemovedDeviceEdits(
    action: ActionOf<'removeDevice' | 'bypassDevice'>,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] {
    const facts = readDeviceFacts(action.payload.deviceId, actions, context);
    return edits(deviceTypeDimensions(facts.type), facts.trackId, facts.type ?? action.payload.deviceId);
}

export function readSendRangeEdits(action: ActionOf<'automateSendRange' | 'automateSendRanges'>): Edit[] {
    return action.payload.trackIds.flatMap((trackId) => edits(['ambience'], trackId, 'send automation'));
}
