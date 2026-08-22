/**
 * The renderer's single desktop IPC seam.
 *
 * Every export answers from the Electron bridge (`window.sourdaw`, published
 * by the preload). All modules that need desktop IPC should import from here
 * instead of duplicating invoke/listen wrappers.
 *
 * ## Argument shape
 *
 * Callers pass named records; `window.sourdaw.invoke` takes a positional
 * array in the addon's own parameter order. The seam orders the names by
 * `SOURDAW_COMMAND_ARGUMENTS` — the table `electron/__tests__/
 * commands.spec.ts` proves equal to the addon's `#[napi]` signatures — so a
 * call site never has to know the addon's parameter order.
 */

import { isDesktopRuntime, isSourdawRuntime } from './desktopRuntime';
import { SOURDAW_COMMAND_ARGUMENTS } from './sourdawCommandArguments';

export { isDesktopRuntime, isSourdawRuntime };

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
 * Marks a channel handed out by `createChannel`, so `desktopInvoke` can
 * recognize one among a call's arguments and route the call through `stream`
 * instead of `invoke`.
 */
const seamChannelTag = Symbol('sourdaw-stream-channel');

type SeamStreamChannel = DesktopChannel<unknown> & { readonly [seamChannelTag]: true };

const isSeamChannel = (value: unknown): value is SeamStreamChannel =>
    typeof value === 'object' && value !== null && seamChannelTag in value;

/**
 * Invoke a desktop command. Takes named arguments; the seam orders them
 * positionally for the addon.
 */
export async function desktopInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    const named = args ?? {};
    const channelEntries = Object.entries(named).filter((entry): entry is [string, SeamStreamChannel] =>
        isSeamChannel(entry[1])
    );
    if (channelEntries.length > 1) {
        throw new Error(`${cmd} carries more than one event channel`);
    }
    const channelEntry = channelEntries[0];
    const plain =
        channelEntry === undefined
            ? named
            : Object.fromEntries(Object.entries(named).filter(([key]) => key !== channelEntry[0]));
    const positional = toPositionalArguments(cmd, plain);

    if (channelEntry !== undefined) {
        const [, channel] = channelEntry;
        // Dispatch through the channel's *current* handler: callers assign
        // `onmessage` after creating the channel.
        return sourdawBridge().stream(cmd, positional, (payload) => {
            channel.onmessage(payload);
        });
    }

    const lastIndex = positional.length - 1;
    if (positional.some((value, index) => isByteView(value) && index !== lastIndex)) {
        throw new TypeError(`${cmd} may carry bytes only as its final argument`);
    }
    const last = positional[lastIndex];
    if (last instanceof Uint8Array) {
        // The bridge's JSON path refuses buffers; a trailing byte payload is
        // exactly the `invokeBinary` shape.
        return sourdawBridge().invokeBinary(cmd, positional.slice(0, -1), last);
    }
    return sourdawBridge().invoke(cmd, positional);
}

/**
 * Listen to a desktop event. Returns an unlisten function.
 *
 * The handler receives the envelope shape `{ event, payload }` — the bridge
 * pushes the bare payload and the seam wraps it, because every consumer
 * unwraps `.payload`.
 */
export async function desktopListen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
    return sourdawBridge().listen(event, (payload) => {
        handler({ event, payload });
    });
}

/** Start microphone capture through the preload's one-use voice-control capability. */
export async function desktopStartVoiceDictation(sessionId: string): Promise<string> {
    return sourdawBridge().voiceDictation.start(sessionId);
}

/** Stop capture for one acknowledged dictation session and begin local transcription. */
export async function desktopStopVoiceDictation(sessionId: string): Promise<void> {
    await sourdawBridge().voiceDictation.stop(sessionId);
}

/** Cancel one session, discard its capture, and suppress its transcript. */
export async function desktopCancelVoiceDictation(sessionId: string): Promise<void> {
    await sourdawBridge().voiceDictation.cancel(sessionId);
}

/** Subscribe to one opaque dictation session's terminal payload outside the generic event bus. */
export function desktopListenVoiceDictationTerminal(
    sessionId: string,
    handler: (event: string, payload: unknown) => void
): () => void {
    return sourdawBridge().voiceDictation.listenTerminal(sessionId, (event, payload) => {
        handler(event, { event, payload });
    });
}

type InvokeWithBinaryBodyInput = {
    command: string;
    bytes: Uint8Array;
    /** The command's positional arguments preceding its byte payload. */
    positionalMeta?: readonly unknown[];
    maxBytes?: number;
};

type InvokeWithBinaryBodyOutput = Promise<void>;

/**
 * Invoke a command whose entire payload is a byte buffer, keeping the payload
 * at exactly its raw byte length — the bridge's JSON path would refuse it.
 *
 * The bytes are sliced to the view window, so a `subarray` of a larger backing
 * buffer transfers only its own range: structured clone would otherwise
 * serialize the whole backing buffer behind a narrow view.
 */
export async function invokeWithBinaryBody({
    command,
    bytes,
    positionalMeta = [],
    maxBytes,
}: InvokeWithBinaryBodyInput): InvokeWithBinaryBodyOutput {
    ensureBinaryPayloadSize({ command, size: bytes.byteLength, maxBytes });
    const viewIsWholeBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
    const payload = viewIsWholeBuffer ? bytes : bytes.slice();
    await sourdawBridge().invokeBinary(command, positionalMeta, payload);
}

type InvokeForBinaryResponseInput = {
    command: string;
    args?: Record<string, unknown>;
    maxBytes?: number;
};

type InvokeForBinaryResponseOutput = Promise<Uint8Array>;

/**
 * Invoke a command that answers with a raw byte payload. The bridge
 * guarantees a `Uint8Array` at its own boundary; only the response is binary —
 * the request stays an ordinary args object, because a command that merely
 * names what to read has nothing large to send.
 */
export async function invokeForBinaryResponse({
    command,
    args,
    maxBytes,
}: InvokeForBinaryResponseInput): InvokeForBinaryResponseOutput {
    const bytes = await sourdawBridge().invokeBinaryResponse(command, toPositionalArguments(command, args));
    ensureBinaryPayloadSize({ command, size: bytes.byteLength, maxBytes });
    return bytes;
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

/** IPC channel for streaming data from native commands. */
export type DesktopChannel<Payload> = {
    readonly id: number;
    onmessage: (response: Payload) => void;
    toJSON(): string;
};

/**
 * Create an IPC channel for receiving streamed events from a desktop command.
 *
 * Passing it as an argument to `desktopInvoke` routes the call through
 * `stream`, and every streamed event is dispatched to whatever `onmessage`
 * holds at delivery time.
 *
 * Usage:
 * ```ts
 * const channel = await createChannel<MyEvent>();
 * channel.onmessage = (event) => { ... };
 * await desktopInvoke('my_command', { onEvent: channel });
 * ```
 */
export async function createChannel<Payload>(): Promise<DesktopChannel<Payload>> {
    const channel: DesktopChannel<Payload> & { readonly [seamChannelTag]: true } = {
        id: -1,
        onmessage: () => undefined,
        toJSON: () => 'sourdaw-stream-channel',
        [seamChannelTag]: true,
    };
    return channel;
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
    return sourdawBridge().dialog.open(options);
}

/** Open a native save dialog. Resolves `null` when the user cancels. */
export async function desktopSaveDialog(options: DesktopSaveDialogOptions = {}): Promise<string | null> {
    return sourdawBridge().dialog.save(options);
}

/** OS-correct filesystem path join, for paths handed back to native commands. */
export async function desktopPathJoin(...segments: string[]): Promise<string> {
    return sourdawBridge().paths.join(...segments);
}

/** Base URL the bundled sample content is reachable at from the renderer. */
export async function desktopSamplesBaseUrl(): Promise<string> {
    return sourdawBridge().paths.samplesBase();
}

/** The platform the desktop shell runs on, or null off-desktop. */
export function desktopPlatform(): string | null {
    if (!isDesktopRuntime()) {
        return null;
    }
    return sourdawBridge().platform;
}

/** The frameless window chrome's controls. Only meaningful on the Linux desktop build. */
export function desktopWindowControls(): SourdawDesktopBridge['windowControls'] {
    return sourdawBridge().windowControls;
}

/**
 * True on the Linux desktop build, where the shell window is frameless and the
 * app draws its own minimize/maximize/close in the header. macOS chrome comes
 * from the window-controls overlay; every other platform keeps the native
 * frame.
 */
export function usesFramelessWindowChrome(): boolean {
    return isDesktopRuntime() && desktopPlatform() === 'linux';
}
