import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';

export function getMidiInputTrack(): string | null {
    return getTargetTrackId();
}
