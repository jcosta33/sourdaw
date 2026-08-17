/**
 * Every non-command IPC channel, named once (REQ-004, REQ-006).
 *
 * Preload and main both address these, and a channel name that exists in one
 * file as a literal and in the other as a slightly different literal is a
 * message that is silently never delivered. So they live here, and nothing
 * writes a channel string inline.
 *
 * The `sourdaw:` prefix is not decoration: `ipcRenderer` can reach any channel
 * name, including ones Electron itself uses, so a namespace makes an accidental
 * collision impossible to introduce by picking a plausible word.
 */

/** Main → renderer: one pushed event, as `(name, payload)`. */
export const EVENT_CHANNEL = 'sourdaw:event';

/** Main → renderer: one event of one in-flight command stream, as `(streamId, payload)`. */
export const STREAM_CHANNEL = 'sourdaw:stream';

/** Renderer → main, invoke: the three native dialogs. */
export const DIALOG_OPEN_CHANNEL = 'sourdaw:dialog:open';
export const DIALOG_SAVE_CHANNEL = 'sourdaw:dialog:save';
export const DIALOG_MESSAGE_CHANNEL = 'sourdaw:dialog:message';

/** Renderer → main, invoke: the two path helpers. */
export const PATHS_SAMPLES_BASE_CHANNEL = 'sourdaw:paths:samples-base';
export const PATHS_JOIN_CHANNEL = 'sourdaw:paths:join';

/** A filter in an open or save dialog. Mirrors the Tauri dialog plugin's shape. */
export type DialogFilter = {
    readonly name: string;
    readonly extensions: readonly string[];
};

/**
 * Open-dialog options.
 *
 * Field for field what `@tauri-apps/plugin-dialog`'s `open` accepts today
 * (`src/types/tauri-dialog.d.ts`), because the call sites are the same files in
 * both shells and a renamed option is a silently ignored one.
 */
export type OpenDialogOptions = {
    readonly multiple?: boolean;
    readonly directory?: boolean;
    readonly filters?: readonly DialogFilter[];
    readonly defaultPath?: string;
    readonly title?: string;
};

/** Save-dialog options, matching the same plugin surface. */
export type SaveDialogOptions = {
    readonly defaultPath?: string;
    readonly filters?: readonly DialogFilter[];
    readonly title?: string;
};

/** Message-box options. */
export type MessageDialogOptions = {
    readonly title?: string;
    readonly message: string;
    readonly kind?: 'info' | 'warning' | 'error';
};

/**
 * The bridge `contextBridge` publishes at `window.sourdaw`.
 *
 * ## Argument shape
 *
 * `args` is **positional**, in the order the addon method declares its
 * parameters — not a named object as Tauri's `invoke` takes. That is the shape
 * that lets the main-process router stay opaque: it forwards the array to the
 * addon and never reads inside it, so no part of the shell has to know, or keep
 * in sync, what any command's parameters are called. Naming stays where the
 * hand-written mirror types already live, in each module's `repositories/`
 * bridge.
 *
 * ## Byte payloads
 *
 * Bytes always travel as the **last** argument, which is true of every
 * byte-taking command in the surface. `invoke` refuses to carry them so that a
 * caller cannot accidentally take the JSON path with a buffer in hand;
 * `invokeBinary` is the path that does, and `invokeBinaryResponse` is the one
 * that guarantees bytes coming back rather than a JSON number array.
 */
export type SourdawBridge = {
    /** Invoke a command whose arguments and result are JSON. */
    invoke: (command: string, args?: readonly unknown[]) => Promise<unknown>;
    /** Invoke a command whose final argument is a byte payload. */
    invokeBinary: (command: string, meta: readonly unknown[], bytes: Uint8Array) => Promise<void>;
    /** Invoke a command that answers with bytes. */
    invokeBinaryResponse: (command: string, args?: readonly unknown[]) => Promise<Uint8Array>;
    /** Subscribe to a pushed event. Returns the unsubscribe function. */
    listen: (event: string, callback: (payload: unknown) => void) => () => void;
    /**
     * Invoke a command that streams correlated events back while it runs.
     *
     * The stream is bounded in main; an overflow rejects this promise rather
     * than dropping events, because a hole in a response body is corruption,
     * not degradation.
     */
    stream: (command: string, args: readonly unknown[], onEvent: (payload: unknown) => void) => Promise<unknown>;
    dialog: {
        readonly open: (options?: OpenDialogOptions) => Promise<string | string[] | null>;
        readonly save: (options?: SaveDialogOptions) => Promise<string | null>;
        readonly message: (options: MessageDialogOptions) => Promise<void>;
    };
    paths: {
        /** Base URL the bundled sample content is reachable at from the renderer. */
        readonly samplesBase: () => Promise<string>;
        /** OS-correct filesystem path join, for paths handed back to native commands. */
        readonly join: (...segments: readonly string[]) => Promise<string>;
    };
};
