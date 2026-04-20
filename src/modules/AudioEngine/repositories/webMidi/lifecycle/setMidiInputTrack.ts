import { setTargetTrackId } from '../state';

export function setMidiInputTrack(trackId: string): void {
    setTargetTrackId(trackId);
}
