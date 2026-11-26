import { type ProjectContext } from '../../../models/ProjectContext';

import { kindNounFitsTrack } from './kindNounFitsTrack';
import { kindNounFitsVcaGroup } from './kindNounFitsVcaGroup';
import { normalizePromptText } from './normalizePromptText';

function isNamed(object: { id: string; name: string }, reference: string): boolean {
    return [object.id, object.name].some((text) => normalizePromptText(text) === reference);
}

/**
 * Whether a track kind noun written before a reference agrees with an object the reference names: a
 * track it fits, or a VCA group. "the bus Drums" beside an audio track Drums and no bus of that name
 * names no object, so the noun is no part of that reference.
 */
export function kindNounFitsNamedObject(kindNoun: string, referenceText: string, context: ProjectContext): boolean {
    const reference = normalizePromptText(referenceText);
    if (context.tracks.some((track) => isNamed(track, reference) && kindNounFitsTrack(kindNoun, track))) {
        return true;
    }
    return kindNounFitsVcaGroup(kindNoun) && (context.vcaGroups ?? []).some((group) => isNamed(group, reference));
}
