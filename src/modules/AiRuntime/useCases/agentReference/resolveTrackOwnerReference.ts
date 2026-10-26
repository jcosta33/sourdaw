import { type ProjectContext } from '../../models/ProjectContext';

import { namesTrackAsQualifiedOwner } from './namesTrackAsQualifiedOwner';

type TrackOwnerReference = { status: 'none' } | { status: 'unique'; id: string } | { status: 'ambiguous' };

export function resolveTrackOwnerReference(prompt: string, context: ProjectContext): TrackOwnerReference {
    const referencedTracks = context.tracks.filter((track) => namesTrackAsQualifiedOwner(prompt, track));
    if (referencedTracks.length === 0) {
        return { status: 'none' };
    }
    if (referencedTracks.length > 1) {
        return { status: 'ambiguous' };
    }
    return { status: 'unique', id: referencedTracks[0]!.id };
}
