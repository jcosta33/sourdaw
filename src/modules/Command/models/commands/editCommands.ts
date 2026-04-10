import { type CommandEntry } from '../CommandRegistry';
import { undo, redo } from '#/modules/Command/useCases/undoRedo';
import { copySelectedClip, cutSelectedClip, pasteClip } from '#/modules/Arrangement';
import { selectAllClips } from '#/modules/Command/useCases/selectAllClips';
import { deselectAllClips } from '#/modules/Command/useCases/deselectAllClips';

/** Edit commands — undo, redo, copy, cut, paste, select/deselect all. */
export const editCommands: CommandEntry[] = [
    {
        id: 'undo',
        label: 'Undo',
        description: 'Undo last action',
        category: 'Edit',
        shortcut: '⌘Z',
        action: () => {
            undo();
        },
    },
    {
        id: 'redo',
        label: 'Redo',
        description: 'Redo last undone action',
        category: 'Edit',
        shortcut: '⌘⇧Z',
        action: () => {
            redo();
        },
    },
    {
        id: 'copy-clip',
        label: 'Copy Clip',
        description: 'Copy the selected clip',
        category: 'Edit',
        shortcut: '⌘C',
        action: () => {
            copySelectedClip();
        },
    },
    {
        id: 'cut-clip',
        label: 'Cut Clip',
        description: 'Cut the selected clip',
        category: 'Edit',
        shortcut: '⌘X',
        action: () => {
            cutSelectedClip();
        },
    },
    {
        id: 'paste-clip',
        label: 'Paste Clip',
        description: 'Paste clip at playhead',
        category: 'Edit',
        shortcut: '⌘V',
        action: () => {
            pasteClip();
        },
    },
    {
        id: 'select-all',
        label: 'Select All Clips',
        description: 'Select every clip on the timeline',
        category: 'Edit',
        shortcut: '⌘A',
        action: () => {
            selectAllClips();
        },
    },
    {
        id: 'deselect-all',
        label: 'Deselect All',
        description: 'Clear clip selection',
        category: 'Edit',
        shortcut: '⌘⇧A',
        action: () => {
            deselectAllClips();
        },
    },
];
