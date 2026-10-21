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

/** The send-level prefix a send lane's `parameterId` carries before its bus id. */
const SEND_TARGET_PREFIX = 'send:';

/**
 * A send target is `send:<busId>` naming a bus this track already sends to. Its lane holds the send's
 * stored linear level, unity at the top, the way the Automation send lane does.
 */
function resolveSendTarget(
    context: ProjectContext,
    track: ProjectContext['tracks'][number],
    parameterId: string
): ResolvedAutomationLaneTarget | null {
    const busId = parameterId.slice(SEND_TARGET_PREFIX.length);
    if (busId.length === 0 || !(track.sends ?? []).some((send) => send.busId === busId)) {
        return null;
    }
    const bus = context.tracks.find((candidate) => candidate.id === busId);
    return { parameterId, parameterName: `Send: ${bus?.name ?? busId}`, minValue: 0, maxValue: 1 };
}

/**
 * The lane `addAutomationLane` or a range write creates for this track and parameter, read from the
 * context alone so a plan can reason about a lane it has not created yet. A device target is
 * `<deviceId>:<parameterId>` naming a device already on this track; its lane spans the parameter's
 * declared range and is named the way the lane picker names it. Whether a curve may drive that
 * parameter at all is decided by the Automation handler against the live descriptor, which this
 * projection does not carry.
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
    if (parameterId.startsWith(SEND_TARGET_PREFIX)) {
        return resolveSendTarget(context, track, parameterId);
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
