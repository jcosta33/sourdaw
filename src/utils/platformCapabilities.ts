/**
 * Platform capabilities detection.
 *
 * Detects which features are available based on the runtime environment
 * (desktop app vs. plain browser). Views use these capabilities to disable
 * UI controls that require unavailable platform features, showing an
 * explanatory tooltip instead.
 */

import { isDesktopRuntime } from './desktopRuntime';

export type PlatformCapabilities = {
    /** CLAP plugin hosting — desktop only */
    readonly hasNativePlugins: boolean;
    /** Plugin directory scanning — desktop only */
    readonly hasPluginScanning: boolean;
    /** Web MIDI entry point exists; access and devices are checked at runtime. */
    readonly webMidiApiPresent: boolean;
    /** A browser or native MIDI route can be attempted, not that it will succeed. */
    readonly hasMidiInput: boolean;
    /** Native OS file save dialogs — desktop only */
    readonly hasNativeFileDialogs: boolean;
    /** Multi-track simultaneous recording — desktop only */
    readonly hasMultiTrackRecording: boolean;
    /** Whether we're running in the desktop app */
    readonly isDesktopApp: boolean;
    /** Static capability gaps; runtime permission and device failures belong to their owners. */
    readonly degradations: readonly PlatformDegradation[];
};

export type PlatformDegradation = {
    readonly feature: 'midi-input';
    readonly reason: 'api-absent';
    readonly message: string;
};

let cached: PlatformCapabilities | null = null;

/**
 * Returns the current platform capabilities.
 *
 * The result is cached after the first call since platform features
 * do not change during a session.
 */
export function getPlatformCapabilities(): PlatformCapabilities {
    if (cached) {
        return cached;
    }

    const isDesktop = isDesktopRuntime();
    const webMidiApiPresent = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
    let degradations: readonly PlatformDegradation[] = [];
    if (!webMidiApiPresent && !isDesktop) {
        degradations = [{ feature: 'midi-input', reason: 'api-absent', message: DISABLED_REASONS.midiInput }];
    }

    cached = {
        hasNativePlugins: isDesktop,
        hasPluginScanning: isDesktop,
        webMidiApiPresent,
        hasMidiInput: webMidiApiPresent || isDesktop,
        hasNativeFileDialogs: isDesktop,
        hasMultiTrackRecording: isDesktop,
        isDesktopApp: isDesktop,
        degradations,
    };

    return cached;
}

// ── Tooltip reason messages ─────────────────────────────────────────────

export const DISABLED_REASONS = {
    nativePlugins: 'CLAP plugins require the desktop app',
    pluginScanning: 'Plugin scanning requires the desktop app',
    midiInput: 'MIDI input is not supported in this browser. Use Chrome or the desktop app',
    multiTrackRecording: 'Multi-track recording requires the desktop app',
} as const;
