import { webMidiRuntime } from './state';

export function getTargetTrackRevision(): number {
    return webMidiRuntime.targetTrackRevision;
}
