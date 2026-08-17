/**
 * The main-process command router (REQ-004).
 *
 * One `ipcMain.handle` per exposed command, and nothing else. A denied command
 * has no channel, so refusing it is not a branch that could be got wrong — the
 * message has nowhere to arrive.
 *
 * The router is deliberately **opaque**: it forwards the renderer's argument
 * array to the addon method and never reads inside it. Payload validation stays
 * exactly where it is today — napi-rs typed deserialization at the addon
 * boundary rejects a malformed payload the same way serde did under Tauri — and
 * a router that re-validated would be a second, drifting definition of every
 * command's arguments.
 *
 * Two transport adaptations are the only things it does to a payload, and
 * neither reads a field:
 *
 * - A `Uint8Array` argument becomes a Node `Buffer`, because napi-rs's `Buffer`
 *   parameter rejects a plain typed array. Structured clone carries bytes as
 *   `Uint8Array` in both directions, so without this every byte-taking command
 *   would fail at the addon boundary with a type error.
 * - A stream id supplied beside the arguments becomes an extra trailing
 *   argument, which is where every streaming command declares its emitter.
 */
import { addonMethodName, commandChannel, EXPOSED_COMMANDS } from './commands.js';

import type { NativeHost } from './native.js';

/**
 * The slice of an `IpcMainInvokeEvent` the router reads.
 *
 * `senderFrame` is a getter that **throws** once the frame is gone — a renderer
 * that crashed or navigated between sending and being handled. That is the
 * ordinary case during a crash recovery, not an exceptional one, so it is read
 * defensively; an unhandled throw here would reject a request with a stack
 * trace instead of the origin refusal the caller can act on.
 */
export type SenderFrameCarrier = {
    readonly senderFrame?: { readonly url?: string } | null;
};

export type IpcMainLike = {
    handle: (channel: string, listener: (event: SenderFrameCarrier, ...args: readonly unknown[]) => unknown) => void;
};

/** The URL of the frame that sent an invoke, or `undefined` when it is gone. */
export const senderFrameUrl = (event: SenderFrameCarrier): string | undefined => {
    try {
        return event.senderFrame?.url;
    } catch {
        return undefined;
    }
};

/**
 * Wrap a handler so it refuses anything that is not the application's own frame.
 *
 * Every channel the shell registers goes through this — commands and the dialog
 * and path helpers alike. A frame reached through a navigation bug, or an
 * embedded document, must not be able to open a native save dialog any more
 * than it can invoke a command; one shared wrapper is what stops that from
 * being a rule that some handlers merely happen to follow.
 */
export const withTrustedSender =
    <Result>(
        name: string,
        isTrustedFrameUrl: (url: string | undefined) => boolean,
        handler: (...args: readonly unknown[]) => Result
    ) =>
    (event: SenderFrameCarrier, ...args: readonly unknown[]): Result => {
        if (!isTrustedFrameUrl(senderFrameUrl(event))) {
            throw new Error(`${name} rejected: the sender frame is not the application`);
        }
        return handler(...args);
    };

/**
 * Convert the renderer's arguments into what the addon accepts.
 *
 * Rejects a non-array outright. The preload always sends an array, so anything
 * else came from something that is not the preload, and forwarding it would
 * spread a string into character arguments.
 */
const isPositional = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/**
 * Narrow an IPC payload to the argument list the preload always sends.
 *
 * Shared with the channels that are not routed through the addon, so "not a
 * positional array" is one refusal with one message rather than a check each
 * handler repeats slightly differently.
 */
export const asPositionalArguments = (args: unknown): readonly unknown[] => {
    if (!isPositional(args)) {
        throw new TypeError('Command arguments must be a positional array');
    }
    return args;
};

export const toNativeArguments = (args: unknown): unknown[] =>
    asPositionalArguments(args).map((value) =>
        value instanceof Uint8Array && !Buffer.isBuffer(value)
            ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
            : value
    );

/**
 * One in-flight command stream, as the router needs it.
 *
 * `emit` is handed to the addon as the command's final argument; `failure` is
 * read after the command settles. An overflow cannot fail the addon call from
 * inside the callback — the Rust side reads the threadsafe function's *queue*
 * status, not what the JS callback returned or threw — so the failure is
 * recorded and turned into a rejection here, which is what the renderer needs
 * in order to treat the response as corrupt rather than short.
 */
export type CommandStream = {
    readonly emit: (payload: unknown) => void;
    readonly failure: () => string | undefined;
    readonly close: () => void;
};

export type RegisterCommandRouterInput = {
    readonly ipcMain: IpcMainLike;
    /** Resolved lazily: the host is built once the app is ready, after registration. */
    readonly native: () => NativeHost | undefined;
    /** Whether a sender frame's URL is the app itself. */
    readonly isTrustedFrameUrl: (url: string | undefined) => boolean;
    /** Build the bounded stream a streaming command emits into. */
    readonly createStream: (streamId: string) => CommandStream;
    /** Defaults to the full exposed surface; narrowed only by specs. */
    readonly commands?: readonly string[];
};

export const registerCommandRouter = ({
    ipcMain,
    native,
    isTrustedFrameUrl,
    createStream,
    commands = EXPOSED_COMMANDS,
}: RegisterCommandRouterInput): void => {
    for (const command of commands) {
        const method = addonMethodName(command);

        // The origin guard runs first, before anything touches the payload: a
        // frame that is not the app has no business reaching a native command,
        // whichever command it named.
        const handler = withTrustedSender(command, isTrustedFrameUrl, async (args, streamId) => {
            const host = native();
            if (host === undefined) {
                throw new Error(`${command} rejected: the native host is not available`);
            }
            const implementation = host[method];
            if (typeof implementation !== 'function') {
                throw new TypeError(`The native addon does not implement ${method}`);
            }

            const callArguments = toNativeArguments(args);
            if (streamId === undefined) {
                const plain: unknown = await Reflect.apply(implementation, host, callArguments);
                return plain;
            }
            if (typeof streamId !== 'string') {
                throw new TypeError(`${command} was given a non-string stream id`);
            }

            const stream = createStream(streamId);
            callArguments.push(stream.emit);
            try {
                const result: unknown = await Reflect.apply(implementation, host, callArguments);
                const failure = stream.failure();
                if (failure !== undefined) {
                    throw new Error(`${command} failed: ${failure}`);
                }
                return result;
            } finally {
                stream.close();
            }
        });

        ipcMain.handle(commandChannel(command), handler);
    }
};
