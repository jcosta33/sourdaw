import { webMidiRuntime } from './state';

export function setTauriMode(enabled: boolean): void {
    webMidiRuntime.tauriMode = enabled;
}
