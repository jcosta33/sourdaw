import { webMidiRuntime } from './state';

export function getNativeMode(): boolean {
    return webMidiRuntime.nativeMode;
}
