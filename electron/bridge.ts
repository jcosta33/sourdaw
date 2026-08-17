/**
 * The renderer-side half of the IPC layer, as a pure factory (REQ-004, REQ-006).
 *
 * `preload.ts` is four lines: it takes `ipcRenderer` and hands the object this
 * builds to `contextBridge`. Everything with behaviour lives here so it can be
 * exercised against a fake `ipcRenderer` — a preload that can only be tested by
 * booting Electron is a preload that is not tested.
 *
 * Two properties are enforced on this side as well as in main, and both matter:
 *
 * - A command outside `EXPOSED_COMMANDS` is refused before any IPC happens, so
 *   a denied command has no preload path at all — not a path that reaches a
 *   handler which then says no.
 * - Bytes never go down the JSON path. `invoke` refuses a buffer outright
 *   rather than letting one through to be serialized as a number array, which
 *   is a silent ~3.57x size penalty on exactly the payloads (plugin state,
 *   audio) that are already the largest thing the shell moves.
 */
import {
    DIALOG_MESSAGE_CHANNEL,
    DIALOG_OPEN_CHANNEL,
    DIALOG_SAVE_CHANNEL,
    EVENT_CHANNEL,
    PATHS_JOIN_CHANNEL,
    PATHS_SAMPLES_BASE_CHANNEL,
    STREAM_CHANNEL,
    type SourdawBridge,
} from './channels.js';
import { commandChannel, isExposedCommand } from './commands.js';

/** The slice of Electron's `ipcRenderer` this bridge uses. */
export type RendererIpc = {
    invoke: (channel: string, ...args: readonly unknown[]) => Promise<unknown>;
    on: (channel: string, listener: (event: unknown, ...args: readonly unknown[]) => void) => void;
};

const rejectUnknownCommand = (command: string): void => {
    if (!isExposedCommand(command)) {
        throw new Error(`Unknown or denied Sourdaw command: ${command}`);
    }
};

const isBytes = (value: unknown): boolean => ArrayBuffer.isView(value) || value instanceof ArrayBuffer;

/**
 * Coerce whatever a byte-returning command answered with into a `Uint8Array`.
 *
 * A `Buffer` from the addon arrives as a `Uint8Array` view over its own memory,
 * and that is the fast path. Anything else is a wire-shape change that has to
 * fail loudly here rather than be handed to the caller as a wrong-typed value.
 */
const asBytes = (command: string, payload: unknown): Uint8Array => {
    if (payload instanceof Uint8Array) {
        return payload;
    }
    if (payload instanceof ArrayBuffer) {
        return new Uint8Array(payload);
    }
    throw new TypeError(`${command} returned an unsupported payload`);
};

/**
 * Build the object published at `window.sourdaw`.
 *
 * The event and stream fan-in each use exactly one `ipcRenderer` listener for
 * the whole process, dispatching by name from a map. Registering one per
 * subscription instead would grow with every hook mount and trip Node's
 * max-listener warning during ordinary use.
 */
export const createSourdawBridge = (ipc: RendererIpc): SourdawBridge => {
    const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
    const streamListeners = new Map<string, (payload: unknown) => void>();
    let nextStreamId = 0;

    ipc.on(EVENT_CHANNEL, (_event, ...args) => {
        const [name, payload] = args;
        if (typeof name !== 'string') {
            return;
        }
        const listeners = eventListeners.get(name);
        if (listeners === undefined) {
            return;
        }
        // Iterate a copy: a listener that unsubscribes itself — which the
        // one-shot analysis-progress subscriptions do — would otherwise mutate
        // the set mid-iteration.
        for (const listener of [...listeners]) {
            listener(payload);
        }
    });

    ipc.on(STREAM_CHANNEL, (_event, ...args) => {
        const [streamId, payload] = args;
        if (typeof streamId !== 'string') {
            return;
        }
        streamListeners.get(streamId)?.(payload);
    });

    return {
        invoke: async (command, args = []) => {
            rejectUnknownCommand(command);
            if (args.some(isBytes)) {
                throw new TypeError(`${command} carries bytes; use invokeBinary`);
            }
            return ipc.invoke(commandChannel(command), args);
        },

        invokeBinary: async (command, meta, bytes) => {
            rejectUnknownCommand(command);
            if (!(bytes instanceof Uint8Array)) {
                throw new TypeError(`${command} expects a Uint8Array payload`);
            }
            if (meta.some(isBytes)) {
                throw new TypeError(`${command} may carry only one byte payload, as its last argument`);
            }
            await ipc.invoke(commandChannel(command), [...meta, bytes]);
        },

        invokeBinaryResponse: async (command, args = []) => {
            rejectUnknownCommand(command);
            return asBytes(command, await ipc.invoke(commandChannel(command), args));
        },

        listen: (event, callback) => {
            const listeners = eventListeners.get(event) ?? new Set<(payload: unknown) => void>();
            listeners.add(callback);
            eventListeners.set(event, listeners);
            return () => {
                listeners.delete(callback);
                if (listeners.size === 0) {
                    eventListeners.delete(event);
                }
            };
        },

        stream: async (command, args, onEvent) => {
            rejectUnknownCommand(command);
            const streamId = `${String(nextStreamId)}`;
            nextStreamId += 1;
            streamListeners.set(streamId, onEvent);
            try {
                // The stream id travels beside the arguments, never inside
                // them: the router appends its own emitter to the argument
                // list and must not have to look through the payload to find a
                // marker.
                return await ipc.invoke(commandChannel(command), args, streamId);
            } finally {
                streamListeners.delete(streamId);
            }
        },

        dialog: {
            open: async (options) => {
                const result = await ipc.invoke(DIALOG_OPEN_CHANNEL, options);
                if (result === null || typeof result === 'string') {
                    return result;
                }
                if (Array.isArray(result) && result.every((entry) => typeof entry === 'string')) {
                    return result;
                }
                throw new TypeError('The open dialog returned an unsupported payload');
            },
            save: async (options) => {
                const result = await ipc.invoke(DIALOG_SAVE_CHANNEL, options);
                if (result === null || typeof result === 'string') {
                    return result;
                }
                throw new TypeError('The save dialog returned an unsupported payload');
            },
            message: async (options) => {
                await ipc.invoke(DIALOG_MESSAGE_CHANNEL, options);
            },
        },

        paths: {
            samplesBase: async () => {
                const result = await ipc.invoke(PATHS_SAMPLES_BASE_CHANNEL);
                if (typeof result !== 'string') {
                    throw new TypeError('The samples base path is not a string');
                }
                return result;
            },
            join: async (...segments) => {
                const result = await ipc.invoke(PATHS_JOIN_CHANNEL, segments);
                if (typeof result !== 'string') {
                    throw new TypeError('The joined path is not a string');
                }
                return result;
            },
        },
    };
};
