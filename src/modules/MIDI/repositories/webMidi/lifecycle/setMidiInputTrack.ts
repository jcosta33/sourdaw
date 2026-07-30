import { setTargetTrackId } from '../setTargetTrackId';

export function setMidiInputTrack(trackId: string | null, ownerId: string | null = null): void {
    setTargetTrackId(trackId, ownerId);
}
