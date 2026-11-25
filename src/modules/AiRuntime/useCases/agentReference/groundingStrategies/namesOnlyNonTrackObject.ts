import { type ProjectContext } from '../../../models/ProjectContext';

import { normalizePromptText } from './normalizePromptText';

function isSameText(text: string, normalizedReference: string): boolean {
    return normalizePromptText(text) === normalizedReference;
}

function getNonTrackReferenceTexts(context: ProjectContext): string[] {
    return [
        ...(context.vcaGroups ?? []).flatMap((group) => [group.id, group.name]),
        ...context.tracks.flatMap((track) => [
            ...track.devices.flatMap((device) => [
                device.id,
                device.type,
                ...(device.parameters ?? []).flatMap((parameter) => [parameter.id, parameter.name]),
            ]),
            ...track.clips.flatMap((clip) => [clip.id, clip.name]),
        ]),
    ];
}

/**
 * Whether a reference's whole text is the id or name of a project object other than a track, and of no
 * track: "Vocal Take" for a clip on Vocals. Such a reference names that object, so it never selects a
 * fader, however closely its words resemble a track's name.
 */
export function namesOnlyNonTrackObject(referenceText: string, context: ProjectContext): boolean {
    const reference = normalizePromptText(referenceText);
    if (context.tracks.some((track) => [track.id, track.name].some((text) => isSameText(text, reference)))) {
        return false;
    }
    return getNonTrackReferenceTexts(context).some((text) => isSameText(text, reference));
}
