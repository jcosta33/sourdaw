/**
 * The renderer's single desktop IPC seam.
 *
 * Every export answers from whichever backend is present, probed in a fixed
 * order: the Electron bridge (`window.sourdaw`, published by the preload)
 * first, then the Tauri webview via static `@tauri-apps/api` (v2) imports that
 * Vite bundles. The two runtimes never coexist, but the order is still law —
 * it is what makes the Electron shell win without a Tauri global in sight.
 *
 * All modules that need desktop IPC should import from here instead of
 * duplicating invoke/listen wrappers.
 *
 * ## Argument shape across the two backends
 *
 * Callers pass Tauri-style named records; `window.sourdaw.invoke` takes a
 * positional array in the addon's own parameter order. The seam orders the
 * names by `SOURDAW_COMMAND_ARGUMENTS` — the table `electron/__tests__/
 * commands.spec.ts` proves equal to the addon's `#[napi]` signatures — so a
 * call site never has to know which backend it is speaking to.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen as tauriListenRaw } from '@tauri-apps/api/event';

import { SOURDAW_COMMAND_ARGUMENTS } from './sourdawCommandArguments';
import { isDesktopRuntime, isSourdawRuntime, isTauri } from './tauriRuntime';

export { isDesktopRuntime, isSourdawRuntime, isTauri };

const sourdawBridge = (): SourdawDesktopBridge => {
    const bridge = (window as Window & { readonly sourdaw?: SourdawDesktopBridge }).sourdaw;
    if (bridge === undefined) {
        throw new Error('Sourdaw desktop bridge is not available');
    }
    return bridge;
};

const snakeToCamel = (parameter: string): string =>
    parameter.replaceAll(/_([a-z0-9])/gu, (_match, first: string) => first.toUpperCase());

const isByteView = (value: unknown): boolean => ArrayBuffer.isView(value) || value instanceof ArrayBuffer;

/**
 * Order a named argument record into the positional array the Electron bridge
 * takes. Refuses an unmapped command and an unknown argument name outright: a
 * silently dropped argument would cross the addon boundary as `undefined` and
 * surface far from the misspelling that caused it.
 */
const toPositionalArguments = (command: string, args: Record<string, unknown> | undefined): unknown[] => {
    const parameters = SOURDAW_COMMAND_ARGUMENTS.get(command);
    if (parameters === undefined) {
        throw new Error(`${command} has no positional-argument mapping`);
    }
    const named = args ?? {};
    const knownKeys = new Set(parameters.map((parameter) => snakeToCamel(parameter)));
    for (const key of Object.keys(named)) {
        if (!knownKeys.has(key)) {
            throw new Error(`${command} does not take an argument named ${key}`);
        }
    }
    return parameters.map((parameter) => named[snakeToCamel(parameter)]);
};

/**
 * Marks a channel handed out by `createChannel` under the Electron bridge, so
 * `tauriInvoke` can recognize one among a call's arguments and route the call
 * through `stream` instead of `invoke`.
 */
const seamChannelTag = Symbol('sourdaw-stream-channel');

type SeamStreamChannel = TauriChannel<unknown> & { readonly [seamChannelTag]: true };

const isSeamChannel = (value: unknown): value is SeamStreamChannel =>
    typeof value === 'object' && value !== null && seamChannelTag in value;

const sourdawCommandInvoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    const named = args ?? {};
    const channelEntries = Object.entries(named).filter((entry): entry is [string, SeamStreamChannel] =>
        isSeamChannel(entry[1])
    );
    if (channelEntries.length > 1) {
        throw new Error(`${command} carries more than one event channel`);
    }
    const channelEntry = channelEntries[0];
    const plain =
        channelEntry === undefined
            ? named
            : Object.fromEntries(Object.entries(named).filter(([key]) => key !== channelEntry[0]));
    const positional = toPositionalArguments(command, plain);

    if (channelEntry !== undefined) {
        const [, channel] = channelEntry;
        // Dispatch through the channel's *current* handler: callers assign
        // `onmessage` after creating the channel, exactly as under Tauri.
        return sourdawBridge().stream(command, positional, (payload) => {
            channel.onmessage(payload);
        });
    }

    const lastIndex = positional.length - 1;
    if (positional.some((value, index) => isByteView(value) && index !== lastIndex)) {
        throw new TypeError(`${command} may carry bytes only as its final argument`);
    }
    const last = positional[lastIndex];
    if (last instanceof Uint8Array) {
        // The bridge's JSON path refuses buffers; a trailing byte payload is
        // exactly the `invokeBinary` shape.
        return sourdawBridge().invokeBinary(command, positional.slice(0, -1), last);
    }
    return sourdawBridge().invoke(command, positional);
};

/**
 * Invoke a desktop command. Takes Tauri-style named arguments on both
 * backends; under the Electron bridge the seam orders them positionally.
 */
export async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    if (isSourdawRuntime()) {
        return sourdawCommandInvoke(cmd, args);
    }
    return invoke(cmd, args);
}

/**
 * Listen to a desktop event. Returns an unlisten function.
 *
 * Both backends deliver the Tauri envelope shape `{ event, payload }` to the
 * handler: Tauri natively, the Electron bridge (which pushes the bare payload)
 * wrapped here — every existing consumer unwraps `.payload`.
 */
export async function tauriListen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
    if (isSourdawRuntime()) {
        return sourdawBridge().listen(event, (payload) => {
            handler({ event, payload });
        });
    }
    return tauriListenRaw(event, handler);
}

type InvokeWithBinaryBodyInput = {
    command: string;
    bytes: Uint8Array;
    headers: Record<string, string>;
    /**
     * The command's positional arguments preceding its byte payload, for the
     * Electron bridge path. Tauri cannot carry them beside a raw body — that
     * is what `headers` exists for — so callers with addressing metadata pass
     * it in both forms.
     */
    positionalMeta?: readonly unknown[];
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
 * buffer transfers only its own range. The Electron branch keeps that
 * property: structured clone would otherwise serialize the whole backing
 * buffer behind a narrow view.
 */
export async function invokeWithBinaryBody({
    command,
    bytes,
    headers,
    positionalMeta = [],
    maxBytes,
}: InvokeWithBinaryBodyInput): InvokeWithBinaryBodyOutput {
    ensureBinaryPayloadSize({ command, size: bytes.byteLength, maxBytes });
    if (isSourdawRuntime()) {
        const viewIsWholeBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
        const payload = viewIsWholeBuffer ? bytes : bytes.slice();
        await sourdawBridge().invokeBinary(command, positionalMeta, payload);
        return;
    }
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
 * Invoke a command that answers with a raw byte payload.
 *
 * Under Tauri that is a `tauri::ipc::Response`, which arrives as an
 * `ArrayBuffer` with no JSON in between; the Electron bridge guarantees a
 * `Uint8Array` at its own boundary. Only the response is binary — the request
 * stays an ordinary args object, because a command that merely names what to
 * read has nothing large to send.
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
    if (isSourdawRuntime()) {
        const bytes = await sourdawBridge().invokeBinaryResponse(command, toPositionalArguments(command, args));
        ensureBinaryPayloadSize({ command, size: bytes.byteLength, maxBytes });
        return bytes;
    }

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

/** Write raw bytes to a native file over the desktop binary IPC path. */
export async function writeFileBytes({ bytes, path }: WriteFileBytesInput): WriteFileBytesOutput {
    ensureNativeFilePath(path);
    await invokeWithBinaryBody({
        command: 'write_file_bytes',
        bytes,
        headers: { [FILE_PATH_HEADER]: encodeURIComponent(path) },
        positionalMeta: [path],
        maxBytes: MAX_FILE_IPC_BYTES,
    });
}

type ReadFileBytesInput = {
    path: string;
};

type ReadFileBytesOutput = Promise<Uint8Array>;

/** Read a native file's bytes over the desktop binary IPC path. */
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
 * Create an IPC channel for receiving streamed events from a desktop command.
 *
 * Under Tauri this is the runtime's own `Channel` class (available via the
 * bundled @tauri-apps/api/core module at runtime, even though TS declarations
 * don't resolve the named export with moduleResolution: "bundler"). Under the
 * Electron bridge it is a seam-local stand-in: passing it as an argument to
 * `tauriInvoke` routes the call through `stream`, and every streamed event is
 * dispatched to whatever `onmessage` holds at delivery time.
 *
 * Usage:
 * ```ts
 * const channel = createChannel<MyEvent>();
 * channel.onmessage = (event) => { ... };
 * await tauriInvoke('my_command', { onEvent: channel });
 * ```
 */
export async function createChannel<Payload>(): Promise<TauriChannel<Payload>> {
    if (isSourdawRuntime()) {
        const channel: TauriChannel<Payload> & { readonly [seamChannelTag]: true } = {
            id: -1,
            onmessage: () => undefined,
            toJSON: () => 'sourdaw-stream-channel',
            [seamChannelTag]: true,
        };
        return channel;
    }
    const mod = (await import('@tauri-apps/api/core')) as Record<string, unknown>;
    const ChannelClass = mod.Channel as new <Payload>() => TauriChannel<Payload>;
    return new ChannelClass<Payload>();
}

export type DesktopDialogFilter = {
    name: string;
    extensions: string[];
};

export type DesktopOpenDialogOptions = {
    multiple?: boolean;
    directory?: boolean;
    filters?: DesktopDialogFilter[];
    defaultPath?: string;
    title?: string;
};

export type DesktopSaveDialogOptions = {
    defaultPath?: string;
    filters?: DesktopDialogFilter[];
    title?: string;
};

/**
 * Open a native file/folder picker. Only meaningful on desktop; callers gate
 * on their own capability probes before asking.
 */
export async function desktopOpenDialog(options: DesktopOpenDialogOptions = {}): Promise<string | string[] | null> {
    if (isSourdawRuntime()) {
        return sourdawBridge().dialog.open(options);
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    return open(options);
}

/** Open a native save dialog. Resolves `null` when the user cancels. */
export async function desktopSaveDialog(options: DesktopSaveDialogOptions = {}): Promise<string | null> {
    if (isSourdawRuntime()) {
        return sourdawBridge().dialog.save(options);
    }
    const { save } = await import('@tauri-apps/plugin-dialog');
    return save(options);
}

/** OS-correct filesystem path join, for paths handed back to native commands. */
export async function desktopPathJoin(...segments: string[]): Promise<string> {
    if (isSourdawRuntime()) {
        return sourdawBridge().paths.join(...segments);
    }
    const { join } = await import('@tauri-apps/api/path');
    return join(...segments);
}

/**
 * Base URL the bundled sample content is reachable at from the renderer.
 * Electron-bridge only: the Tauri equivalent is per-resource
 * (`resolveResource` + `convertFileSrc`) and lives with its caller.
 */
export async function desktopSamplesBaseUrl(): Promise<string> {
    if (!isSourdawRuntime()) {
        throw new Error('desktopSamplesBaseUrl requires the Sourdaw bridge');
    }
    return sourdawBridge().paths.samplesBase();
}
