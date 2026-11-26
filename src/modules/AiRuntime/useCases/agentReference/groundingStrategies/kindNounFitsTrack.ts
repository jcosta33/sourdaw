import { type ProjectContext } from '../../../models/ProjectContext';
import { KIND_OBJECT } from '../protectionObjectForms';

/** Whether a track kind noun says what a track is: "track" and "channel" any track, "bus" and "return" a bus. */
export function kindNounFitsTrack(kindNoun: string, track: ProjectContext['tracks'][number]): boolean {
    const kind = KIND_OBJECT[kindNoun];
    return kind === 'track' || (kind === 'bus' && track.kind === 'bus');
}
