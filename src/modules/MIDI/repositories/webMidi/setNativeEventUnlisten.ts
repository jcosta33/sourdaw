import { webMidiRuntime } from './state';

export function setNativeEventUnlisten(fn: (() => void) | null): void {
    webMidiRuntime.nativeEventUnlisten = fn;
}
