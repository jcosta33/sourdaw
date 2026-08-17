/**
 * The channels that are not addon commands (REQ-004, REQ-007).
 *
 * Three native dialogs, two path helpers, and the one command whose backend is
 * a separate process rather than the addon in this one. They share the command
 * router's origin guard, because a save dialog opened by something that is not
 * the app is the same failure as a command invoked by it.
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
} from './channels.js';
import { commandChannel } from './commands.js';
import { asPositionalArguments, withTrustedSender, type IpcMainLike } from './router.js';

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
};

export const registerScanCommand = ({ ipcMain, isTrustedFrameUrl, supervisor }: RegisterScanCommandInput): void => {
    ipcMain.handle(
        commandChannel(SCAN_COMMAND),
        withTrustedSender(SCAN_COMMAND, isTrustedFrameUrl, async (args) => {
            const [paths] = asPositionalArguments(args);
            if (!isStringList(paths)) {
                throw new TypeError('scan_plugins expects a list of paths');
            }
            return supervisor.scan({ paths });
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
