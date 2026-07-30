import { webMidiRuntime } from './state';

export function getTargetTrackOwnerId(): string | null {
    return webMidiRuntime.targetTrackOwnerId;
}
