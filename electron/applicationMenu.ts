import type { MenuItemConstructorOptions } from 'electron';

export const NATIVE_MENU_ACTIONS = [
    'project:new',
    'project:import-project',
    'project:import-audio',
    'project:import-midi',
    'project:open-recent',
    'project:save',
    'project:discard',
    'project:export-audio',
    'project:export-file',
    'edit:undo',
    'edit:redo',
    'edit:cut',
    'edit:copy',
    'edit:paste',
    'edit:select-all',
    'edit:deselect-all',
    'view:toggle-sidebar',
    'view:toggle-mixer',
    'view:toggle-inspector',
    'view:toggle-track-list',
    'view:toggle-virtual-keyboard',
    'view:toggle-automation',
    'view:toggle-chat',
    'view:preferences',
    'view:zoom-fit',
    'view:zoom-selection',
    'view:zoom-in',
    'view:zoom-out',
    'help:show-tour',
] as const;

export type NativeMenuAction = (typeof NATIVE_MENU_ACTIONS)[number];

export type NativeMenuIntent = {
    readonly action: NativeMenuAction;
    readonly requestId?: number;
    readonly recentKey?: string;
    readonly projectKey?: string;
    readonly revision?: string;
};

export type NativeTextEditOperation = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

export type NativeResponderEditAction = 'undo:' | 'redo:' | 'cut:' | 'copy:' | 'paste:' | 'selectAll:';

export type NativeTextEditTarget = {
    readonly undo: () => void;
    readonly redo: () => void;
    readonly cut: () => void;
    readonly copy: () => void;
    readonly paste: () => void;
    readonly selectAll: () => void;
};

export type NativeRecentProject = { readonly key: string; readonly name: string };

const nativeMenuActions = new Set<NativeMenuAction>(NATIVE_MENU_ACTIONS);

/**
 * Electron's edit roles consume menu clicks before the renderer can route DAW
 * editing. Main performs the native operation directly, then the renderer
 * decides whether the same intent belongs to the DAW instead.
 */
export const nativeTextEditOperation = (action: NativeMenuAction): NativeTextEditOperation | undefined => {
    switch (action) {
        case 'edit:undo':
            return 'undo';
        case 'edit:redo':
            return 'redo';
        case 'edit:cut':
            return 'cut';
        case 'edit:copy':
            return 'copy';
        case 'edit:paste':
            return 'paste';
        case 'edit:select-all':
            return 'selectAll';
        default:
            return undefined;
    }
};

export const applyNativeTextEdit = (target: NativeTextEditTarget, action: NativeMenuAction): boolean => {
    const operation = nativeTextEditOperation(action);
    if (operation === undefined) {
        return false;
    }
    target[operation]();
    return true;
};

export const nativeResponderEditAction = (action: NativeMenuAction): NativeResponderEditAction | undefined => {
    switch (nativeTextEditOperation(action)) {
        case 'undo':
            return 'undo:';
        case 'redo':
            return 'redo:';
        case 'cut':
            return 'cut:';
        case 'copy':
            return 'copy:';
        case 'paste':
            return 'paste:';
        case 'selectAll':
            return 'selectAll:';
        default:
            return undefined;
    }
};

/**
 * A custom application Edit item belongs to the focused native window. A
 * hosted plugin editor must keep its platform responder chain; the DAW
 * renderer must not receive that editor's menu command.
 */
export const dispatchFocusedNativeMenuIntent = ({
    intent,
    isMainWindowFocused,
    target,
    send,
    sendToNativeResponder,
}: {
    readonly intent: NativeMenuIntent;
    readonly isMainWindowFocused: boolean;
    readonly target: NativeTextEditTarget;
    readonly send: (intent: NativeMenuIntent) => void;
    readonly sendToNativeResponder?: (action: NativeResponderEditAction) => void;
}): boolean => {
    const responderAction = nativeResponderEditAction(intent.action);
    if (intent.action.startsWith('edit:') && !isMainWindowFocused) {
        if (responderAction !== undefined) {
            sendToNativeResponder?.(responderAction);
        }
        return false;
    }
    if (responderAction !== undefined) {
        applyNativeTextEdit(target, intent.action);
    }
    send(intent);
    return true;
};

export const isNativeMenuIntent = (value: unknown): value is NativeMenuIntent => {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('action' in value) ||
        typeof value.action !== 'string' ||
        !nativeMenuActions.has(value.action as NativeMenuAction)
    ) {
        return false;
    }
    const invalidRequestId =
        'requestId' in value &&
        (typeof value.requestId !== 'number' || !Number.isSafeInteger(value.requestId) || value.requestId < 1);
    if ('projectId' in value || invalidRequestId) {
        return false;
    }
    const validFields =
        (!('recentKey' in value) || typeof value.recentKey === 'string') &&
        (!('projectKey' in value) || typeof value.projectKey === 'string') &&
        (!('revision' in value) || typeof value.revision === 'string');
    if (!validFields) {
        return false;
    }
    const isCloseOperation = value.action === 'project:save' || value.action === 'project:discard';
    const hasCloseCorrelation = 'requestId' in value || 'projectKey' in value || 'revision' in value;
    return (
        !isCloseOperation ||
        !hasCloseCorrelation ||
        ('requestId' in value && 'projectKey' in value && 'revision' in value)
    );
};

type CreateApplicationMenuTemplateInput = {
    readonly appName: string;
    readonly send: (intent: NativeMenuIntent) => void;
    readonly recentProjects?: readonly NativeRecentProject[];
};

const action = (
    label: string,
    accelerator: string | undefined,
    send: (intent: NativeMenuIntent) => void,
    id: NativeMenuAction
) => ({
    label,
    ...(accelerator === undefined ? {} : { accelerator }),
    click: () => send({ action: id }),
});

/**
 * macOS keeps the familiar native menu while product commands stay renderer
 * intents. Electron edit roles cannot be used here: a role consumes its click
 * before the renderer can preserve text-field editing versus DAW editing.
 */
export const createApplicationMenuTemplate = ({
    appName,
    send,
    recentProjects = [],
}: CreateApplicationMenuTemplateInput): MenuItemConstructorOptions[] => [
    {
        label: appName,
        submenu: [
            { role: 'about' },
            {
                label: 'Settings…',
                accelerator: 'CommandOrControl+,',
                click: () => send({ action: 'view:preferences' }),
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
        ],
    },
    {
        label: 'File',
        submenu: [
            action('New Project', 'CommandOrControl+N', send, 'project:new'),
            action('Import Project…', 'CommandOrControl+O', send, 'project:import-project'),
            {
                label: 'Open Recent',
                submenu: recentProjects.map((project) => ({
                    label: project.name,
                    click: () => send({ action: 'project:open-recent', recentKey: project.key }),
                })),
            },
            action('Import Audio…', undefined, send, 'project:import-audio'),
            action('Import MIDI…', undefined, send, 'project:import-midi'),
            { type: 'separator' },
            action('Save', 'CommandOrControl+S', send, 'project:save'),
            { type: 'separator' },
            action('Export Audio…', 'CommandOrControl+Shift+E', send, 'project:export-audio'),
            action('Export Project File…', undefined, send, 'project:export-file'),
            { type: 'separator' },
            { role: 'close' },
        ],
    },
    {
        label: 'Edit',
        submenu: [
            action('Undo', 'CommandOrControl+Z', send, 'edit:undo'),
            action('Redo', 'CommandOrControl+Shift+Z', send, 'edit:redo'),
            { type: 'separator' },
            action('Cut', 'CommandOrControl+X', send, 'edit:cut'),
            action('Copy', 'CommandOrControl+C', send, 'edit:copy'),
            action('Paste', 'CommandOrControl+V', send, 'edit:paste'),
            { type: 'separator' },
            action('Select All', 'CommandOrControl+A', send, 'edit:select-all'),
            action('Deselect All', 'CommandOrControl+Shift+A', send, 'edit:deselect-all'),
        ],
    },
    {
        label: 'View',
        submenu: [
            action('Toggle Sidebar', undefined, send, 'view:toggle-sidebar'),
            action('Toggle Mixer', undefined, send, 'view:toggle-mixer'),
            action('Toggle Inspector', undefined, send, 'view:toggle-inspector'),
            action('Toggle Track List', undefined, send, 'view:toggle-track-list'),
            action('Toggle Virtual Keyboard', undefined, send, 'view:toggle-virtual-keyboard'),
            action('Toggle Automation', undefined, send, 'view:toggle-automation'),
            action('Toggle AI Chat', undefined, send, 'view:toggle-chat'),
            { type: 'separator' },
            action('Zoom In', 'CommandOrControl+=', send, 'view:zoom-in'),
            action('Zoom Out', 'CommandOrControl+-', send, 'view:zoom-out'),
            action('Zoom to Fit', undefined, send, 'view:zoom-fit'),
            action('Zoom to Selection', undefined, send, 'view:zoom-selection'),
            { type: 'separator' },
            { role: 'togglefullscreen' },
        ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    { label: 'Help', submenu: [action('Show Tour Again', undefined, send, 'help:show-tour')] },
];
