import { webMidiRuntime } from './state';

export function setMpeEnabledInternal(enabled: boolean): void {
    webMidiRuntime.mpeEnabled = enabled;
}
