/**
 * Ambient shape of the Electron preload bridge at `window.sourdaw`.
 *
 * Hand-mirrors `SourdawBridge` in `electron/channels.ts` — the renderer build
 * must not import `electron/**`, so the type crosses as a declaration and
 * `src/utils/__tests__/sourdawDesktopBridge.spec.ts` pins the two assignable
 * in both directions.
 */

type SourdawDialogFilter = {
    readonly name: string;
    readonly extensions: readonly string[];
};

type SourdawOpenDialogOptions = {
    readonly multiple?: boolean;
    readonly directory?: boolean;
    readonly filters?: readonly SourdawDialogFilter[];
    readonly defaultPath?: string;
    readonly title?: string;
};

type SourdawSaveDialogOptions = {
    readonly defaultPath?: string;
    readonly filters?: readonly SourdawDialogFilter[];
    readonly title?: string;
};

type SourdawMessageDialogOptions = {
    readonly title?: string;
    readonly message: string;
    readonly kind?: 'info' | 'warning' | 'error';
};

type SourdawDesktopBridge = {
    /** Invoke a command whose arguments and result are JSON. Arguments are positional. */
    invoke: (command: string, args?: readonly unknown[]) => Promise<unknown>;
    /** Invoke a command whose final argument is a byte payload. Resolves with the command's own result. */
    invokeBinary: (command: string, meta: readonly unknown[], bytes: Uint8Array) => Promise<unknown>;
    /** Invoke a command that answers with bytes. */
    invokeBinaryResponse: (command: string, args?: readonly unknown[]) => Promise<Uint8Array>;
    /** Subscribe to a pushed event. Returns the unsubscribe function, synchronously. */
    listen: (event: string, callback: (payload: unknown) => void) => () => void;
    /** Invoke a command that streams correlated events back while it runs. */
    stream: (command: string, args: readonly unknown[], onEvent: (payload: unknown) => void) => Promise<unknown>;
    dialog: {
        readonly open: (options?: SourdawOpenDialogOptions) => Promise<string | string[] | null>;
        readonly save: (options?: SourdawSaveDialogOptions) => Promise<string | null>;
        readonly message: (options: SourdawMessageDialogOptions) => Promise<void>;
    };
    paths: {
        readonly samplesBase: () => Promise<string>;
        readonly join: (...segments: readonly string[]) => Promise<string>;
    };
    voiceDictation: {
        readonly start: (sessionId: string) => Promise<string>;
        readonly stop: (sessionId: string) => Promise<void>;
        readonly cancel: (sessionId: string) => Promise<void>;
        readonly listenTerminal: (sessionId: string, callback: (event: string, payload: unknown) => void) => () => void;
    };
};
