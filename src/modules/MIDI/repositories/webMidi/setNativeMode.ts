import { webMidiRuntime } from './state';

export function setNativeMode(enabled: boolean): void {
    webMidiRuntime.nativeMode = enabled;
}
