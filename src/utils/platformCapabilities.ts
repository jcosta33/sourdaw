/**
 * Platform capabilities detection.
 *
 * Detects which features are available based on the runtime environment
 * (Tauri desktop app vs. plain browser). Views use these capabilities to
 * disable UI controls that require unavailable platform features, showing
 * an explanatory tooltip instead.
 */

import { isTauri } from './tauriRuntime';

export type PlatformCapabilities = {
    /** CLAP plugin hosting — Tauri only */
    readonly hasNativePlugins: boolean;
    /** Plugin directory scanning — Tauri only */
    readonly hasPluginScanning: boolean;
    /** MIDI input — Web MIDI API (Chrome) or Tauri native */
    readonly hasMidiInput: boolean;
    /** Voice command ASR — Tauri native (whisper-rs) or browser SpeechRecognition */
    readonly hasVoiceCommands: boolean;
    /** Native OS file save dialogs — Tauri only */
    readonly hasNativeFileDialogs: boolean;
    /** Multi-track simultaneous recording — Tauri only */
    readonly hasMultiTrackRecording: boolean;
    /** Whether we're running in the desktop app */
    readonly isDesktopApp: boolean;
};

const webMidiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

const speechRecognitionSupported =
    typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

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

    const isDesktop = isTauri();

    cached = {
        hasNativePlugins: isDesktop,
        hasPluginScanning: isDesktop,
        hasMidiInput: webMidiSupported || isDesktop,
        hasVoiceCommands: isDesktop || speechRecognitionSupported,
        hasNativeFileDialogs: isDesktop,
        hasMultiTrackRecording: isDesktop,
        isDesktopApp: isDesktop,
    };

    return cached;
}

// ── Tooltip reason messages ─────────────────────────────────────────────

export const DISABLED_REASONS = {
    nativePlugins: 'CLAP plugins require the desktop app',
    pluginScanning: 'Plugin scanning requires the desktop app',
    midiInput: 'MIDI input is not supported in this browser. Use Chrome or the desktop app',
    voiceCommands: 'Voice commands require the desktop app',
    multiTrackRecording: 'Multi-track recording requires the desktop app',
} as const;
