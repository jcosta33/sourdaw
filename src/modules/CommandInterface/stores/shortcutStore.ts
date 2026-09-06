import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';
import { type AppAction } from '#/utils/handlerContract';

export type ShortcutAction = { type: 'appAction'; action: AppAction } | { type: 'callback'; id: string };

export type ShortcutDefinition = {
    id: string;
    label: string;
    category: 'transport' | 'editing' | 'view' | 'workflow';
    defaultKeys: string[];
    action: ShortcutAction;
};

export type ShortcutStoreState = {
    definitions: ShortcutDefinition[];
    customMappings: Record<string, string[]>;
};

type UnknownRecord = {
    [key: string]: unknown;
};

export const LOOP_STATION_PAD_ROWS: string[][] = [
    ['1', '2', '3', '4', '5', '6', '7', '8'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', ','],
];

export function getLoopStationPadCallbackId(rowIndex: number, columnIndex: number, record: boolean): string {
    return `loopStationPad.${record ? 'record' : 'play'}.r${rowIndex}c${columnIndex}`;
}

export type LoopStationPadKey = {
    rowIndex: number;
    columnIndex: number;
    record: boolean;
};

export function parseLoopStationPadCallbackId(callbackId: string): LoopStationPadKey | null {
    const match = /^loopStationPad\.(play|record)\.r(\d+)c(\d+)$/.exec(callbackId);
    if (!match) {
        return null;
    }
    const [, mode, rowStr, colStr] = match;
    const rowIndex = Number.parseInt(rowStr ?? '', 10);
    const columnIndex = Number.parseInt(colStr ?? '', 10);
    if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) {
        return null;
    }
    return { rowIndex, columnIndex, record: mode === 'record' };
}

function buildLoopStationPadDefinitions(): ShortcutDefinition[] {
    const defs: ShortcutDefinition[] = [];
    for (const [rowIndex, row] of LOOP_STATION_PAD_ROWS.entries()) {
        for (const [columnIndex, key] of row.entries()) {
            defs.push({
                id: `loopStation.pad.r${rowIndex}c${columnIndex}.play`,
                label: `Loop Station: Play row ${rowIndex + 1} col ${columnIndex + 1}`,
                category: 'transport',
                defaultKeys: [key],
                action: { type: 'callback', id: getLoopStationPadCallbackId(rowIndex, columnIndex, false) },
            });
            defs.push({
                id: `loopStation.pad.r${rowIndex}c${columnIndex}.record`,
                label: `Loop Station: Record row ${rowIndex + 1} col ${columnIndex + 1}`,
                category: 'transport',
                defaultKeys: [`shift+${key}`],
                action: { type: 'callback', id: getLoopStationPadCallbackId(rowIndex, columnIndex, true) },
            });
        }
    }
    return defs;
}

const INITIAL_DEFINITIONS: ShortcutDefinition[] = [
    {
        id: 'transport.togglePlayback',
        label: 'Toggle Playback',
        category: 'transport',
        defaultKeys: ['Space'],
        action: { type: 'appAction', action: { type: 'togglePlayback' } },
    },
    {
        id: 'transport.stopPlayback',
        label: 'Stop Playback / Clear Selection',
        category: 'transport',
        // Escape: context-dependent (clears selection or stops transport — see
        // handleKeydown). Enter: always stops transport (DAW convention).
        defaultKeys: ['Escape', 'Enter'],
        action: { type: 'callback', id: 'stopPlayback' },
    },
    {
        id: 'transport.panicAllNotes',
        label: 'MIDI Panic (All Notes Off)',
        category: 'transport',
        // Shift+Escape rather than plain Escape: Escape is context-dependent
        // (dismiss ghost clip / clear selection / stop), and a panic must fire
        // unconditionally — a stuck note is exactly the moment you cannot
        // afford the key to mean something else.
        defaultKeys: ['shift+Escape'],
        action: { type: 'callback', id: 'panicAllNotes' },
    },
    {
        id: 'transport.toggleMetronome',
        label: 'Toggle Metronome',
        category: 'transport',
        defaultKeys: ['m'],
        action: { type: 'appAction', action: { type: 'toggleMetronome' } },
    },
    {
        id: 'transport.toggleRecording',
        label: 'Toggle Recording',
        category: 'transport',
        defaultKeys: ['r'],
        action: { type: 'appAction', action: { type: 'toggleRecording' } },
    },
    {
        id: 'transport.toggleLoop',
        label: 'Toggle Loop',
        category: 'transport',
        defaultKeys: ['l'],
        action: { type: 'appAction', action: { type: 'toggleLoop' } },
    },
    {
        id: 'arrangement.addMidiTrack',
        label: 'Add MIDI Track',
        category: 'workflow',
        defaultKeys: ['n'],
        action: { type: 'appAction', action: { type: 'addTrack', payload: { name: 'MIDI', kind: 'midi' } } },
    },
    {
        id: 'arrangement.addAudioTrack',
        label: 'Add Audio Track',
        category: 'workflow',
        defaultKeys: ['shift+n'],
        action: { type: 'appAction', action: { type: 'addTrack', payload: { name: 'Audio', kind: 'audio' } } },
    },
    // ── Editing ──────────────────────────────────────────────────────────
    {
        id: 'editing.undo',
        label: 'Undo',
        category: 'editing',
        defaultKeys: ['mod+z'],
        action: { type: 'callback', id: 'undo' },
    },
    {
        id: 'editing.redo',
        label: 'Redo',
        category: 'editing',
        defaultKeys: ['mod+shift+z'],
        action: { type: 'callback', id: 'redo' },
    },
    {
        id: 'editing.copyClip',
        label: 'Copy Clip',
        category: 'editing',
        defaultKeys: ['mod+c'],
        action: { type: 'appAction', action: { type: 'copyClip' } },
    },
    {
        id: 'editing.cutClip',
        label: 'Cut Clip',
        category: 'editing',
        defaultKeys: ['mod+x'],
        action: { type: 'appAction', action: { type: 'cutClip' } },
    },
    {
        id: 'editing.pasteClip',
        label: 'Paste Clip',
        category: 'editing',
        defaultKeys: ['mod+v'],
        action: { type: 'appAction', action: { type: 'pasteClip' } },
    },
    {
        id: 'editing.deleteSelection',
        // Marquee-aware: deletes a time-range on selected tracks when a
        // marquee is active, otherwise deletes selected clips with undo.
        label: 'Delete Selection',
        category: 'editing',
        defaultKeys: ['Delete', 'Backspace'],
        action: { type: 'callback', id: 'deleteSelection' },
    },
    // ── Project ──────────────────────────────────────────────────────────
    {
        id: 'project.saveProject',
        label: 'Save Project',
        category: 'workflow',
        defaultKeys: ['mod+s'],
        action: { type: 'appAction', action: { type: 'saveProject' } },
    },
    {
        id: 'project.openExportDialog',
        label: 'Export Audio…',
        category: 'workflow',
        defaultKeys: ['mod+shift+e'],
        action: { type: 'callback', id: 'openExportDialog' },
    },
    {
        id: 'project.openPreferencesDialog',
        label: 'Preferences…',
        category: 'workflow',
        defaultKeys: ['mod+,'],
        action: { type: 'callback', id: 'openPreferencesDialog' },
    },
    // ── Workspace / View ─────────────────────────────────────────────────
    {
        id: 'workspace.toggleSidebar',
        label: 'Toggle Sidebar',
        category: 'view',
        defaultKeys: ['mod+b'],
        action: { type: 'appAction', action: { type: 'toggleSidebar' } },
    },
    {
        id: 'workspace.toggleInspector',
        label: 'Toggle Inspector',
        category: 'view',
        // `alt+i` preserved from the legacy `Workspace/models/Shortcuts.ts`
        // store for users who had muscle memory built up before unification.
        defaultKeys: ['mod+i', 'alt+i'],
        action: { type: 'appAction', action: { type: 'toggleInspector' } },
    },
    {
        id: 'workspace.toggleMixer',
        label: 'Toggle Mixer',
        category: 'view',
        // `alt+m` preserved from the legacy Workspace shortcut store. `m`
        // (without modifier) remains bound to the metronome (see above).
        defaultKeys: ['mod+m', 'alt+m'],
        action: { type: 'callback', id: 'toggleMixer' },
    },
    {
        id: 'workspace.toggleChatPanel',
        label: 'Toggle Chat Panel',
        category: 'view',
        defaultKeys: ['mod+j'],
        action: { type: 'appAction', action: { type: 'toggleChatPanel' } },
    },
    {
        id: 'workspace.toggleTrackList',
        label: 'Toggle Track List',
        category: 'view',
        defaultKeys: ['mod+t'],
        action: { type: 'callback', id: 'toggleTrackList' },
    },
    {
        id: 'workspace.toggleVirtualKeyboard',
        label: 'Toggle Virtual Keyboard',
        category: 'view',
        defaultKeys: ['mod+shift+k'],
        action: { type: 'callback', id: 'toggleVirtualKeyboard' },
    },
    {
        id: 'workspace.showAutomationPanel',
        label: 'Show Automation Panel',
        category: 'view',
        defaultKeys: ['mod+shift+a'],
        action: { type: 'callback', id: 'showAutomationPanel' },
    },
    {
        id: 'view.zoomIn',
        label: 'Zoom In',
        category: 'view',
        // §8.16 — bind `Cmd+=` / `Cmd++` explicitly so the browser's built-in
        // page-zoom shortcut doesn't win. `handleKeydown` returns `true` for
        // the zoom callbacks and `useGlobalKeyboardShortcuts` calls
        // `preventDefault()`, which blocks the browser default.
        defaultKeys: ['mod+=', 'mod++', '=', '+'],
        action: { type: 'callback', id: 'zoomIn' },
    },
    {
        id: 'view.zoomOut',
        label: 'Zoom Out',
        category: 'view',
        defaultKeys: ['mod+-', '-'],
        action: { type: 'callback', id: 'zoomOut' },
    },
    {
        id: 'workspace.toggleCommandPalette',
        label: 'Toggle Command Palette',
        category: 'workflow',
        defaultKeys: ['mod+k'],
        action: { type: 'callback', id: 'toggleCommandPalette' },
    },
    {
        id: 'workspace.selectAllClips',
        label: 'Select All Clips',
        category: 'editing',
        defaultKeys: ['mod+a'],
        action: { type: 'callback', id: 'selectAllClips' },
    },
    // NOTE: there is intentionally no `workspace.clearClipSelection` /
    // `Escape` definition here. `transport.stopPlayback` already binds
    // `Escape` earlier in this list, and the `handleKeydown` loop returns on
    // the first matching definition — so a second `Escape` entry was dead
    // code. The `stopPlayback` callback clears the active selection before
    // stopping transport, so Escape-to-deselect behaviour is preserved.
    {
        id: 'arrangement.duplicateTrack',
        label: 'Duplicate Track',
        category: 'editing',
        defaultKeys: ['mod+shift+d'],
        action: { type: 'callback', id: 'duplicateTrack' },
    },
    {
        id: 'arrangement.duplicateClip',
        label: 'Duplicate Clip',
        category: 'editing',
        defaultKeys: ['mod+d'],
        action: { type: 'appAction', action: { type: 'duplicateClip', payload: { clipId: 'selected' } } },
    },
    {
        id: 'arrangement.duplicateClipToNextBar',
        label: 'Duplicate Clip to Next Bar',
        category: 'editing',
        defaultKeys: ['alt+d'],
        action: { type: 'appAction', action: { type: 'duplicateClipToNextBar', payload: { clipId: 'selected' } } },
    },
    {
        id: 'view.zoomToFit',
        label: 'Zoom to Fit',
        category: 'view',
        defaultKeys: ['f', 'mod+shift+f'],
        action: { type: 'appAction', action: { type: 'zoomToFit' } },
    },
    {
        id: 'view.zoomToSelection',
        label: 'Zoom to Selection',
        category: 'view',
        // `shift+f`, not bare `'F'`: `matches()` compares `hasShift` (derived
        // from the combo's modifier list) against `desc.shift`. A bare `'F'`
        // combo has no `shift` modifier, so it only matches an event with
        // `shift === false` — but you can't type uppercase `F` without Shift,
        // so it was unreachable (and `'f'` matched `view.zoomToFit` first).
        // `'shift+f'` makes the exact-modifier match fire on Shift+F.
        defaultKeys: ['shift+f'],
        action: { type: 'appAction', action: { type: 'zoomToSelection' } },
    },
    {
        id: 'view.zoomTracksVerticalIn',
        label: 'Zoom Tracks In',
        category: 'view',
        defaultKeys: ['mod+shift+=', 'mod+shift++'],
        action: { type: 'appAction', action: { type: 'zoomTracksVertical', payload: { delta: 10 } } },
    },
    {
        id: 'view.zoomTracksVerticalOut',
        label: 'Zoom Tracks Out',
        category: 'view',
        defaultKeys: ['mod+shift+-'],
        action: { type: 'appAction', action: { type: 'zoomTracksVertical', payload: { delta: -10 } } },
    },
    {
        id: 'arrangement.clearSolos',
        label: 'Clear All Solos',
        category: 'transport',
        defaultKeys: ['alt+s'],
        action: { type: 'appAction', action: { type: 'clearSolos' } },
    },
    {
        id: 'view.cycleAutomationVisibility',
        label: 'Cycle Automation Visibility',
        category: 'view',
        defaultKeys: ['a'],
        action: { type: 'callback', id: 'cycleAutomationVisibility' },
    },
    {
        id: 'view.toggleWorkspaceMode',
        label: 'Toggle Arrange / Clip Mode',
        category: 'view',
        defaultKeys: ['Tab'],
        action: { type: 'callback', id: 'toggleWorkspaceMode' },
    },
    {
        id: 'arrangement.loopFromSelection',
        label: 'Set Loop from Selection',
        category: 'editing',
        defaultKeys: ['mod+l'],
        action: { type: 'callback', id: 'loopFromSelection' },
    },
    {
        id: 'arrangement.deleteTimeRange',
        label: 'Delete Time Range',
        category: 'editing',
        // `Backspace` capitalized exactly as the browser reports it:
        // `matches()` compares multi-char key names case-sensitively, so a
        // lowercase `mod+backspace` combo could never fire.
        defaultKeys: ['mod+Backspace'],
        action: { type: 'callback', id: 'deleteTimeRange' },
    },
    {
        id: 'arrangement.insertSilence',
        label: 'Insert Silence at Selection',
        category: 'editing',
        defaultKeys: ['mod+shift+i'],
        action: { type: 'callback', id: 'insertSilence' },
    },
    {
        id: 'arrangement.duplicateTimeRange',
        label: 'Duplicate Time Range',
        category: 'editing',
        defaultKeys: ['mod+shift+r'],
        action: { type: 'callback', id: 'duplicateTimeRange' },
    },
    {
        id: 'arrangement.cycleGhostClipNext',
        label: 'Select Next Ghost Clip',
        category: 'editing',
        defaultKeys: ['alt+]'],
        action: { type: 'callback', id: 'cycleGhostClipNext' },
    },
    {
        id: 'arrangement.cycleGhostClipPrev',
        label: 'Select Previous Ghost Clip',
        category: 'editing',
        defaultKeys: ['alt+['],
        action: { type: 'callback', id: 'cycleGhostClipPrev' },
    },
    // ── AI Generation chords ─────────────────────────────────────────────
    // `g` is a leader key — press `g` then a second key within ~1.5 s to
    // dispatch. Implemented via callback so the chord state machine in
    // handleKeydown can intercept the leader press without dispatching an
    // AppAction until the second key resolves.
    {
        id: 'ai.leaderKey',
        label: 'AI Generate… (leader key, then D/M/C/B)',
        category: 'workflow',
        defaultKeys: ['g'],
        action: { type: 'callback', id: 'aiLeaderKey' },
    },
    // ── Loop Station pads ────────────────────────────────────────────────
    // Ableton-style 4x8 pad grid. Plain press triggers the matching slot;
    // shift-press starts / re-records it. Rows 1–4 map to QWERTY rows
    // `1..8`, `q..i`, `a..k`, `z..,`. Esc routes through the transport
    // stopPlayback callback (see handleKeydown) which also stops all
    // loop station slots when any are active.
    ...buildLoopStationPadDefinitions(),
];

const storage = createLocalStorage<ShortcutStoreState>('sourdaw-shortcuts');

function createInitialShortcutStoreState(): ShortcutStoreState {
    return {
        definitions: INITIAL_DEFINITIONS,
        customMappings: {},
    };
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStoredCustomMappings(value: unknown): Record<string, string[]> {
    if (!isRecord(value)) {
        return {};
    }

    const customMappings: Record<string, string[]> = {};
    for (const [definitionId, keys] of Object.entries(value)) {
        if (!Array.isArray(keys)) {
            continue;
        }

        const validKeys: string[] = [];
        let hasOnlyStringKeys = true;
        for (const key of keys) {
            if (typeof key !== 'string') {
                hasOnlyStringKeys = false;
                break;
            }

            validKeys.push(key);
        }

        if (!hasOnlyStringKeys) {
            continue;
        }

        customMappings[definitionId] = validKeys;
    }

    return customMappings;
}

function validateStoredShortcutStoreState(value: unknown): ShortcutStoreState {
    if (!isRecord(value)) {
        return createInitialShortcutStoreState();
    }

    return {
        definitions: INITIAL_DEFINITIONS,
        customMappings: validateStoredCustomMappings(value.customMappings),
    };
}

export const shortcutStore = createStore<ShortcutStoreState>({
    storage,
    initialData: createInitialShortcutStoreState(),
    sanitize: validateStoredShortcutStoreState,
});
