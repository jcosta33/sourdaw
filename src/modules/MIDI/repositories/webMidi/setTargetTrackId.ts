import { webMidiRuntime } from './state';

export function setTargetTrackId(id: string | null, ownerId: string | null = null): void {
    webMidiRuntime.targetTrackId = id;
    webMidiRuntime.targetTrackOwnerId = ownerId;
    webMidiRuntime.targetTrackRevision += 1;
}
