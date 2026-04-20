import { eventBus } from '#/app/registerDependencies';

import { type PresetAction } from './types';

export const filePresets: readonly PresetAction[] = [
    {
        id: 'save',
        label: 'Save Project',
        keywords: ['save', 'save project', 'ctrl s'],
        category: 'File',
        buildAction: () => ({ type: 'saveProject' }),
    },
    {
        id: 'new-project',
        label: 'New Project',
        keywords: ['new project', 'new', 'fresh project'],
        category: 'File',
        buildAction: () => ({ type: 'newProject' }),
    },
    {
        id: 'export',
        label: 'Export / Bounce / Render',
        keywords: ['export', 'bounce', 'render', 'mixdown', 'wav', 'mp3', 'export audio'],
        category: 'File',
        buildAction: () => ({ type: 'exportProject' }),
    },
    {
        id: 'import-audio',
        label: 'Import Audio File',
        keywords: ['import audio', 'import wav', 'import mp3', 'import file', 'open audio'],
        category: 'File',
        buildAction: () => ({ type: 'importAudioFile' }),
    },
    {
        id: 'import-midi',
        label: 'Import MIDI File',
        keywords: ['import midi', 'open midi'],
        category: 'File',
        buildAction: () => ({ type: 'importMidiFile' }),
    },
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
        buildAction: () => {
            eventBus.emit('command.undo', undefined);
            return [];
        },
    },
    {
        id: 'redo',
        label: 'Redo',
        keywords: ['redo', 'ctrl shift z', 'cmd shift z'],
        category: 'File',
        buildAction: () => {
            eventBus.emit('command.redo', undefined);
            return [];
        },
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
    {
        id: 'leave-collab',
        label: 'Leave Collaboration',
        keywords: ['leave session', 'stop collaboration', 'disconnect'],
        category: 'Collaboration',
        buildAction: () => ({ type: 'leaveCollabSession' }),
    },
];
