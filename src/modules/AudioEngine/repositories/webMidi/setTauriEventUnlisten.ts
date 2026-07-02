import { webMidiRuntime } from './state';

export function setTauriEventUnlisten(fn: (() => void) | null): void {
    webMidiRuntime.tauriEventUnlisten = fn;
}
