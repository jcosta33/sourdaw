import { type ProjectContext } from '../../../models/ProjectContext';

import { maskProjectReferences } from './maskProjectReferences';
import { normalizePromptText } from './normalizePromptText';
import { type PromptClause } from './promptScope';

/**
 * Whether a clause names a send ("the Kick send", "send the Kick to the Drum Bus") or the master.
 * Either one is what a level stated there moves, never a track fader.
 */
function namesSendOrMaster(clause: PromptClause, context: ProjectContext): boolean {
    if (/□\s+sends?\b/u.test(clause.masked) || /\bsends?\b.*\b(?:to|into)\b/iu.test(clause.masked)) {
        return true;
    }
    return namesMaster(clause, context);
}

function isBareMasterReference(reference: string): boolean {
    return normalizePromptText(reference) === 'master';
}

/**
 * The project's objects other than the master, less any whose whole name is the bare word "master":
 * a synth parameter named "Master" cannot tell the master apart from itself, so it never hides it.
 */
function getOtherThanMasterReferences(context: ProjectContext): ProjectContext {
    return {
        ...context,
        vcaGroups: context.vcaGroups?.filter((group) => !isBareMasterReference(group.name)),
        tracks: context.tracks
            .filter((track) => track.kind !== 'master' && !isBareMasterReference(track.name))
            .map((track) => ({
                ...track,
                clips: track.clips.filter((clip) => !isBareMasterReference(clip.name)),
                devices: track.devices.map((device) => ({
                    ...device,
                    parameters: device.parameters?.filter(
                        (parameter) => !isBareMasterReference(parameter.id) && !isBareMasterReference(parameter.name)
                    ),
                })),
            })),
    };
}

/** Whether a clause names the master itself, outside a longer name of another project object ("Master Keys"). */
function namesMaster(clause: PromptClause, context: ProjectContext): boolean {
    return /\bmaster\b/iu.test(maskProjectReferences(clause.text, getOtherThanMasterReferences(context)));
}

/**
 * Whether a clause states a level the action never moves: a send's or the master's for a track
 * fader, and anything but the master's for the master fader.
 */
export function namesLevelOutsideActionFader(
    actionName: string,
    clause: PromptClause,
    context: ProjectContext
): boolean {
    if (actionName === 'setTrackGain') {
        return namesSendOrMaster(clause, context);
    }
    return actionName === 'setMasterGain' && !namesMaster(clause, context);
}
