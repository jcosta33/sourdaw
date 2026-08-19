import { webMidiRuntime } from './state';

export function getNativeEventUnlisten(): (() => void) | null {
    return webMidiRuntime.nativeEventUnlisten;
}
