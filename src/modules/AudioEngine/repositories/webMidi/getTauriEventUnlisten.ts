import { webMidiRuntime } from './state';

export function getTauriEventUnlisten(): (() => void) | null {
    return webMidiRuntime.tauriEventUnlisten;
}
