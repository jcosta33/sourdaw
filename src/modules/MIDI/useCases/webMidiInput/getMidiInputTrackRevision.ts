import { getTargetTrackRevision } from '../../repositories/webMidi/getTargetTrackRevision';

export function getMidiInputTrackRevision(): number {
    return getTargetTrackRevision();
}
