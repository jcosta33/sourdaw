import { copySelectedClip, cutSelectedClip, pasteClip } from '#/modules/Arrangement/useCases';

import { deselectAllClips } from '../../useCases/deselectAllClips';
import { redo } from '../../useCases/redo';
import { selectAllClips } from '../../useCases/selectAllClips';
import { undo } from '../../useCases/undo';
import { type CommandEntry } from '../CommandEntry';

/** Edit commands — undo, redo, copy, cut, paste, select/deselect all. */
export const editCommands: CommandEntry[] = [
    {
        id: 'undo',
        label: 'Undo',
        description: 'Undo last action',
        category: 'Edit',
        shortcut: '⌘Z',
        action: () => {
            void undo();
        },
    },
    {
        id: 'redo',
        label: 'Redo',
        description: 'Redo last undone action',
        category: 'Edit',
        shortcut: '⌘⇧Z',
        action: () => {
            void redo();
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
        // No `shortcut` advertised: `⌘⇧D` was a lie — that combo is bound to
        // `arrangement.duplicateTrack` in `shortcutStore`, and there is no
        // dedicated deselect binding. The keyboard path to clear a selection
        // is `Escape` (context-dependent: `transport.stopPlayback` clears the
        // active selection before stopping transport), which can't be honestly
        // labelled here as a single Deselect-All keycap.
        action: () => {
            deselectAllClips();
        },
    },
];
