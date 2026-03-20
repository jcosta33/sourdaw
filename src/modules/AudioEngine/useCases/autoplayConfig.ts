/**
 * Autoplay and media configuration for Tauri/Wry.
 * This module provides helpers for configuring the webview to allow
 * autoplay of audio without user gesture requirements.
 *
 * For Tauri v2, these are typically configured in the Rust side:
 * - `with_autoplay(true)` on the webview builder
 * - CSP headers allowing media-src
 *
 * For web builds, this provides a one-time resume on user interaction.
 */

/**
 * Resume AudioContext on first user interaction.
 * Browsers block autoplay until a user gesture occurs.
 */
export function setupAutoplayResume(ctx: AudioContext): void {
    if (ctx.state === 'running') {
        return;
    }

    const resume = (): void => {
        if (ctx.state === 'suspended') {
            void ctx.resume();
        }
        document.removeEventListener('click', resume);
        document.removeEventListener('keydown', resume);
        document.removeEventListener('touchstart', resume);
    };

    document.addEventListener('click', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
    document.addEventListener('touchstart', resume, { once: true });
}

/**
 * Check if running inside Tauri (autoplay should be pre-configured).
 */
export function isTauriEnvironment(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Initialize audio autoplay based on environment.
 * In Tauri: autoplay is handled by Wry configuration.
 * In browser: sets up gesture-based resume.
 */
export function initializeAutoplay(ctx: AudioContext): void {
    if (isTauriEnvironment()) {
        // Tauri with autoplay enabled — just ensure context is running
        if (ctx.state === 'suspended') {
            void ctx.resume();
        }
    } else {
        // Web browser fallback — resume on first interaction
        setupAutoplayResume(ctx);
    }
}
