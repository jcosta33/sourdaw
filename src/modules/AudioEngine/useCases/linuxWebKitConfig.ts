/**
 * Linux WebKitGTK configuration notes and helpers.
 *
 * Tauri on Linux uses WebKitGTK. Key configurations:
 *
 * 1. getUserMedia permission: WebKitGTK requires a custom
 *    permission request handler; there's no prompt by default.
 *    → Handled in Rust via `webkit_web_view_set_permission_policy`
 *
 * 2. GStreamer: Required for Web Audio and media playback.
 *    AppImage should bundle GStreamer plugins or require system install.
 *
 * 3. Minimum version: WebKitGTK 2.40+ for AudioWorklet + SharedArrayBuffer.
 *
 * 4. GPU acceleration: Enable WebGL/WebGPU via GDK_GL=always.
 *
 * This file exports version checks and config helpers.
 */

/**
 * Check if WebKitGTK version is sufficient.
 * Safari/WebKit user agent contains version info.
 */
export function checkWebKitGTKVersion(): { ok: boolean; version: string } {
    const ua = navigator.userAgent;
    const match = ua.match(/WebKit\/(\d+\.\d+)/);
    if (!match) {
        return { ok: true, version: 'unknown (not WebKitGTK)' };
    }

    const version = parseFloat(match[1]!);
    // WebKit 615+ roughly corresponds to WebKitGTK 2.40+
    return {
        ok: version >= 615,
        version: `WebKit ${match[1]}`,
    };
}

/**
 * Check for AudioWorklet support (required for real-time audio).
 */
export function checkAudioWorkletSupport(): boolean {
    return typeof AudioWorkletNode !== 'undefined';
}

/**
 * Check for SharedArrayBuffer support (required for COOP/COEP).
 */
export function checkSharedArrayBufferSupport(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
}

/**
 * Run all Linux compatibility checks.
 */
export function runLinuxCompatibilityChecks(): {
    webkitVersion: { ok: boolean; version: string };
    audioWorklet: boolean;
    sharedArrayBuffer: boolean;
    webGpu: boolean;
    allPassed: boolean;
} {
    const webkitVersion = checkWebKitGTKVersion();
    const audioWorklet = checkAudioWorkletSupport();
    const sharedArrayBuffer = checkSharedArrayBufferSupport();
    const webGpu = 'gpu' in navigator;

    return {
        webkitVersion,
        audioWorklet,
        sharedArrayBuffer,
        webGpu,
        allPassed: webkitVersion.ok && audioWorklet && sharedArrayBuffer,
    };
}
