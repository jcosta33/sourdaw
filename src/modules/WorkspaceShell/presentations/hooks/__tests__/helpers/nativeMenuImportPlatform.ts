import type { ApplicationMenuTemplateItem } from '../../../../../../../electron/applicationMenu';
import type { NativeCommand, NativeHost } from '../../../../../../../electron/native';

type Listener = (...args: unknown[]) => void;
type IpcListener = (event: unknown, ...args: unknown[]) => void;

const handlers = new Map<string, Listener>();
const rendererListeners = new Map<string, Set<IpcListener>>();
const windows: PlatformWindow[] = [];
const files = new Map<string, Uint8Array>();
const grants = new Set<string>();
const ipcCalls: { channel: string; args: unknown[] }[] = [];
const titles: string[] = [];
const dialogs: unknown[] = [];
const reads: string[] = [];
const pluginUnloads: unknown[] = [];
let menu: ApplicationMenuTemplateItem[] = [];
let selectedFile: string | undefined;

class PlatformWindow {
    static fromWebContents(contents: unknown): PlatformWindow | null {
        return windows.find((window) => window.webContents === contents) ?? null;
    }

    private readonly listeners = new Map<string, Listener[]>();
    private destroyed = false;
    readonly webContents = {
        on: (_event: string, _listener: Listener) => undefined,
        setWindowOpenHandler: (_listener: Listener) => undefined,
        getURL: () => 'app://sourdaw/index.html',
        send: (channel: string, ...args: unknown[]) => {
            for (const listener of rendererListeners.get(channel) ?? []) {
                listener({}, ...args);
            }
        },
    };

    constructor(_options: unknown) {
        windows.push(this);
    }

    on(event: string, listener: Listener): void {
        const listeners = this.listeners.get(event) ?? [];
        this.listeners.set(event, [...listeners, listener]);
    }

    once(event: string, listener: Listener): void {
        this.on(event, listener);
    }

    setTitle(title: string): void {
        titles.push(title);
    }

    setDocumentEdited(_edited: boolean): void {}
    isDestroyed(): boolean {
        return this.destroyed;
    }
    isMinimized(): boolean {
        return false;
    }
    restore(): void {}
    show(): void {}
    hide(): void {}
    focus(): void {}
    loadURL(_url: string): Promise<void> {
        return Promise.resolve();
    }
    destroy(): void {
        this.destroyed = true;
    }
    close(): void {
        for (const listener of this.listeners.get('close') ?? []) {
            listener({ preventDefault: () => undefined });
        }
    }
}

class FileHost implements NativeHost {
    [command: string]: NativeCommand;
    shutdown = () => undefined;
    beginRendererSession = () => 1;
    startDictation = () => Promise.reject(new Error('Unexpected dictation'));
    stopDictation = () => {
        throw new Error('Unexpected dictation');
    };
    cancelDictation = () => Promise.reject(new Error('Unexpected dictation'));
    grantPath = (path: unknown, mode: unknown, recursive: unknown) => {
        if (typeof path !== 'string' || mode !== 'read' || recursive !== false || !files.has(path)) {
            throw new Error('Unexpected file grant');
        }
        grants.add(path);
        return Promise.resolve();
    };
    readFileBytes = (path: unknown) => {
        if (typeof path !== 'string' || !grants.has(path)) {
            throw new Error('File read lacks the selected grant');
        }
        const bytes = files.get(path);
        if (!bytes) {
            throw new Error('Selected file is absent');
        }
        reads.push(path);
        return Uint8Array.from(bytes);
    };
    unloadPlugin = (instanceId: unknown) => {
        if (instanceId !== undefined) {
            throw new Error('The platform fixture has no plugin instances');
        }
        pluginUnloads.push(instanceId);
        return { unloadedInstanceIds: [], errors: [], reports: [] };
    };
}

export const nativeMenuImportPlatform = {
    windows,
    ipcCalls,
    titles,
    dialogs,
    reads,
    pluginUnloads,
    nativeAddon: { SourdawNative: FileHost },
    selectFile(path: string, bytes: Uint8Array): void {
        files.set(path, Uint8Array.from(bytes));
        selectedFile = path;
    },
    fileBytes(path: string): Uint8Array | undefined {
        return files.get(path);
    },
    menu: () => menu,
    hasChannel: (channel: string) => handlers.has(channel),
    reset(): void {
        handlers.clear();
        rendererListeners.clear();
        windows.length = 0;
        files.clear();
        grants.clear();
        ipcCalls.length = 0;
        titles.length = 0;
        dialogs.length = 0;
        reads.length = 0;
        pluginUnloads.length = 0;
        menu = [];
        selectedFile = undefined;
    },
    electron: {
        app: {
            isPackaged: false,
            getAppPath: () => '/app',
            requestSingleInstanceLock: () => true,
            whenReady: () => Promise.resolve(),
            on: (_event: string, _listener: Listener) => undefined,
            exit: (_code: number) => undefined,
            quit: () => undefined,
        },
        BrowserWindow: PlatformWindow,
        BaseWindow: { getFocusedWindow: () => windows.at(-1) },
        dialog: {
            showOpenDialog: () => {
                if (selectedFile === undefined) {
                    throw new Error('No import file selected');
                }
                return Promise.resolve({ canceled: false, filePaths: [selectedFile] });
            },
            showMessageBox: (_window: unknown, options: unknown) => {
                dialogs.push(options);
                return Promise.resolve({ response: 2 });
            },
            showErrorBox: (_title: string, _message: string) => {
                throw new Error('Unexpected shell error dialog');
            },
        },
        ipcMain: {
            handle: (channel: string, listener: Listener) => {
                if (handlers.has(channel)) {
                    throw new Error(`Duplicate IPC channel: ${channel}`);
                }
                handlers.set(channel, listener);
            },
        },
        ipcRenderer: {
            invoke: async (channel: string, ...args: unknown[]) => {
                const listener = handlers.get(channel);
                const window = windows.at(-1);
                if (!listener || !window) {
                    throw new Error(`IPC is not ready: ${channel}`);
                }
                ipcCalls.push({ channel, args: structuredClone(args) });
                return listener(
                    { sender: window.webContents, senderFrame: { url: window.webContents.getURL() } },
                    ...args
                );
            },
            on: (channel: string, listener: IpcListener) => {
                const listeners = rendererListeners.get(channel) ?? new Set<IpcListener>();
                listeners.add(listener);
                rendererListeners.set(channel, listeners);
            },
        },
        contextBridge: {
            exposeInMainWorld: (key: string, value: unknown) => {
                Object.defineProperty(window, key, { configurable: true, value });
            },
        },
        webFrame: { setZoomFactor: (_factor: number) => undefined },
        Menu: {
            buildFromTemplate: (template: ApplicationMenuTemplateItem[]) => template,
            setApplicationMenu: (template: ApplicationMenuTemplateItem[]) => {
                menu = template;
            },
            sendActionToFirstResponder: (_action: string) => undefined,
        },
        protocol: {
            handle: (_scheme: string, _handler: unknown) => undefined,
            registerSchemesAsPrivileged: () => undefined,
        },
        net: { fetch: () => Promise.reject(new Error('Unexpected network access')) },
        screen: { on: (_event: string, _listener: Listener) => undefined },
        session: {
            defaultSession: {
                setPermissionRequestHandler: (_listener: unknown) => undefined,
                setPermissionCheckHandler: (_listener: unknown) => undefined,
            },
        },
        shell: {
            openExternal: () => Promise.reject(new Error('Unexpected external navigation')),
            openPath: () => Promise.reject(new Error('Unexpected native file opening')),
        },
        utilityProcess: {
            fork: () => {
                throw new Error('Unexpected plugin scan');
            },
        },
        powerSaveBlocker: { start: () => 1, stop: (_id: number) => undefined, isStarted: () => false },
    },
};
