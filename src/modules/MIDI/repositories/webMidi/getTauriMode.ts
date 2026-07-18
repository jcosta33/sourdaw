import { webMidiRuntime } from './state';

export function getTauriMode(): boolean {
    return webMidiRuntime.tauriMode;
}
