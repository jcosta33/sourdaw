import { webMidiRuntime } from './state';

export function getMpeEnabled(): boolean {
    return webMidiRuntime.mpeEnabled;
}
