import { openPreferencesDialog } from '#/modules/Workspace/useCases';

import { type PresetAction } from './Types';

export const workspacePresets: readonly PresetAction[] = [
    {
        id: 'view-arrange',
        label: 'Switch to Arrange View',
        keywords: ['arrange', 'arrange view', 'arrangement', 'timeline'],
        category: 'Workspace',
        buildAction: () => ({ type: 'setWorkspaceMode', payload: { mode: 'arrange' } }),
    },
    {
        id: 'view-clip',
        label: 'Switch to Clip View',
        keywords: ['clip view', 'clip editor', 'piano roll', 'editor'],
        category: 'Workspace',
        buildAction: () => ({ type: 'setWorkspaceMode', payload: { mode: 'clip' } }),
    },
    {
        id: 'view-mix',
        label: 'Open Mixer Panel',
        keywords: ['mix view', 'mixer', 'console', 'faders'],
        category: 'Workspace',
        buildAction: () => ({ type: 'openMixer' }),
    },
    {
        id: 'open-mixer',
        label: 'Open Mixer Panel',
        keywords: ['open mixer', 'show mixer'],
        category: 'Workspace',
        buildAction: () => ({ type: 'openMixer' }),
    },
    {
        id: 'close-mixer',
        label: 'Close Mixer Panel',
        keywords: ['close mixer', 'hide mixer'],
        category: 'Workspace',
        buildAction: () => ({ type: 'closeMixer' }),
    },
    {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        keywords: ['sidebar', 'browser', 'toggle sidebar', 'show browser', 'hide browser'],
        category: 'Workspace',
        buildAction: () => ({ type: 'toggleSidebar' }),
    },
    {
        id: 'toggle-inspector',
        label: 'Toggle Inspector',
        keywords: ['inspector', 'toggle inspector', 'show inspector', 'hide inspector', 'properties'],
        category: 'Workspace',
        buildAction: () => ({ type: 'toggleInspector' }),
    },
    {
        id: 'toggle-chat',
        label: 'Toggle AI Chat Panel',
        keywords: ['chat', 'ai chat', 'toggle chat', 'copilot'],
        category: 'Workspace',
        buildAction: () => ({ type: 'toggleChatPanel' }),
    },
    {
        id: 'zoom-fit',
        label: 'Zoom to Fit',
        keywords: ['zoom fit', 'zoom to fit', 'fit all', 'overview'],
        category: 'Workspace',
        buildAction: () => ({ type: 'zoomToFit' }),
    },
    {
        id: 'zoom-selection',
        label: 'Zoom to Selection',
        keywords: ['zoom selection', 'zoom to selection', 'fit selection'],
        category: 'Workspace',
        buildAction: () => ({ type: 'zoomToSelection' }),
    },
    {
        id: 'preferences',
        label: 'Open Preferences',
        keywords: ['preferences', 'settings', 'options', 'config'],
        category: 'Workspace',
        buildAction: () => {
            openPreferencesDialog();
            return [];
        },
    },
];
