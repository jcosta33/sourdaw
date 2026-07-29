import { webMidiRuntime } from './state';

/**
 * Forget the mapping between the native MIDI clock and ours.
 *
 * Call on every port open. The origin midir counts from is platform-defined and
 * on some backends restarts with the port, so an anchor learned from the
 * previous port can be arbitrarily wrong for the next one.
 */
export function resetNativeMidiTimeAnchor(): void {
    webMidiRuntime.nativeMidiTimeAnchorMs = null;
}
