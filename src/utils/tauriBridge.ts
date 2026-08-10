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

type InvokeWithBinaryBodyInput = {
    command: string;
    bytes: Uint8Array;
    headers: Record<string, string>;
    maxBytes?: number;
};

type InvokeWithBinaryBodyOutput = Promise<void>;

/**
 * Invoke a command whose entire payload is a byte buffer.
 *
 * Tauri v2 only skips JSON when the invoke message *is* an ArrayBuffer or a
 * typed-array view (`tauri/scripts/process-ipc-message-fn.js`). Anything nested
 * inside an args object — including a bare `Uint8Array` — is run through
 * `JSON.stringify` with a replacer that calls `Array.from` on it, so every byte
 * becomes a decimal string plus a separator (~3.57x for high-entropy data).
 * Passing the buffer as the entire message keeps the payload at exactly its raw
 * byte length.
 *
 * Because the body is fully occupied, everything that addresses the payload (a
 * destination path, a plugin instance id) has to travel in `headers`. Header
 * values must be printable ASCII, so callers percent-encode them and Rust's
 * shared `binary_ipc` decoder validates and decodes them back to UTF-8.
 *
 * The bytes are sliced to the view window, so a `subarray` of a larger backing
 * buffer transfers only its own range.
 */
export async function invokeWithBinaryBody({
    command,
    bytes,
    headers,
    maxBytes,
}: InvokeWithBinaryBodyInput): InvokeWithBinaryBodyOutput {
    ensureBinaryPayloadSize({ command, size: bytes.byteLength, maxBytes });
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await invoke(command, body, { headers });
}

type InvokeForBinaryResponseInput = {
    command: string;
    args?: Record<string, unknown>;
    maxBytes?: number;
};

type InvokeForBinaryResponseOutput = Promise<Uint8Array>;

/**
 * Invoke a command that answers with a `tauri::ipc::Response`, which arrives as
 * an `ArrayBuffer` with no JSON in between.
 *
 * Only the response is binary — the request stays an ordinary JSON args object,
 * because a command that merely names what to read has nothing large to send.
 *
 * The `number[]` branch is retained because Tauri falls back to a JSON body
 * where raw bodies are unsupported (notably Android), and it keeps the helper
 * correct against the legacy `Vec<u8>`-returning command shapes.
 */
export async function invokeForBinaryResponse({
    command,
    args,
    maxBytes,
}: InvokeForBinaryResponseInput): InvokeForBinaryResponseOutput {
    const payload: unknown = await invoke(command, args);

    if (payload instanceof ArrayBuffer) {
        ensureBinaryPayloadSize({ command, size: payload.byteLength, maxBytes });
        return new Uint8Array(payload);
    }

    if (ArrayBuffer.isView(payload)) {
        ensureBinaryPayloadSize({ command, size: payload.byteLength, maxBytes });
        return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }

    if (Array.isArray(payload)) {
        const rawBytes: readonly unknown[] = payload;
        ensureBinaryPayloadSize({ command, size: rawBytes.length, maxBytes });
        const bytes = new Uint8Array(rawBytes.length);
        let index = 0;
        for (const rawByte of rawBytes) {
            if (typeof rawByte !== 'number' || !Number.isInteger(rawByte) || rawByte < 0 || rawByte > 255) {
                throw new TypeError(`${command} returned an invalid byte payload`);
            }
            bytes[index] = rawByte;
            index += 1;
        }
        return bytes;
    }

    throw new TypeError(`${command} returned an unsupported payload`);
}

type EnsureBinaryPayloadSizeInput = {
    command: string;
    size: number;
    maxBytes?: number;
};

function ensureBinaryPayloadSize({ command, size, maxBytes }: EnsureBinaryPayloadSizeInput): void {
    if (maxBytes !== undefined && size > maxBytes) {
        throw new RangeError(`${command} payload exceeds ${String(maxBytes)}-byte IPC limit`);
    }
}

/**
 * Header carrying the destination path for `write_file_bytes`.
 *
 * The raw-body IPC path requires the *whole* invoke message to be the buffer
 * (see `invokeWithBinaryBody`), so the path cannot ride along as a sibling field
 * and travels as a header instead, percent-encoded.
 */
const FILE_PATH_HEADER = 'x-sourdaw-path';
const MAX_FILE_IPC_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_PATH_BYTES = 4096;

type WriteFileBytesInput = {
    bytes: Uint8Array;
    path: string;
};

type WriteFileBytesOutput = Promise<void>;

/** Write raw bytes to a native file over Tauri's binary IPC path. */
export async function writeFileBytes({ bytes, path }: WriteFileBytesInput): WriteFileBytesOutput {
    ensureNativeFilePath(path);
    await invokeWithBinaryBody({
        command: 'write_file_bytes',
        bytes,
        headers: { [FILE_PATH_HEADER]: encodeURIComponent(path) },
        maxBytes: MAX_FILE_IPC_BYTES,
    });
}

type ReadFileBytesInput = {
    path: string;
};

type ReadFileBytesOutput = Promise<Uint8Array>;

/** Read a native file's bytes over Tauri's binary IPC path. */
export async function readFileBytes({ path }: ReadFileBytesInput): ReadFileBytesOutput {
    ensureNativeFilePath(path);
    return invokeForBinaryResponse({
        command: 'read_file_bytes',
        args: { path },
        maxBytes: MAX_FILE_IPC_BYTES,
    });
}

function ensureNativeFilePath(path: string): void {
    if (new TextEncoder().encode(path).byteLength > MAX_FILE_PATH_BYTES) {
        throw new RangeError(`Native file path exceeds ${String(MAX_FILE_PATH_BYTES)}-byte IPC limit`);
    }
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
