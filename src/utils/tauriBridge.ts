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

import { isTauri } from './tauriRuntime';

export { isTauri };

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
 * Header carrying the destination path for `write_file_bytes`.
 *
 * The raw-body IPC path requires the *whole* invoke message to be the buffer
 * (see `writeFileBytes`), so the path cannot ride along as a sibling field and
 * travels as a header instead. Header values must be printable ASCII, so the
 * path is percent-encoded; Rust decodes it back to UTF-8.
 */
const FILE_PATH_HEADER = 'x-sourdaw-path';

type WriteFileBytesInput = {
    bytes: Uint8Array;
    path: string;
};

type WriteFileBytesOutput = Promise<void>;

/**
 * Write raw bytes to a native file over Tauri's binary IPC path.
 *
 * Tauri v2 only skips JSON when the invoke message *is* an ArrayBuffer or a
 * typed-array view (`tauri/scripts/process-ipc-message-fn.js`). Anything nested
 * inside an args object — including a bare `Uint8Array` — is run through
 * `JSON.stringify` with a replacer that calls `Array.from` on it, so every byte
 * becomes a decimal string plus a separator. Passing the buffer as the entire
 * message keeps a multi-megabyte export at exactly its raw byte length.
 *
 * The bytes are sliced to the view window, so a `subarray` of a larger backing
 * buffer transfers only its own range.
 */
export async function writeFileBytes({ bytes, path }: WriteFileBytesInput): WriteFileBytesOutput {
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await invoke('write_file_bytes', body, {
        headers: { [FILE_PATH_HEADER]: encodeURIComponent(path) },
    });
}

type ReadFileBytesInput = {
    path: string;
};

type ReadFileBytesOutput = Promise<Uint8Array>;

/**
 * Read a native file's bytes over Tauri's binary IPC path.
 *
 * `read_file_bytes` returns a `tauri::ipc::Response`, which arrives as an
 * `ArrayBuffer` with no JSON in between. The `number[]` branch is retained
 * because Tauri falls back to a JSON body where raw bodies are unsupported
 * (notably Android), and it keeps the helper correct against the legacy
 * `read_audio_file` shape.
 */
export async function readFileBytes({ path }: ReadFileBytesInput): ReadFileBytesOutput {
    const payload: unknown = await invoke('read_file_bytes', { path });

    if (payload instanceof ArrayBuffer) {
        return new Uint8Array(payload);
    }

    if (ArrayBuffer.isView(payload)) {
        return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }

    if (Array.isArray(payload)) {
        const rawBytes: readonly unknown[] = payload;
        const bytes = new Uint8Array(rawBytes.length);
        let index = 0;
        for (const rawByte of rawBytes) {
            if (typeof rawByte !== 'number' || !Number.isInteger(rawByte) || rawByte < 0 || rawByte > 255) {
                throw new TypeError('read_file_bytes returned an invalid byte payload');
            }
            bytes[index] = rawByte;
            index += 1;
        }
        return bytes;
    }

    throw new TypeError('read_file_bytes returned an unsupported payload');
}

/**
 * Tauri IPC Channel for streaming data from Rust commands.
 *
 * The Channel class is exported from @tauri-apps/api/core at runtime,
 * but its type declarations don't resolve with moduleResolution: "bundler".
 * We re-export the runtime value here with a proper type annotation.
 */
export type TauriChannel<Payload> = {
    readonly id: number;
    onmessage: (response: Payload) => void;
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
export async function createChannel<Payload>(): Promise<TauriChannel<Payload>> {
    const mod = (await import('@tauri-apps/api/core')) as Record<string, unknown>;
    const ChannelClass = mod.Channel as new <Payload>() => TauriChannel<Payload>;
    return new ChannelClass<Payload>();
}
