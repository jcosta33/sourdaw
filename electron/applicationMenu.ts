import type { MenuItemConstructorOptions } from 'electron';

export type NativeMenuAction =
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

export type NativeMenuIntent = {
    readonly action: NativeMenuAction;
    readonly requestId?: number;
    readonly recentKey?: string;
};

export type NativeRecentProject = { readonly key: string; readonly name: string };

const nativeMenuActions = new Set<NativeMenuAction>([
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
]);

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
    if (
        'requestId' in value &&
        (typeof value.requestId !== 'number' || !Number.isSafeInteger(value.requestId) || value.requestId < 1)
    ) {
        return false;
    }
    return !('recentKey' in value) || typeof value.recentKey === 'string';
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
