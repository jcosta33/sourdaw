import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type ProjectContext } from '../models/ProjectContext';

export type ResolvedAutomationLaneTarget = {
    readonly parameterId: string;
    readonly parameterName: string;
    readonly minValue: number;
    readonly maxValue: number;
};

/**
 * The track's own controls, with the range the lane handler writes for them. A map rather than a
 * record because the key is provider-controlled, and an object index would answer an inherited
 * `Object.prototype` name.
 */
const TRACK_AUTOMATION_TARGETS: ReadonlyMap<string, ResolvedAutomationLaneTarget> = new Map([
    ['gain', { parameterId: 'gain', parameterName: 'Gain', minValue: 0, maxValue: FADER_MAX_GAIN }],
    ['pan', { parameterId: 'pan', parameterName: 'Pan', minValue: -1, maxValue: 1 }],
]);

/**
 * The lane `addAutomationLane` creates for this track and parameter, read from the context alone so
 * a plan can reason about a lane it has not created yet. A device target is `<deviceId>:<parameterId>`
 * naming a device already on this track; its lane spans the parameter's declared range and is named
 * the way the lane picker names it. Whether a curve may drive that parameter at all is decided by
 * the Automation handler against the live descriptor, which this projection does not carry.
 */
export function resolveAutomationLaneTarget(
    context: ProjectContext,
    trackId: unknown,
    parameterId: unknown
): ResolvedAutomationLaneTarget | null {
    if (typeof trackId !== 'string' || typeof parameterId !== 'string') {
        return null;
    }
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return null;
    }
    const trackTarget = TRACK_AUTOMATION_TARGETS.get(parameterId);
    if (trackTarget) {
        return trackTarget;
    }
    const separatorIndex = parameterId.indexOf(':');
    if (separatorIndex <= 0) {
        return null;
    }
    const device = track.devices.find((candidate) => candidate.id === parameterId.slice(0, separatorIndex));
    const parameter = device?.parameters?.find((candidate) => candidate.id === parameterId.slice(separatorIndex + 1));
    if (!device || !parameter || parameter.maxValue <= parameter.minValue) {
        return null;
    }
    return {
        parameterId,
        parameterName: `${device.name ?? device.type} → ${parameter.name}`,
        minValue: parameter.minValue,
        maxValue: parameter.maxValue,
    };
}
