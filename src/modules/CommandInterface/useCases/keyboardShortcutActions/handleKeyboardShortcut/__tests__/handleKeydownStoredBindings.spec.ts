import { parse } from 'superjson';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { shortcutStore, type ShortcutStoreState } from '../../../../stores/shortcutStore';
import { resolveShortcutKey } from '../../../resolveShortcutKey';
import { handleKeydown, type KeyDescriptor } from '../handleKeydown';

// Bindings a build before physical-key resolution captured: the produced
// character of Option+D and Shift+1 on a US Mac. Seeded before any import
// evaluates the store, so its first load reads them.
const STORAGE_KEY = 'sourdaw-shortcuts';
vi.hoisted(() => {
    window.localStorage.setItem(
        'sourdaw-shortcuts',
        JSON.stringify({
            json: {
                definitions: [],
                customMappings: {
                    'transport.toggleMetronome': ['alt+∂'],
                    'transport.toggleLoop': ['shift+!'],
                },
            },
        })
    );
});

const eventBus = {
    emit: vi.fn(),
    on: vi.fn(() => () => undefined),
};

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: vi.fn(),
    seekPlayhead: vi.fn(),
    setLoopRegion: vi.fn(),
    stopAllSlots: vi.fn(),
    triggerPad: vi.fn(),
    panicAllNotes: vi.fn(),
}));

vi.mock('../../trackShortcuts/clearSolos', () => ({ clearSolos: vi.fn() }));
vi.mock('../../trackShortcuts/addTrack', () => ({ addTrack: vi.fn() }));
vi.mock('../../trackShortcuts/duplicateTrack', () => ({ duplicateTrack: vi.fn() }));
vi.mock('../../trackShortcuts/duplicateClip', () => ({ duplicateClip: vi.fn() }));
vi.mock('../../trackShortcuts/duplicateClipToNextBar', () => ({ duplicateClipToNextBar: vi.fn() }));
vi.mock('../../trackShortcuts/zoomTracksVertical', () => ({ zoomTracksVertical: vi.fn() }));

vi.mock('../../workspaceShortcuts/setEditingTool', () => ({ setEditingTool: vi.fn() }));
vi.mock('../../workspaceShortcuts/zoomToFit', () => ({ zoomToFit: vi.fn() }));
vi.mock('../../workspaceShortcuts/zoomToSelection', () => ({ zoomToSelection: vi.fn() }));

vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/WorkspaceShell/stores')>();
    return {
        ...actual,
        workspaceStore: { value: { selectedClipIds: [], selectedClipId: null } },
        toolSwapStore: { value: null, set: vi.fn() },
    };
});

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    closeCollaborationPanel: vi.fn(),
    cycleAutomationVisibility: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleWorkspaceMode: vi.fn(),
    setEditingTool: vi.fn(),
    startToolSwap: vi.fn(),
    finishToolSwap: vi.fn(),
    showDevicePanel: vi.fn(),
    toggleMixer: vi.fn(),
    toggleTrackList: vi.fn(),
    toggleVirtualKeyboard: vi.fn(),
    openExportDialog: vi.fn(),
    openPreferencesDialog: vi.fn(),
    getToolForKeyPress: vi.fn(() => null),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    readMusicalRangeInputs: vi.fn(() => []),
    trackStore: { value: { selectedTrackId: null, tracks: [] } },
    resolveEligibleClipWriteTarget: vi.fn<typeof import('#/modules/Arrangement/stores').resolveEligibleClipWriteTarget>(
        () => ({ status: 'missing' })
    ),
    clipSelectionStore: { value: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null } },
    readMusicalRange: vi.fn(),
    zoomTimeline: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    acceptGhostClip: vi.fn(),
    dismissGhostClip: vi.fn(),
    deleteTimeRange: vi.fn(),
    insertTime: vi.fn(),
    duplicateTimeRange: vi.fn(),
    removeClip: vi.fn(),
    addClip: vi.fn(),
    captureRetiredTakeLanes: vi.fn(() => []),
    restoreTakesForClip: vi.fn(),
    clearClipSelection: vi.fn(),
    selectAllClips: vi.fn(),
    selectClipWithFocus: vi.fn(),
    setMarqueeSelection: vi.fn(),
    cancelActiveTimelineGesture: vi.fn(() => false),
    executeUndoableDuplicateTimeRange: vi.fn(),
    executeUndoableInsertTime: vi.fn(),
    getAllTracks: vi.fn(() => []),
    getLastClipEndBeat: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    redo: vi.fn(),
    undo: vi.fn(),
    pushUndoEntry: vi.fn(),
    executeAppAction: vi.fn(),
    executeUserAppAction: vi.fn(),
}));

vi.mock('../../../selectionHelpers/getAllClipIds', () => ({ getAllClipIds: vi.fn() }));
vi.mock('../../../selectionHelpers/goToNextMarker', () => ({ goToNextMarker: vi.fn() }));
vi.mock('../../../selectionHelpers/goToPreviousMarker', () => ({ goToPreviousMarker: vi.fn() }));

function pressed(init: { key: string; code: string; shift?: boolean; alt?: boolean }): KeyDescriptor {
    const shift = init.shift ?? false;
    const alt = init.alt ?? false;
    const key = resolveShortcutKey({ key: init.key, code: init.code, shiftKey: shift, altKey: alt }, null);
    return { key, mod: false, shift, alt, repeat: false, keyTarget: 'workspace' };
}

function storedCustomMappings(): ShortcutStoreState['customMappings'] | undefined {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? undefined : parse<ShortcutStoreState>(raw).customMappings;
}

describe('shortcut bindings stored before physical-key resolution', () => {
    beforeEach(() => {
        injectDependencies(handleKeydown, { eventBus });
        vi.clearAllMocks();
    });

    afterAll(() => {
        window.localStorage.clear();
    });

    it('load as the physical keys they were pressed on, in the store and in storage', () => {
        const migrated = { 'transport.toggleMetronome': ['alt+d'], 'transport.toggleLoop': ['shift+1'] };

        expect(shortcutStore.value?.customMappings).toStrictEqual(migrated);
        expect(storedCustomMappings()).toStrictEqual(migrated);
    });

    it('fire on the keypress that captured them', () => {
        handleKeydown(pressed({ key: '∂', code: 'KeyD', alt: true }));
        handleKeydown(pressed({ key: '!', code: 'Digit1', shift: true }));

        expect(vi.mocked(executeUserAppAction).mock.calls).toStrictEqual([
            [{ type: 'toggleMetronome' }],
            [{ type: 'toggleLoop' }],
        ]);
    });
});
