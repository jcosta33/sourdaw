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
    VOICE_DICTATION_ARM_CHANNEL,
    VOICE_DICTATION_CANCEL_CHANNEL,
    VOICE_DICTATION_DISARM_CHANNEL,
    VOICE_DICTATION_START_CHANNEL,
    VOICE_DICTATION_STOP_CHANNEL,
    VOICE_DICTATION_TERMINAL_CHANNEL,
    WINDOW_CLOSE_CHANNEL,
    WINDOW_IS_MAXIMIZED_CHANNEL,
    WINDOW_MAXIMIZED_CHANGED_CHANNEL,
    WINDOW_MINIMIZE_CHANNEL,
    WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
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
/**
 * A value unique to this preload instance, prefixed onto every stream id.
 *
 * A counter alone is not enough. Main's in-flight `CommandStream`s outlive a
 * renderer crash — the router re-resolves the live window deliberately, so a
 * queued response drains into the *recreated* one — while the new preload's
 * counter starts at zero again. Without an epoch the pre-crash request's
 * remaining chunks land on the new request's correlation and interleave two
 * response bodies, which is the corruption the bounded queue exists to prevent.
 *
 * `globalThis.crypto` rather than `node:crypto`: the preload is bundled for
 * Electron's sandbox, where only `electron`, `events`, `timers` and `url`
 * resolve. The `app://sourdaw` scheme is registered `secure`, so Web Crypto is
 * available; a missing `randomUUID` throws here at boot rather than producing
 * colliding ids in the dark.
 */
const bootEpoch = (): string => globalThis.crypto.randomUUID();

const VOICE_ACTIVATION_MAX_AGE_MS = 1_000;

type VoiceClickEvent = { readonly isTrusted: boolean; readonly target: unknown };
type VoiceControlDocument = {
    addEventListener: (
        type: 'click',
        listener: (event: VoiceClickEvent) => void,
        options: { readonly capture: boolean }
    ) => void;
};
type VoiceControlTarget = { closest: (selector: string) => unknown };
const isVoiceControlTarget = (value: unknown): value is VoiceControlTarget =>
    typeof value === 'object' && value !== null && 'closest' in value && typeof value.closest === 'function';
const isVoiceControlDocument = (value: unknown): value is VoiceControlDocument =>
    typeof value === 'object' &&
    value !== null &&
    'addEventListener' in value &&
    typeof value.addEventListener === 'function';

/**
 * A private preload capability minted only by a current trusted click on the
 * actual voice control. Renderer code receives no token and cannot mint one
 * through a lookalike event or retained trusted event.
 */
const discoveredVoiceDocument = (): VoiceControlDocument | undefined => {
    const candidate: unknown = Reflect.get(globalThis, 'document');
    return isVoiceControlDocument(candidate) ? candidate : undefined;
};

const createVoiceActivation = (
    ipc: RendererIpc,
    voiceDocument: VoiceControlDocument | undefined
): { readonly consume: () => Promise<string | null>; readonly invalidate: () => Promise<void> } => {
    let activation:
        { readonly token: string; readonly createdAt: number; readonly armed: Promise<boolean> } | undefined;
    if (voiceDocument !== undefined) {
        voiceDocument.addEventListener(
            'click',
            (event) => {
                const target = event.target;
                if (
                    !event.isTrusted ||
                    !isVoiceControlTarget(target) ||
                    target.closest('[data-voice-command-intent="start"]') === null
                ) {
                    return;
                }
                const token = globalThis.crypto.randomUUID();
                activation = {
                    token,
                    createdAt: Date.now(),
                    armed: ipc.invoke(VOICE_DICTATION_ARM_CHANNEL, token).then(
                        () => true,
                        () => false
                    ),
                };
            },
            { capture: true }
        );
    }
    return {
        consume: async () => {
            const current = activation;
            activation = undefined;
            if (current === undefined || Date.now() - current.createdAt > VOICE_ACTIVATION_MAX_AGE_MS) {
                return null;
            }
            return (await current.armed) ? current.token : null;
        },
        invalidate: async () => {
            activation = undefined;
            await ipc.invoke(VOICE_DICTATION_DISARM_CHANNEL);
        },
    };
};

export const createSourdawBridge = (
    ipc: RendererIpc,
    epoch: string = bootEpoch(),
    voiceDocument: VoiceControlDocument | undefined = discoveredVoiceDocument(),
    platform: string = process.platform
): SourdawBridge => {
    const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
    const streamListeners = new Map<string, (payload: unknown) => void>();
    const voiceTerminalListeners = new Map<string, Set<(event: string, payload: unknown) => void>>();
    const maximizedListeners = new Set<(maximized: boolean) => void>();
    let nextStreamId = 0;
    const voiceActivation = createVoiceActivation(ipc, voiceDocument);

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

    ipc.on(VOICE_DICTATION_TERMINAL_CHANNEL, (_event, ...args) => {
        const [event, payload] = args;
        if (
            (event !== 'dictation-result' && event !== 'dictation-error') ||
            typeof payload !== 'object' ||
            payload === null ||
            !('session_id' in payload) ||
            typeof payload.session_id !== 'string'
        ) {
            return;
        }
        for (const listener of [...(voiceTerminalListeners.get(payload.session_id) ?? [])]) {
            listener(event, payload);
        }
    });

    ipc.on(WINDOW_MAXIMIZED_CHANGED_CHANNEL, (_event, ...args) => {
        const [maximized] = args;
        if (typeof maximized !== 'boolean') {
            return;
        }
        for (const listener of [...maximizedListeners]) {
            listener(maximized);
        }
    });

    return {
        platform,

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
            // Returned, not discarded. `process_plugin_audio` takes a buffer
            // and answers with one, once per render quantum; dropping the
            // answer here would reach the call site as the legitimate "no
            // output yet" value and render silence with nothing logged.
            return ipc.invoke(commandChannel(command), [...meta, bytes]);
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
            const streamId = `${epoch}:${String(nextStreamId)}`;
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

        voiceDictation: {
            start: async (sessionId) => {
                const activation = await voiceActivation.consume();
                if (activation === null) {
                    throw new Error('Voice dictation requires a current voice-control activation');
                }
                const result = await ipc.invoke(VOICE_DICTATION_START_CHANNEL, sessionId, activation);
                if (typeof result !== 'string' || result !== sessionId) {
                    throw new TypeError('Voice dictation returned an invalid session acknowledgement');
                }
                return result;
            },
            stop: async (sessionId) => {
                await voiceActivation.invalidate();
                await ipc.invoke(VOICE_DICTATION_STOP_CHANNEL, sessionId);
            },
            cancel: async (sessionId) => {
                await voiceActivation.invalidate();
                await ipc.invoke(VOICE_DICTATION_CANCEL_CHANNEL, sessionId);
            },
            listenTerminal: (sessionId, callback) => {
                const listeners = voiceTerminalListeners.get(sessionId) ?? new Set();
                listeners.add(callback);
                voiceTerminalListeners.set(sessionId, listeners);
                return () => {
                    listeners.delete(callback);
                    if (listeners.size === 0) {
                        voiceTerminalListeners.delete(sessionId);
                    }
                };
            },
        },

        windowControls: {
            minimize: async () => {
                await ipc.invoke(WINDOW_MINIMIZE_CHANNEL);
            },
            toggleMaximize: async () => {
                const result = await ipc.invoke(WINDOW_TOGGLE_MAXIMIZE_CHANNEL);
                if (typeof result !== 'boolean') {
                    throw new TypeError('window.toggleMaximize returned a non-boolean payload');
                }
                return result;
            },
            close: async () => {
                await ipc.invoke(WINDOW_CLOSE_CHANNEL);
            },
            isMaximized: async () => {
                const result = await ipc.invoke(WINDOW_IS_MAXIMIZED_CHANNEL);
                if (typeof result !== 'boolean') {
                    throw new TypeError('window.isMaximized returned a non-boolean payload');
                }
                return result;
            },
            listenMaximized: (callback) => {
                maximizedListeners.add(callback);
                return () => {
                    maximizedListeners.delete(callback);
                };
            },
        },
    };
};
