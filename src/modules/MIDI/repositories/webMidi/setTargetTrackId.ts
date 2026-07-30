import { webMidiRuntime } from './state';

export function setTargetTrackId(id: string | null): void {
    webMidiRuntime.targetTrackId = id;
    webMidiRuntime.targetTrackRevision += 1;
}
