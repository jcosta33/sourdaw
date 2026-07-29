import { type PresetAction } from './Types';

export const filePresets: readonly PresetAction[] = [
    {
        id: 'scan-plugins',
        label: 'Scan Plugins',
        keywords: ['scan plugins', 'rescan plugins', 'plugin scan'],
        category: 'File',
        buildAction: () => ({ type: 'scanPlugins' }),
    },
    {
        id: 'undo',
        label: 'Undo',
        keywords: ['undo', 'ctrl z', 'cmd z'],
        category: 'File',
        buildAction: () => ({ type: 'undo' }),
    },
    {
        id: 'redo',
        label: 'Redo',
        keywords: ['redo', 'ctrl shift z', 'cmd shift z'],
        category: 'File',
        buildAction: () => ({ type: 'redo' }),
    },
];

export const collaborationPresets: readonly PresetAction[] = [
    {
        id: 'start-collab',
        label: 'Start Collaboration Session',
        keywords: ['collaboration', 'collab', 'start session', 'multiplayer'],
        category: 'Collaboration',
        buildAction: () => ({ type: 'createCollabSession', payload: { name: 'Host' } }),
    },
];
