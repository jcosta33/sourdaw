import { webMidiRuntime } from './state';

export function getTargetTrackId(): string | null {
    return webMidiRuntime.targetTrackId;
}
