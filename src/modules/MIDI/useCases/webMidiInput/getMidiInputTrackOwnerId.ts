import { getTargetTrackOwnerId } from '../../repositories/webMidi/getTargetTrackOwnerId';

export function getMidiInputTrackOwnerId(): string | null {
    return getTargetTrackOwnerId();
}
