import { getExecutableAppActionEffect, getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type PerceptualConstraint, type PerceptualExcludedDimension } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { proposalCommandShape } from '../agentReference/proposalCommandShape';

type ActionEffect = NonNullable<ReturnType<typeof getExecutableAppActionEffect>>;
type EffectDimension = ActionEffect['dimensions'][number];
type TargetCapability = NonNullable<
    ReturnType<typeof getExecutableAppActionGroundingRules>
>['targetRules'][number]['capability'];

/** `unclassified` is an edit that reaches a scoped track in a way no reader here can place, so it fails every exclusion. */
type EditDimension = PerceptualExcludedDimension | 'unclassified';
type Edit = { dimension: EditDimension; trackId: string | null; detail: string };
type DeviceFacts = { type: string | null; trackId: string | null };
type AutomatedParameter = { trackId: string | null; parameterId: string };

/** Devices whose whole job is spectral shaping: removing or bypassing one changes the low end it shapes. */
const SPECTRAL_DEVICE_TYPES = new Set(['builtin-eq', 'builtin-filter']);
/** Devices that add space around a source. */
const SPATIAL_DEVICE_TYPES = new Set([
    'builtin-reverb',
    'builtin-convolution-reverb',
    'builtin-delay',
    'builtin-chorus',
    'builtin-stereo-widener',
]);
/** Parameters on other devices that set where their low end is cut or summed to mono. */
const LOW_END_PARAMETER_IDS = new Set(['rev-lowcut', 'delay-lowcut', 'conv-lowcut', 'width-mono-bass']);
const SPATIAL_PARAMETER_PREFIXES = ['rev-', 'conv-', 'delay-', 'chorus-', 'width-'];
/** The channel strip's own level and pan lanes, as the automation lanes name them. */
const CHANNEL_PARAMETER_IDS = new Set(['gain', 'pan']);
const SEND_PARAMETER_PREFIX = 'send:';
/** The effect dimensions through which a command can change what a track sounds like. */
const SOUND_DIMENSIONS: ReadonlySet<EffectDimension> = new Set(['processing', 'routing', 'automation']);
/**
 * Targets that name a channel strip or a group of them, never a device on one. A processing or
 * automation write reaching only these moves a fader or a pan, which shapes neither space nor spectrum.
 */
const CHANNEL_TARGET_CAPABILITIES: ReadonlySet<TargetCapability> = new Set([
    'track',
    'routable-source',
    'vca-group',
    'vca-member-track',
]);

const DIMENSION_LABELS: Readonly<Record<PerceptualExcludedDimension, string>> = {
    'low-frequency-band': 'low end',
    ambience: 'ambience',
};

/** A command's arguments as the registry's target declarations name them. */
function readPayload(action: AppAction): Readonly<Record<string, unknown>> {
    const payload: unknown = 'payload' in action ? action.payload : undefined;
    return isRecord(payload) ? payload : {};
}

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
    return SPATIAL_DEVICE_TYPES.has(deviceType);
}

/**
 * The dimensions one parameter write edits. A filter's type and cutoff decide together whether it
 * removes the low end, and either may stay at its current value, so every filter write counts. A
 * device whose type is unknown is read by its parameter id alone, which every built-in names uniquely.
 */
function parameterDimensions(deviceType: string | null, paramId: string): PerceptualExcludedDimension[] {
    const dimensions: PerceptualExcludedDimension[] = [];
    const eqLowBand = paramId.startsWith('eq-low-') && (deviceType === null || deviceType === 'builtin-eq');
    const filter = deviceType === 'builtin-filter' || (deviceType === null && paramId.startsWith('filter-'));
    if (eqLowBand || filter || LOW_END_PARAMETER_IDS.has(paramId)) {
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
    if (SPECTRAL_DEVICE_TYPES.has(deviceType)) {
        return ['low-frequency-band'];
    }
    return SPATIAL_DEVICE_TYPES.has(deviceType) ? ['ambience'] : [];
}

/** Every dimension a chain of these device types shapes, once each. */
function chainDimensions(deviceTypes: readonly string[]): PerceptualExcludedDimension[] {
    return [...new Set(deviceTypes.flatMap(deviceTypeDimensions))];
}

function edits(dimensions: readonly EditDimension[], trackId: string | null, detail: string): Edit[] {
    return dimensions.map((dimension) => ({ dimension, trackId, detail }));
}

/**
 * What a lane's parameter id automates: the channel's own fader or pan, a send, or a device
 * parameter as `<deviceId>:<paramId>`. Any other id is one this reader cannot place.
 */
function automatedParameterDimensions(
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
function readLane(laneId: string, actions: readonly AppAction[], context: ProjectContext): AutomatedParameter | null {
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

/**
 * The parameter an automation write draws: the one it names beside its track, or the one its lane
 * target automates, read from the registry's own target declaration.
 */
function readAutomatedParameter(
    action: AppAction,
    actions: readonly AppAction[],
    context: ProjectContext
): AutomatedParameter | null {
    const payload = readPayload(action);
    if (typeof payload.parameterId === 'string' && typeof payload.trackId === 'string') {
        return { trackId: payload.trackId, parameterId: payload.parameterId };
    }
    const laneRule = getExecutableAppActionGroundingRules(action.type)?.targetRules.find(
        (rule) => rule.capability === 'automation-lane'
    );
    const laneId = laneRule === undefined ? undefined : payload[laneRule.argument];
    return typeof laneId === 'string' ? readLane(laneId, actions, context) : null;
}

function readAutomationEdits(
    action: AppAction,
    effect: ActionEffect,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] | null {
    if (!effect.dimensions.includes('automation')) {
        return null;
    }
    const automated = readAutomatedParameter(action, actions, context);
    if (automated === null) {
        return null;
    }
    const dimensions = automatedParameterDimensions(automated.parameterId, actions, context);
    return edits(dimensions, automated.trackId, automated.parameterId);
}

/** Every dimension the devices on these tracks shape, as the project holds them. */
function reachedChainDimensions(trackIds: ReadonlySet<string>, context: ProjectContext): PerceptualExcludedDimension[] {
    const deviceTypes = context.tracks
        .filter((track) => trackIds.has(track.id))
        .flatMap((track) => track.devices.map((device) => device.type));
    return chainDimensions(deviceTypes);
}

function isSendCommand(
    action: AppAction
): action is Extract<AppAction, { type: 'addSend' | 'setSend' | 'removeSend' }> {
    return action.type === 'addSend' || action.type === 'setSend' || action.type === 'removeSend';
}

/** An output a later output on the same track replaces never survives the batch, so it edits nothing. */
function isSupersededOutput(action: AppAction, actions: readonly AppAction[]): boolean {
    if (action.type !== 'setTrackOutput') {
        return false;
    }
    return actions
        .slice(actions.indexOf(action) + 1)
        .some((later) => later.type === 'setTrackOutput' && later.payload.trackId === action.payload.trackId);
}

/**
 * A track routed into a bus takes on the processing of everything that bus reaches, bus to bus: its
 * space, or its spectral shaping. A send, added, changed or removed, moves a processed parallel copy,
 * so it is always space and also reshapes the low end when a reached track holds a spectral device.
 */
function readRoutingEdits(action: AppAction, actions: readonly AppAction[], context: ProjectContext): Edit[] | null {
    if (action.type !== 'setTrackOutput' && !isSendCommand(action)) {
        return null;
    }
    if (isSupersededOutput(action, actions)) {
        return [];
    }
    const destinationId = action.type === 'setTrackOutput' ? action.payload.outputId : action.payload.busId;
    const dimensions = reachedChainDimensions(readReachedTrackIds([destinationId], actions, context), context);
    if (isSendCommand(action)) {
        const lowEnd = dimensions.filter((dimension) => dimension === 'low-frequency-band');
        return edits(['ambience', ...lowEnd], action.payload.trackId, 'send');
    }
    const destination = context.tracks.find((track) => track.id === destinationId);
    return edits(dimensions, action.payload.trackId, `to ${destination?.name ?? destinationId}`);
}

/**
 * Removing a track removes its devices, so every track that sounds through it loses the space or
 * spectral shaping the track and everything it reaches, bus to bus, applied. The removed track is the
 * edit's owner, so a constraint holds it exactly when its scope reaches that track.
 */
function readTrackRemovalEdits(
    action: AppAction,
    effect: ActionEffect,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] | null {
    if (!effect.removes?.includes('track')) {
        return null;
    }
    const trackIds = new Set(context.tracks.map((track) => track.id));
    const removedIds = proposalCommandShape
        .touchedObjectIds(action.type, readPayload(action), context)
        .filter((id) => trackIds.has(id));
    return removedIds.flatMap((removedId) => {
        const dimensions = reachedChainDimensions(readReachedTrackIds([removedId], actions, context), context);
        const name = context.tracks.find((track) => track.id === removedId)?.name ?? removedId;
        return edits(dimensions, removedId, `removing ${name}`);
    });
}

function readParameterEdits(action: AppAction, actions: readonly AppAction[], context: ProjectContext): Edit[] | null {
    if (action.type !== 'setDeviceParameter') {
        return null;
    }
    const facts = readDeviceFacts(action.payload.deviceId, actions, context);
    const deviceType = action.payload.expectedDeviceType ?? facts.type;
    const trackId = action.payload.expectedTrackId ?? facts.trackId;
    return edits(parameterDimensions(deviceType, action.payload.paramId), trackId, action.payload.paramId);
}

function readDeviceChainEdits(
    action: AppAction,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] | null {
    if (action.type === 'addDevice') {
        // An added EQ or filter sits at its defaults until a parameter write shapes it; added space is space.
        const spatial = SPATIAL_DEVICE_TYPES.has(action.payload.deviceType);
        return edits(spatial ? ['ambience'] : [], action.payload.trackId, action.payload.deviceType);
    }
    if (action.type === 'removeDevice' || action.type === 'bypassDevice') {
        const facts = readDeviceFacts(action.payload.deviceId, actions, context);
        return edits(deviceTypeDimensions(facts.type), facts.trackId, facts.type ?? action.payload.deviceId);
    }
    return null;
}

function readSendEdits(action: AppAction): Edit[] | null {
    if (action.type === 'automateSendRange' || action.type === 'automateSendRanges') {
        return action.payload.trackIds.flatMap((trackId) => edits(['ambience'], trackId, 'send automation'));
    }
    return null;
}

/** A write that moves only channel strips: processing or automation whose every target is one. */
function isChannelStripWrite(action: AppAction, effect: ActionEffect): boolean {
    const targets = getExecutableAppActionGroundingRules(action.type)?.targetRules ?? [];
    return (
        targets.length > 0 &&
        effect.dimensions.every((dimension) => dimension === 'processing' || dimension === 'automation') &&
        targets.every((rule) => CHANNEL_TARGET_CAPABILITIES.has(rule.capability))
    );
}

/**
 * Every command whose declared effect reaches a track's processing, routing or automation that no
 * reader above places is refused on the tracks it touches. An arrangement edit carries the
 * automation and routing of the content it moves, and the holds measure what it changes.
 */
function readUnclassifiedEdits(action: AppAction, effect: ActionEffect, context: ProjectContext): Edit[] {
    const reachesSound = effect.dimensions.some((dimension) => SOUND_DIMENSIONS.has(dimension));
    if (!reachesSound || effect.dimensions.includes('arrangement') || isChannelStripWrite(action, effect)) {
        return [];
    }
    const trackIds = new Set(context.tracks.map((track) => track.id));
    const owners = proposalCommandShape
        .touchedObjectIds(action.type, readPayload(action), context)
        .filter((id) => trackIds.has(id));
    const reach = effect.dimensions.join(' and ');
    if (owners.length === 0) {
        return edits(['unclassified'], null, reach);
    }
    return owners.flatMap((trackId) => edits(['unclassified'], trackId, reach));
}

function readActionEdits(action: AppAction, actions: readonly AppAction[], context: ProjectContext): Edit[] {
    const effect = getExecutableAppActionEffect(action.type);
    if (effect === null) {
        return [];
    }
    return (
        readParameterEdits(action, actions, context) ??
        readDeviceChainEdits(action, actions, context) ??
        readRoutingEdits(action, actions, context) ??
        readTrackRemovalEdits(action, effect, actions, context) ??
        readSendEdits(action) ??
        readAutomationEdits(action, effect, actions, context) ??
        readUnclassifiedEdits(action, effect, context)
    );
}

/**
 * Where a track's signal goes once the batch has run: its sends and output as the project holds them,
 * with the batch's own routing commands applied in order. A later output replaces an earlier one, and
 * a removed send no longer reaches its bus. The batch is applied and heard as one change.
 */
function readDestinations(trackId: string, actions: readonly AppAction[], context: ProjectContext): string[] {
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
    return outputId === undefined ? sends : [...sends, outputId];
}

/**
 * The tracks a constraint's scope sounds through: each scoped track and every bus its sends or output
 * reach, bus to bus, since processing on a return or a bus it feeds shapes the scoped track as heard.
 */
function readReachedTrackIds(
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
function inScope(reached: ReadonlySet<string> | null, trackId: string | null): boolean {
    return reached === null || trackId === null || reached.has(trackId);
}

function nameOf(trackId: string | null, context: ProjectContext): string {
    if (trackId === null) {
        return 'a track the batch does not name';
    }
    return `“${context.tracks.find((track) => track.id === trackId)?.name ?? trackId}”`;
}

function describeEdit(constraint: PerceptualConstraint, edit: Edit, command: string, context: ProjectContext): string {
    const label = DIMENSION_LABELS[constraint.protection.dimension];
    const owner = nameOf(edit.trackId, context);
    if (edit.dimension === 'unclassified') {
        return `The request says “${constraint.clause}”, but ${command} changes ${owner} in a way the application cannot show leaves its ${label} alone.`;
    }
    return `The request says “${constraint.clause}”, but ${command} edits the ${label} of ${owner}.`;
}

/** A mix-scoped constraint holds every track, so it reads no routing. */
function readConstraintReach(
    constraint: PerceptualConstraint,
    actions: readonly AppAction[],
    context: ProjectContext
): Set<string> | null {
    if (constraint.scope.kind === 'mix') {
        return null;
    }
    return readReachedTrackIds(constraint.scope.trackIds, actions, context);
}

/**
 * The first command that edits a dimension a constraint excludes on its scope, as the refusal the
 * user sees, or `null`. It reads the batch before any preview renders it, so a batch that would
 * break a constraint by construction is never measured, shown or approved.
 */
export function findExcludedDimensionEdit(input: {
    constraints: readonly PerceptualConstraint[];
    actions: readonly AppAction[];
    context: ProjectContext;
}): { reason: string } | null {
    if (input.constraints.length === 0) {
        return null;
    }
    const reach = new Map(
        input.constraints.map((constraint) => [
            constraint,
            readConstraintReach(constraint, input.actions, input.context),
        ])
    );
    for (const [index, action] of input.actions.entries()) {
        for (const edit of readActionEdits(action, input.actions, input.context)) {
            const constraint = input.constraints.find(
                (candidate) =>
                    (edit.dimension === 'unclassified' || candidate.protection.dimension === edit.dimension) &&
                    inScope(reach.get(candidate) ?? null, edit.trackId)
            );
            if (constraint !== undefined) {
                const command = `command ${String(index + 1)} (${action.type} ${edit.detail})`;
                return { reason: describeEdit(constraint, edit, command, input.context) };
            }
        }
    }
    return null;
}
