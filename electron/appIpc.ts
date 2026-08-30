/**
 * The channels that are not addon commands (REQ-004, REQ-007).
 *
 * Three native dialogs, two path helpers, the frameless window's own controls,
 * and the one command whose backend is a separate process rather than the
 * addon in this one. They share the command router's origin guard, because a
 * save dialog opened by something that is not the app is the same failure as a
 * command invoked by it.
 *
 * `scan_plugins` is registered here rather than in the router, and that is the
 * whole point of it being here: the channel is identical, so the surface the
 * renderer sees is unchanged, while the work happens in a `utilityProcess` that
 * can be killed by a hostile plugin without taking the audio device with it.
 * Wiring it in the router instead would load plugin entry points in the process
 * that owns the session.
 */

import {
    DIALOG_MESSAGE_CHANNEL,
    DIALOG_OPEN_CHANNEL,
    DIALOG_SAVE_CHANNEL,
    PATHS_JOIN_CHANNEL,
    PATHS_SAMPLES_BASE_CHANNEL,
    WINDOW_CLOSE_CHANNEL,
    WINDOW_IS_MAXIMIZED_CHANNEL,
    WINDOW_MINIMIZE_CHANNEL,
    WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
    NATIVE_EDIT_CHANNEL,
    NATIVE_MENU_PROJECT_STATE_CHANNEL,
    NATIVE_MENU_SAVE_RESULT_CHANNEL,
} from './channels.js';
import { commandChannel } from './commands.js';
import { asPositionalArguments, withTrustedSender, withTrustedSenderEvent, type IpcMainLike } from './router.js';

import type { ScanSupervisor } from './scan.js';
import type {
    FileFilter,
    MessageBoxOptions,
    OpenDialogOptions,
    OpenDialogReturnValue,
    SaveDialogOptions,
    SaveDialogReturnValue,
} from 'electron';

/** The one exposed command the addon in this process does not serve. */
export const SCAN_COMMAND = 'scan_plugins';

export type TrustGuard = (url: string | undefined) => boolean;

const isStringList = (value: unknown): value is readonly string[] =>
    Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');

export type RegisterScanCommandInput = {
    readonly ipcMain: IpcMainLike;
    readonly isTrustedFrameUrl: TrustGuard;
    readonly supervisor: ScanSupervisor;
    readonly acceptsCommand?: (command: string) => boolean;
};

export const registerScanCommand = ({
    ipcMain,
    isTrustedFrameUrl,
    supervisor,
    acceptsCommand,
}: RegisterScanCommandInput): void => {
    ipcMain.handle(
        commandChannel(SCAN_COMMAND),
        withTrustedSender(SCAN_COMMAND, isTrustedFrameUrl, async (args) => {
            if (acceptsCommand !== undefined && !acceptsCommand(SCAN_COMMAND)) {
                throw new Error(`${SCAN_COMMAND} rejected: the application is shutting down`);
            }
            const [paths, retryQuarantined] = asPositionalArguments(args);
            if (!isStringList(paths)) {
                throw new TypeError('scan_plugins expects a list of paths');
            }
            if (retryQuarantined !== undefined && typeof retryQuarantined !== 'boolean') {
                throw new TypeError('scan_plugins expects retry_quarantined to be a boolean');
            }
            // Omitted rather than sent as `false`/`undefined`: keeps the ordinary
            // scan call's request shape identical to before this flag existed.
            return supervisor.scan(retryQuarantined === true ? { paths, retryQuarantined: true } : { paths });
        })
    );
};

/**
 * The dialog surface, narrowed to the three calls the shell makes.
 *
 * Not `Electron.Dialog`: taking the whole namespace would let a future edit
 * reach a dialog the renderer is not meant to be able to raise, and the option
 * and result types are Electron's own so the real `dialog` satisfies this
 * without an assertion at the call site.
 */
export type NativeDialogs = {
    readonly showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
    readonly showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
    readonly showMessageBox: (options: MessageBoxOptions) => Promise<unknown>;
};

export type RegisterDialogChannelsInput = {
    readonly ipcMain: IpcMainLike;
    readonly isTrustedFrameUrl: TrustGuard;
    readonly dialogs: NativeDialogs;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? { ...value } : {};

const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * Read the dialog filters out of an options payload.
 *
 * A filter the renderer sent malformed is dropped rather than passed through:
 * an Electron dialog given a filter with no extensions shows the user a picker
 * that matches nothing, which reads as a broken app rather than a bad argument.
 */
const optionalFilters = (value: unknown): FileFilter[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const filters = value.flatMap((entry): FileFilter[] => {
        const filter = asRecord(entry);
        const name = optionalString(filter.name);
        const extensions = Array.isArray(filter.extensions)
            ? filter.extensions.filter((extension): extension is string => typeof extension === 'string')
            : [];
        return name !== undefined && extensions.length > 0 ? [{ name, extensions }] : [];
    });
    return filters.length > 0 ? filters : undefined;
};

const messageKind = (value: unknown): 'info' | 'warning' | 'error' =>
    value === 'warning' || value === 'error' ? value : 'info';

/**
 * The three native dialogs, answering in the shape the call sites already
 * handle.
 *
 * The renderer's dialog call sites are the same files in both shells and they
 * read a cancelled dialog as `null`, never as `{ canceled: true }`. Returning
 * Electron's own shape would make every one of them treat a cancellation as a
 * successful pick of an object — which, for the save dialog, means writing a
 * render to a path that is not a path.
 */
export const registerDialogChannels = ({ ipcMain, isTrustedFrameUrl, dialogs }: RegisterDialogChannelsInput): void => {
    ipcMain.handle(
        DIALOG_OPEN_CHANNEL,
        withTrustedSender('dialog.open', isTrustedFrameUrl, async (options) => {
            const request = asRecord(options);
            const multiple = request.multiple === true;
            const result = await dialogs.showOpenDialog({
                title: optionalString(request.title),
                defaultPath: optionalString(request.defaultPath),
                filters: optionalFilters(request.filters),
                properties: [
                    request.directory === true ? 'openDirectory' : 'openFile',
                    ...(multiple ? (['multiSelections'] as const) : []),
                ],
            });
            if (result.canceled || result.filePaths.length === 0) {
                return null;
            }
            return multiple ? result.filePaths : result.filePaths[0];
        })
    );

    ipcMain.handle(
        DIALOG_SAVE_CHANNEL,
        withTrustedSender('dialog.save', isTrustedFrameUrl, async (options) => {
            const request = asRecord(options);
            const result = await dialogs.showSaveDialog({
                title: optionalString(request.title),
                defaultPath: optionalString(request.defaultPath),
                filters: optionalFilters(request.filters),
            });
            return result.canceled || result.filePath === '' ? null : result.filePath;
        })
    );

    ipcMain.handle(
        DIALOG_MESSAGE_CHANNEL,
        withTrustedSender('dialog.message', isTrustedFrameUrl, async (options) => {
            const request = asRecord(options);
            await dialogs.showMessageBox({
                type: messageKind(request.kind),
                title: optionalString(request.title) ?? 'Sourdaw',
                message: optionalString(request.message) ?? '',
            });
            return undefined;
        })
    );
};

export type RegisterPathChannelsInput = {
    readonly ipcMain: IpcMainLike;
    readonly isTrustedFrameUrl: TrustGuard;
    /** Where bundled sample content is reachable from the renderer. */
    readonly samplesBaseUrl: string;
    /** `node:path`'s `join`. Injected so the specs do not depend on the host OS. */
    readonly join: (...segments: string[]) => string;
};

export const registerPathChannels = ({
    ipcMain,
    isTrustedFrameUrl,
    samplesBaseUrl,
    join,
}: RegisterPathChannelsInput): void => {
    ipcMain.handle(
        PATHS_SAMPLES_BASE_CHANNEL,
        withTrustedSender('paths.samplesBase', isTrustedFrameUrl, () => samplesBaseUrl)
    );

    ipcMain.handle(
        PATHS_JOIN_CHANNEL,
        withTrustedSender('paths.join', isTrustedFrameUrl, (segments) => {
            if (!isStringList(segments)) {
                throw new TypeError('paths.join expects string segments');
            }
            return join(...segments);
        })
    );
};

/**
 * The slice of a `BrowserWindow` the frameless chrome drives, narrowed the same
 * way as `NativeDialogs`: the renderer may minimize, toggle the maximized
 * state, read that state, and close its own window — nothing else.
 */
export type WindowControlTarget = {
    readonly minimize: () => void;
    readonly maximize: () => void;
    readonly unmaximize: () => void;
    readonly isMaximized: () => boolean;
    readonly close: () => void;
};

export type RegisterWindowControlChannelsInput = {
    readonly ipcMain: IpcMainLike;
    readonly isTrustedFrameUrl: TrustGuard;
    /**
     * Resolve the window a sender belongs to, or null when it has none — a
     * renderer that crashed between sending and being handled. Resolved per
     * call rather than captured, so crash-recovery window recreation never
     * leaves these channels pointing at a destroyed window.
     */
    readonly windowForSender: (sender: unknown) => WindowControlTarget | null;
};

/**
 * The four window-control channels backing the frameless Linux chrome.
 *
 * Each one resolves the calling window from the sender, so the controls in one
 * window can never drive another, and a sender with no window is a no-op
 * (reported as not-maximized) rather than a throw into a dying renderer.
 */
export const registerWindowControlChannels = ({
    ipcMain,
    isTrustedFrameUrl,
    windowForSender,
}: RegisterWindowControlChannelsInput): void => {
    ipcMain.handle(
        WINDOW_MINIMIZE_CHANNEL,
        withTrustedSenderEvent('window.minimize', isTrustedFrameUrl, (event) => {
            windowForSender(event.sender)?.minimize();
        })
    );

    ipcMain.handle(
        WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
        withTrustedSenderEvent('window.toggleMaximize', isTrustedFrameUrl, (event) => {
            const window = windowForSender(event.sender);
            if (window === null) {
                return false;
            }
            if (window.isMaximized()) {
                window.unmaximize();
            } else {
                window.maximize();
            }
            return window.isMaximized();
        })
    );

    ipcMain.handle(
        WINDOW_CLOSE_CHANNEL,
        withTrustedSenderEvent('window.close', isTrustedFrameUrl, (event) => {
            windowForSender(event.sender)?.close();
        })
    );

    ipcMain.handle(
        WINDOW_IS_MAXIMIZED_CHANNEL,
        withTrustedSenderEvent(
            'window.isMaximized',
            isTrustedFrameUrl,
            (event) => windowForSender(event.sender)?.isMaximized() ?? false
        )
    );
};

export type NativeEditTarget = {
    readonly undo: () => void;
    readonly redo: () => void;
    readonly cut: () => void;
    readonly copy: () => void;
    readonly paste: () => void;
    readonly selectAll: () => void;
};

export type NativeMenuProjectState = {
    readonly title: string;
    readonly dirty: boolean;
    readonly durabilityPending: boolean;
    readonly projectId: string;
    readonly revision: string;
    readonly recentProjects: readonly { readonly key: string; readonly name: string }[];
};

export type NativeMenuSaveResult = {
    readonly requestId: number;
    readonly saved: boolean;
    readonly dirty: boolean;
};

export type RegisterNativeMenuChannelsInput = {
    readonly ipcMain: IpcMainLike;
    readonly isTrustedFrameUrl: TrustGuard;
    readonly onProjectState: (state: NativeMenuProjectState, sender: unknown) => void;
    readonly onSaveResult: (result: NativeMenuSaveResult) => void;
    readonly editTargetForSender: (sender: unknown) => NativeEditTarget | null;
};

const nativeMenuProjectState = (value: unknown): NativeMenuProjectState => {
    const state = asRecord(value);
    if (
        typeof state.title !== 'string' ||
        typeof state.dirty !== 'boolean' ||
        typeof state.durabilityPending !== 'boolean' ||
        typeof state.projectId !== 'string' ||
        typeof state.revision !== 'string' ||
        !Array.isArray(state.recentProjects)
    ) {
        throw new TypeError('native menu project state is invalid');
    }
    const recentProjects = state.recentProjects.map((entry) => {
        const project = asRecord(entry);
        if (typeof project.key !== 'string' || typeof project.name !== 'string') {
            throw new TypeError('native menu recent project is invalid');
        }
        return { key: project.key, name: project.name };
    });
    return {
        title: state.title,
        dirty: state.dirty,
        durabilityPending: state.durabilityPending,
        projectId: state.projectId,
        revision: state.revision,
        recentProjects,
    };
};

const nativeMenuSaveResult = (value: unknown): NativeMenuSaveResult => {
    const result = asRecord(value);
    if (
        typeof result.requestId !== 'number' ||
        !Number.isSafeInteger(result.requestId) ||
        result.requestId < 1 ||
        typeof result.saved !== 'boolean' ||
        typeof result.dirty !== 'boolean'
    ) {
        throw new TypeError('native menu save result is invalid');
    }
    return { requestId: result.requestId, saved: result.saved, dirty: result.dirty };
};

/** The entire renderer-facing native menu surface: validated projections and text editing only. */
export const registerNativeMenuChannels = ({
    ipcMain,
    isTrustedFrameUrl,
    onProjectState,
    onSaveResult,
    editTargetForSender,
}: RegisterNativeMenuChannelsInput): void => {
    ipcMain.handle(
        NATIVE_MENU_PROJECT_STATE_CHANNEL,
        withTrustedSenderEvent('nativeMenu.projectState', isTrustedFrameUrl, (event, value) =>
            onProjectState(nativeMenuProjectState(value), event.sender)
        )
    );
    ipcMain.handle(
        NATIVE_MENU_SAVE_RESULT_CHANNEL,
        withTrustedSender('nativeMenu.saveResult', isTrustedFrameUrl, (value) =>
            onSaveResult(nativeMenuSaveResult(value))
        )
    );
    ipcMain.handle(
        NATIVE_EDIT_CHANNEL,
        withTrustedSenderEvent('nativeMenu.edit', isTrustedFrameUrl, (event, operation) => {
            const target = editTargetForSender(event.sender);
            if (target === null) {
                return;
            }
            switch (operation) {
                case 'undo':
                    target.undo();
                    return;
                case 'redo':
                    target.redo();
                    return;
                case 'cut':
                    target.cut();
                    return;
                case 'copy':
                    target.copy();
                    return;
                case 'paste':
                    target.paste();
                    return;
                case 'selectAll':
                    target.selectAll();
                    return;
                default:
                    throw new TypeError('native edit operation is invalid');
            }
        })
    );
};
