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

type SourdawNativeMenuAction =
    | 'project:new'
    | 'project:import-project'
    | 'project:import-audio'
    | 'project:import-midi'
    | 'project:open-recent'
    | 'project:save'
    | 'project:discard'
    | 'project:export-audio'
    | 'project:export-file'
    | 'edit:undo'
    | 'edit:redo'
    | 'edit:cut'
    | 'edit:copy'
    | 'edit:paste'
    | 'edit:select-all'
    | 'edit:deselect-all'
    | 'view:toggle-sidebar'
    | 'view:toggle-mixer'
    | 'view:toggle-inspector'
    | 'view:toggle-track-list'
    | 'view:toggle-virtual-keyboard'
    | 'view:toggle-automation'
    | 'view:toggle-chat'
    | 'view:preferences'
    | 'view:zoom-fit'
    | 'view:zoom-selection'
    | 'view:zoom-in'
    | 'view:zoom-out'
    | 'help:show-tour';

type SourdawDesktopBridge = {
    /** The platform the shell runs on (`process.platform`), published synchronously. */
    readonly platform: string;
    /** Renderer display controls backed by Electron's viewport-aware webFrame APIs. */
    display: {
        readonly setZoomFactor: (factor: number) => void;
    };
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
    /** The frameless window chrome's controls (Linux). */
    windowControls: {
        readonly minimize: () => Promise<void>;
        /** Maximizes or restores; resolves with the resulting maximized state. */
        readonly toggleMaximize: () => Promise<boolean>;
        readonly close: () => Promise<void>;
        readonly isMaximized: () => Promise<boolean>;
        readonly listenMaximized: (callback: (maximized: boolean) => void) => () => void;
    };
    nativeMenu: {
        readonly listen: (
            callback: (intent: {
                readonly action: SourdawNativeMenuAction;
                readonly requestId?: number;
                readonly recentKey?: string;
                readonly projectKey?: string;
                readonly revision?: string;
            }) => void
        ) => () => void;
        readonly projectState: (state: {
            readonly title: string;
            readonly dirty: boolean;
            readonly durabilityPending: boolean;
            readonly projectKey: string;
            readonly revision: string;
            readonly recentProjects: readonly { readonly key: string; readonly name: string }[];
        }) => Promise<void>;
        readonly saveResult: (result: {
            readonly requestId: number;
            readonly saved: boolean;
            readonly dirty: boolean;
            readonly projectKey: string;
            readonly revision: string;
        }) => Promise<void>;
        readonly edit: (operation: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => Promise<void>;
    };
};
