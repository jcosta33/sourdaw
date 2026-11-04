import { type AppAction } from '#/utils/handlerContract';

import { type PerceptualConstraint, type PerceptualExcludedDimension } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';

type Edit = { dimension: PerceptualExcludedDimension; trackId: string | null; detail: string };
type DeviceFacts = { type: string | null; trackId: string | null };

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

/**
 * The dimensions one parameter write edits. A filter's type and cutoff decide together whether it
 * removes the low end, and either may stay at its current value, so every filter write counts. A
 * device whose type is unknown is read by its parameter id alone, which every built-in names uniquely.
 */
/** A device of unknown type is judged by its parameter's prefix, a known one by its type. */
function isSpatialParameter(deviceType: string | null, paramId: string): boolean {
    if (deviceType === null) {
        return SPATIAL_PARAMETER_PREFIXES.some((prefix) => paramId.startsWith(prefix));
    }
    return SPATIAL_DEVICE_TYPES.has(deviceType);
}

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

function edits(dimensions: PerceptualExcludedDimension[], trackId: string | null, detail: string): Edit[] {
    return dimensions.map((dimension) => ({ dimension, trackId, detail }));
}

function readParameterEdits(action: AppAction, actions: readonly AppAction[], context: ProjectContext): Edit[] {
    if (action.type === 'setDeviceParameter') {
        const facts = readDeviceFacts(action.payload.deviceId, actions, context);
        const deviceType = action.payload.expectedDeviceType ?? facts.type;
        const trackId = action.payload.expectedTrackId ?? facts.trackId;
        return edits(parameterDimensions(deviceType, action.payload.paramId), trackId, action.payload.paramId);
    }
    if (action.type === 'automateParameterRange') {
        const separator = action.payload.parameterId.indexOf(':');
        if (separator < 0) {
            return [];
        }
        const deviceId = action.payload.parameterId.slice(0, separator);
        const paramId = action.payload.parameterId.slice(separator + 1);
        const facts = readDeviceFacts(deviceId, actions, context);
        return edits(parameterDimensions(facts.type, paramId), action.payload.trackId, paramId);
    }
    return [];
}

function readDeviceChainEdits(action: AppAction, actions: readonly AppAction[], context: ProjectContext): Edit[] {
    if (action.type === 'addDevice') {
        // An added EQ or filter sits at its defaults until a parameter write shapes it; added space is space.
        const spatial = SPATIAL_DEVICE_TYPES.has(action.payload.deviceType);
        return edits(spatial ? ['ambience'] : [], action.payload.trackId, action.payload.deviceType);
    }
    if (action.type === 'removeDevice' || action.type === 'bypassDevice') {
        const facts = readDeviceFacts(action.payload.deviceId, actions, context);
        return edits(deviceTypeDimensions(facts.type), facts.trackId, facts.type ?? action.payload.deviceId);
    }
    if (action.type === 'loadPreset') {
        const types = [
            ...action.payload.devices.map((device) => device.type),
            ...action.payload.expectedBefore.devices.map((device) => device.type),
        ];
        const dimensions = [...new Set(types.flatMap(deviceTypeDimensions))];
        return edits(dimensions, action.payload.trackId, action.payload.presetId);
    }
    return [];
}

function readSendEdits(action: AppAction): Edit[] {
    if (action.type === 'addSend' || action.type === 'setSend' || action.type === 'removeSend') {
        return edits(['ambience'], action.payload.trackId, 'send');
    }
    if (action.type === 'automateSendRange' || action.type === 'automateSendRanges') {
        return action.payload.trackIds.flatMap((trackId) => edits(['ambience'], trackId, 'send automation'));
    }
    return [];
}

function readActionEdits(action: AppAction, actions: readonly AppAction[], context: ProjectContext): Edit[] {
    return [
        ...readParameterEdits(action, actions, context),
        ...readDeviceChainEdits(action, actions, context),
        ...readSendEdits(action),
    ];
}

/** An owner the batch does not reveal is inside every scope: an unknown edit is never assumed elsewhere. */
function inScope(constraint: PerceptualConstraint, trackId: string | null): boolean {
    return constraint.scope.kind === 'mix' || trackId === null || constraint.scope.trackIds.includes(trackId);
}

function nameOf(trackId: string | null, context: ProjectContext): string {
    if (trackId === null) {
        return 'a track the batch does not name';
    }
    return `“${context.tracks.find((track) => track.id === trackId)?.name ?? trackId}”`;
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
    for (const [index, action] of input.actions.entries()) {
        for (const edit of readActionEdits(action, input.actions, input.context)) {
            const constraint = input.constraints.find(
                (candidate) => candidate.protection.dimension === edit.dimension && inScope(candidate, edit.trackId)
            );
            if (constraint !== undefined) {
                return {
                    reason: `The request says “${constraint.clause}”, but command ${String(index + 1)} (${action.type} ${edit.detail}) edits the ${DIMENSION_LABELS[edit.dimension]} of ${nameOf(edit.trackId, input.context)}.`,
                };
            }
        }
    }
    return null;
}
