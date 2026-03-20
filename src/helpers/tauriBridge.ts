/**
 * Shared Tauri bridge utilities.
 *
 * Uses static imports from @tauri-apps/api (v2) which Vite bundles.
 * At runtime, the Tauri webview provides __TAURI_INTERNALS__ automatically.
 *
 * All modules that need Tauri IPC should import from here instead of
 * duplicating invoke/listen wrappers.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen as tauriListenRaw } from '@tauri-apps/api/event';

/**
 * Whether we're running inside a Tauri webview.
 * Uses the official Tauri v2 internal marker.
 */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Invoke a Tauri command. Wrapper around the official @tauri-apps/api invoke.
 * Throws if called outside a Tauri webview.
 */
export async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    return invoke(cmd, args);
}

/**
 * Listen to a Tauri event. Returns an unlisten function.
 * Wrapper around the official @tauri-apps/api listen.
 */
export async function tauriListen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
    return tauriListenRaw(event, handler);
}

/**
 * Tauri IPC Channel for streaming data from Rust commands.
 *
 * The Channel class is exported from @tauri-apps/api/core at runtime,
 * but its type declarations don't resolve with moduleResolution: "bundler".
 * We re-export the runtime value here with a proper type annotation.
 */
export type TauriChannel<T> = {
    readonly id: number;
    onmessage: (response: T) => void;
    toJSON(): string;
};

/**
 * Create a new Tauri IPC Channel for receiving streamed events from Rust.
 *
 * Uses the Channel class from the Tauri runtime (available via the bundled
 * @tauri-apps/api/core module at runtime, even though TS declarations don't
 * resolve the named export with moduleResolution: "bundler").
 *
 * Usage:
 * ```ts
 * const channel = createChannel<MyEvent>();
 * channel.onmessage = (event) => { ... };
 * await tauriInvoke('my_command', { onEvent: channel });
 * ```
 */
export async function createChannel<T>(): Promise<TauriChannel<T>> {
    const mod = (await import('@tauri-apps/api/core')) as Record<string, unknown>;
    const ChannelClass = mod.Channel as new <U>() => TauriChannel<U>;
    return new ChannelClass<T>();
}
