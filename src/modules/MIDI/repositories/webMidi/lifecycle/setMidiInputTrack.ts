import { setTargetTrackId } from '../setTargetTrackId';

export function setMidiInputTrack(trackId: string | null): void {
    setTargetTrackId(trackId);
}
