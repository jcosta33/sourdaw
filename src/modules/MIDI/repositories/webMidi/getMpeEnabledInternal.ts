import { webMidiRuntime } from './state';

export function getMpeEnabledInternal(): boolean {
    return webMidiRuntime.mpeEnabled;
}
