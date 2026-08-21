import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { zoomTimeline } from '#/modules/Arrangement/stores';
import {
    acceptGhostClip,
    clearClipSelection,
    deleteTimeRange,
    dismissGhostClip,
    executeUndoableDuplicateTimeRange,
    executeUndoableInsertTime,
    removeClip,
    selectAllClips,
    selectClipWithFocus,
    setMarqueeSelection,
} from '#/modules/Arrangement/useCases';
import { executeAppAction, pushUndoEntry, redo, undo } from '#/modules/Command/useCases';
import { stopAllSlots, triggerPad } from '#/modules/SessionLauncher/useCases';
import { seekPlayhead, setLoopRegion } from '#/modules/Transport/useCases';
import {
    cycleAutomationVisibility,
    openExportDialog,
    openPreferencesDialog,
    setEditingTool,
    showAutomationPanel,
    startToolSwap,
    toggleCommandPalette,
    toggleMixer,
    toggleTrackList,
    toggleVirtualKeyboard,
    toggleWorkspaceMode,
} from '#/modules/WorkspaceShell/useCases';

import { parseLoopStationPadCallbackId, type ShortcutAction } from '../../../../stores/shortcutStore';
import { getAllClipIds } from '../../../selectionHelpers/getAllClipIds';
import { duplicateSelectedClipsForward } from '../../clipShortcuts/duplicateSelectedClipsForward';
import { duplicateTrack } from '../../trackShortcuts/duplicateTrack';
import { handleKeydown, type KeyDescriptor } from '../handleKeydown';

type MinimalDefinition = { id: string; defaultKeys: string[]; action: ShortcutAction };
type MockClip = { id: string; startBeat: number; endBeat: number; isGhost?: boolean };
type MockTrack = { id: string; clips: MockClip[] };
type MockGhostClip = { id: string; trackId: string };
type MockMarqueeSelection = { startBeat: number; endBeat: number; trackIds: string[] };

const {
    getLastClipEndBeatMock,
    goToNextMarkerMock,
    goToPreviousMarkerMock,
    loggerMock,
    shortcutStoreMock,
    stopPlaybackMock,
    panicAllNotesMock,
    trackStoreMock,
    clipSelectionStoreMock,
    loopStationStoreMock,
} = vi.hoisted(() => ({
    getLastClipEndBeatMock: vi.fn(() => 42),
    goToNextMarkerMock: vi.fn(),
    goToPreviousMarkerMock: vi.fn(),
    loggerMock: { error: vi.fn() },
    shortcutStoreMock: {
        value: {
            definitions: [] as MinimalDefinition[],
            customMappings: {},
        },
    },
    stopPlaybackMock: vi.fn(() => Promise.resolve()),
    panicAllNotesMock: vi.fn(() => Promise.resolve()),
    trackStoreMock: {
        value: {
            selectedTrackId: null as string | null,
            tracks: [] as MockTrack[],
            ghostClips: [] as MockGhostClip[],
        },
    },
    clipSelectionStoreMock: {
        value: {
            selectedClipId: null as string | null,
            selectedClipIds: [] as string[],
            marqueeSelection: null as MockMarqueeSelection | null,
        },
    },
    loopStationStoreMock: {
        value: {
            armed: false,
            slots: [] as { state: string }[],
        },
    },
}));

const eventBus = { emit: vi.fn(), on: vi.fn(() => () => undefined) };

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: trackStoreMock,
    clipSelectionStore: clipSelectionStoreMock,
    zoomTimeline: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    acceptGhostClip: vi.fn(),
    dismissGhostClip: vi.fn(),
    deleteTimeRange: vi.fn(),
    executeUndoableInsertTime: vi.fn(),
    executeUndoableDuplicateTimeRange: vi.fn(),
    removeClip: vi.fn(),
    addClip: vi.fn(),
    clearClipSelection: vi.fn(),
    selectAllClips: vi.fn(),
    selectClipWithFocus: vi.fn(),
    setMarqueeSelection: vi.fn(),
}));

vi.mock('#/modules/SessionLauncher/stores', () => ({
    loopStationStore: loopStationStoreMock,
}));

vi.mock('#/modules/SessionLauncher/useCases', () => ({
    stopAllSlots: vi.fn(),
    triggerPad: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: stopPlaybackMock,
    panicAllNotes: panicAllNotesMock,
    seekPlayhead: vi.fn(),
    setLoopRegion: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: { value: { activeTool: 'select', selectedClipIds: [], selectedClipId: null } },
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    cycleAutomationVisibility: vi.fn(),
    openExportDialog: vi.fn(),
    openPreferencesDialog: vi.fn(),
    setEditingTool: vi.fn(),
    showAutomationPanel: vi.fn(),
    startToolSwap: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleMixer: vi.fn(),
    toggleTrackList: vi.fn(),
    toggleVirtualKeyboard: vi.fn(),
    toggleWorkspaceMode: vi.fn(),
    TOOL_SHORTCUTS: { d: 'draw' },
}));

vi.mock('../../../../stores/shortcutStore', () => ({
    parseLoopStationPadCallbackId: vi.fn(() => null),
    shortcutStore: shortcutStoreMock,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: loggerMock }));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual: typeof import('#/modules/Command/useCases') = await importOriginal();
    return {
        ...actual,
        executeAppAction: vi.fn(),
        pushUndoEntry: vi.fn(),
        redo: vi.fn(),
        undo: vi.fn(),
    };
});
vi.mock('../../../selectionHelpers/getAllClipIds', () => ({ getAllClipIds: vi.fn(() => []) }));
vi.mock('../../../selectionHelpers/getLastClipEndBeat', () => ({ getLastClipEndBeat: getLastClipEndBeatMock }));
vi.mock('../../../selectionHelpers/goToNextMarker', () => ({ goToNextMarker: goToNextMarkerMock }));
vi.mock('../../../selectionHelpers/goToPreviousMarker', () => ({ goToPreviousMarker: goToPreviousMarkerMock }));
vi.mock('../../clipShortcuts/duplicateSelectedClipsForward', () => ({ duplicateSelectedClipsForward: vi.fn() }));
vi.mock('../../trackShortcuts/duplicateTrack', () => ({ duplicateTrack: vi.fn() }));

function descriptor(overrides: Partial<KeyDescriptor> & { key: string }): KeyDescriptor {
    return { mod: false, shift: false, alt: false, repeat: false, isInput: false, ...overrides };
}

function callbackDefinition(input: { id: string; key: string; callbackId: string }): MinimalDefinition {
    return {
        id: input.id,
        defaultKeys: [input.key],
        action: { type: 'callback', id: input.callbackId },
    };
}

describe('handleKeydown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        shortcutStoreMock.value.definitions = [];
        shortcutStoreMock.value.customMappings = {};
        trackStoreMock.value = { selectedTrackId: null, tracks: [], ghostClips: [] };
        clipSelectionStoreMock.value = { selectedClipId: null, selectedClipIds: [], marqueeSelection: null };
        loopStationStoreMock.value = { armed: false, slots: [] };
        injectDependencies(handleKeydown, { eventBus });
    });

    it('does not turn a bare v into a microphone start', () => {
        const prevent = handleKeydown(descriptor({ key: 'v' }));

        expect(prevent).toBe(false);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('does not toggle voice when v is pressed inside an input field', () => {
        const prevent = handleKeydown(descriptor({ key: 'v', isInput: true }));

        expect(prevent).toBe(false);
        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('seeks the playhead to the start on Home', () => {
        const prevent = handleKeydown(descriptor({ key: 'Home' }));

        expect(prevent).toBe(true);
        expect(seekPlayhead).toHaveBeenCalledWith(0);
    });

    it('seeks the playhead to the last clip end on End', () => {
        const prevent = handleKeydown(descriptor({ key: 'End' }));

        expect(prevent).toBe(true);
        expect(getLastClipEndBeatMock).toHaveBeenCalled();
        expect(seekPlayhead).toHaveBeenCalledWith(42);
    });

    it('scrolls to the playhead on L without preventing default', () => {
        const prevent = handleKeydown(descriptor({ key: 'L' }));

        expect(prevent).toBe(false);
        expect(eventBus.emit).toHaveBeenCalledWith('zoom.scrollToPlayhead', undefined);
    });

    it('navigates to the next marker on ] and does not prevent default', () => {
        const prevent = handleKeydown(descriptor({ key: ']' }));

        expect(prevent).toBe(false);
        expect(goToNextMarkerMock).toHaveBeenCalledTimes(1);
    });

    it('navigates to the previous marker on [', () => {
        handleKeydown(descriptor({ key: '[' }));

        expect(goToPreviousMarkerMock).toHaveBeenCalledTimes(1);
    });

    it('blocks plain keys while typing in an input field', () => {
        const prevent = handleKeydown(descriptor({ key: 'Home', isInput: true }));

        expect(prevent).toBe(false);
        expect(seekPlayhead).not.toHaveBeenCalled();
    });

    it('asks Workspace to start a held tool swap before selecting the requested tool', () => {
        const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(1234);

        const prevent = handleKeydown(descriptor({ key: 'd' }));

        expect(prevent).toBe(false);
        expect(startToolSwap).toHaveBeenCalledWith({
            key: 'd',
            timestamp: 1234,
            tool: 'draw',
        });
        expect(setEditingTool).toHaveBeenCalledWith('draw');
        const [startOrder] = vi.mocked(startToolSwap).mock.invocationCallOrder;
        const [selectOrder] = vi.mocked(setEditingTool).mock.invocationCallOrder;
        if (startOrder === undefined || selectOrder === undefined) {
            throw new Error('expected tool-swap and tool-selection calls to be recorded');
        }
        expect(startOrder).toBeLessThan(selectOrder);

        performanceNow.mockRestore();
    });

    // audit MD-6 — a stuck note previously had no user-triggered recovery at all.
    describe('MIDI panic shortcut', () => {
        function bindPanic(): void {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'transport.panicAllNotes', key: 'shift+Escape', callbackId: 'panicAllNotes' }),
                callbackDefinition({ id: 'transport.stopPlayback', key: 'Escape', callbackId: 'stopPlayback' }),
            ];
        }

        it('panics on shift+Escape and consumes the key', () => {
            bindPanic();

            const prevent = handleKeydown(descriptor({ key: 'Escape', shift: true }));

            expect(prevent).toBe(true);
            expect(panicAllNotesMock).toHaveBeenCalledTimes(1);
            expect(stopPlaybackMock).not.toHaveBeenCalled();
        });

        it('fires even with a clip selected, which swallows the plain Escape stop', () => {
            bindPanic();
            clipSelectionStoreMock.value = {
                selectedClipId: 'clip-1',
                selectedClipIds: ['clip-1'],
                marqueeSelection: null,
            };

            handleKeydown(descriptor({ key: 'Escape', shift: true }));

            expect(panicAllNotesMock).toHaveBeenCalledTimes(1);
        });

        it('leaves a bare Escape as stop, not panic', () => {
            bindPanic();

            handleKeydown(descriptor({ key: 'Escape' }));

            expect(panicAllNotesMock).not.toHaveBeenCalled();
            expect(stopPlaybackMock).toHaveBeenCalledTimes(1);
        });

        it('reports a failed panic rather than silently reporting success', async () => {
            const panicError = new Error('worker gone');
            panicAllNotesMock.mockRejectedValueOnce(panicError);
            bindPanic();

            handleKeydown(descriptor({ key: 'Escape', shift: true }));

            await vi.waitFor(() => expect(loggerMock.error).toHaveBeenCalledTimes(1));
            expect(loggerMock.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Keyboard shortcut MIDI panic failed',
                    cause: panicError,
                })
            );
        });
    });

    it('reports a rejected stopPlayback promise from the shortcut', async () => {
        const flushError = new Error('recording flush failed');
        stopPlaybackMock.mockRejectedValueOnce(flushError);
        shortcutStoreMock.value.definitions = [
            {
                id: 'transport.stopPlayback',
                defaultKeys: ['Escape'],
                action: { type: 'callback', id: 'stopPlayback' },
            },
        ];

        const prevent = handleKeydown(descriptor({ key: 'Escape' }));

        expect(prevent).toBe(false);
        await vi.waitFor(() => expect(loggerMock.error).toHaveBeenCalledTimes(1));

        expect(loggerMock.error).toHaveBeenCalledWith(expect.any(Error));
        expect(loggerMock.error).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Keyboard shortcut stop request failed',
                cause: flushError,
            })
        );
    });

    describe('matches() key/modifier resolution', () => {
        it('matches both the mod++ and bare + combos bound to zoomIn', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'view.zoomIn', key: 'mod++', callbackId: 'zoomIn' }),
            ];
            const viaModPlus = handleKeydown(descriptor({ key: '+', mod: true }));
            expect(viaModPlus).toBe(true);
            expect(zoomTimeline).toHaveBeenCalledWith(4);

            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'view.zoomIn', key: '+', callbackId: 'zoomIn' }),
            ];
            vi.mocked(zoomTimeline).mockClear();
            const viaBarePlus = handleKeydown(descriptor({ key: '+' }));
            expect(viaBarePlus).toBe(true);
            expect(zoomTimeline).toHaveBeenCalledWith(4);
        });

        it('normalizes the Space combo to a literal space character', () => {
            shortcutStoreMock.value.definitions = [
                {
                    id: 'transport.togglePlayback',
                    defaultKeys: ['Space'],
                    action: { type: 'appAction', action: { type: 'togglePlayback' } },
                },
            ];

            const prevent = handleKeydown(descriptor({ key: ' ' }));

            expect(prevent).toBe(true);
            expect(executeAppAction).toHaveBeenCalledWith({ type: 'togglePlayback' });
        });

        it('matches a single-character combo case-insensitively', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'test.case', key: 'p', callbackId: 'toggleCommandPalette' }),
            ];

            // Deliberately synthetic: an uppercase key with no shift modifier isolates
            // matches()'s case-fold branch from real Shift-key semantics.
            const prevent = handleKeydown(descriptor({ key: 'P' }));

            expect(prevent).toBe(true);
            expect(toggleCommandPalette).toHaveBeenCalledTimes(1);
        });
    });

    describe('input-field and loop-station guards', () => {
        it('blocks an ordinary matched shortcut in an input field but still allows the command palette', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'test.blocked', key: 'F1', callbackId: 'toggleMixer' }),
                callbackDefinition({
                    id: 'workspace.toggleCommandPalette',
                    key: 'F2',
                    callbackId: 'toggleCommandPalette',
                }),
            ];

            const blocked = handleKeydown(descriptor({ key: 'F1', isInput: true }));
            expect(blocked).toBe(false);
            expect(toggleMixer).not.toHaveBeenCalled();

            const allowed = handleKeydown(descriptor({ key: 'F2', isInput: true }));
            expect(allowed).toBe(true);
            expect(toggleCommandPalette).toHaveBeenCalledTimes(1);
        });

        it('skips loop-station play-pad shortcuts until Loop Station is armed', () => {
            shortcutStoreMock.value.definitions = [
                {
                    id: 'loopStation.pad.r0c0.play',
                    defaultKeys: ['1'],
                    action: { type: 'callback', id: 'loopStationPad.play.r0c0' },
                },
            ];

            loopStationStoreMock.value.armed = false;
            const whileUnarmed = handleKeydown(descriptor({ key: '1' }));
            expect(triggerPad).not.toHaveBeenCalled();
            expect(setEditingTool).toHaveBeenCalledWith('select');
            expect(whileUnarmed).toBe(false);

            loopStationStoreMock.value.armed = true;
            vi.mocked(parseLoopStationPadCallbackId).mockReturnValueOnce({
                rowIndex: 0,
                columnIndex: 0,
                record: false,
            });
            const whileArmed = handleKeydown(descriptor({ key: '1' }));
            expect(triggerPad).toHaveBeenCalledWith({ row: 0, column: 0, record: false });
            expect(whileArmed).toBe(true);
        });
    });

    describe('executeShortcutAction — appAction dispatch', () => {
        it('dispatches a plain appAction shortcut unchanged', () => {
            shortcutStoreMock.value.definitions = [
                {
                    id: 'test.metronome',
                    defaultKeys: ['F1'],
                    action: { type: 'appAction', action: { type: 'toggleMetronome' } },
                },
            ];

            const prevent = handleKeydown(descriptor({ key: 'F1' }));

            expect(prevent).toBe(true);
            expect(executeAppAction).toHaveBeenCalledWith({ type: 'toggleMetronome' });
        });

        it('duplicates the marquee time range instead of the clip when both a marquee and a clip are selected', () => {
            shortcutStoreMock.value.definitions = [
                {
                    id: 'test.dup-clip',
                    defaultKeys: ['F1'],
                    action: { type: 'appAction', action: { type: 'duplicateClip', payload: { clipId: 'selected' } } },
                },
            ];
            clipSelectionStoreMock.value.marqueeSelection = { startBeat: 2, endBeat: 6, trackIds: ['t1'] };
            clipSelectionStoreMock.value.selectedClipId = 'clip-1';
            trackStoreMock.value.tracks = [{ id: 't1', clips: [] }];

            handleKeydown(descriptor({ key: 'F1' }));

            expect(executeUndoableDuplicateTimeRange).toHaveBeenCalledWith(2, 6);
            expect(executeAppAction).not.toHaveBeenCalled();
        });

        it('forwards multi-clip duplication to duplicateSelectedClipsForward', () => {
            shortcutStoreMock.value.definitions = [
                {
                    id: 'test.dup-clip',
                    defaultKeys: ['F1'],
                    action: { type: 'appAction', action: { type: 'duplicateClip', payload: { clipId: 'selected' } } },
                },
            ];
            clipSelectionStoreMock.value.selectedClipIds = ['clip-1', 'clip-2'];

            handleKeydown(descriptor({ key: 'F1' }));

            expect(duplicateSelectedClipsForward).toHaveBeenCalledWith(['clip-1', 'clip-2']);
            expect(executeAppAction).not.toHaveBeenCalled();
        });

        it('dispatches duplicateClip with the resolved clip id for a single selection', () => {
            shortcutStoreMock.value.definitions = [
                {
                    id: 'test.dup-clip',
                    defaultKeys: ['F1'],
                    action: { type: 'appAction', action: { type: 'duplicateClip', payload: { clipId: 'selected' } } },
                },
            ];
            clipSelectionStoreMock.value.selectedClipId = 'clip-9';

            handleKeydown(descriptor({ key: 'F1' }));

            expect(executeAppAction).toHaveBeenCalledWith({ type: 'duplicateClip', payload: { clipId: 'clip-9' } });
        });

        it('dispatches duplicateClipToNextBar only when a clip is selected', () => {
            shortcutStoreMock.value.definitions = [
                {
                    id: 'test.dup-next-bar',
                    defaultKeys: ['F1'],
                    action: {
                        type: 'appAction',
                        action: { type: 'duplicateClipToNextBar', payload: { clipId: 'selected' } },
                    },
                },
            ];

            handleKeydown(descriptor({ key: 'F1' }));
            expect(executeAppAction).not.toHaveBeenCalled();

            clipSelectionStoreMock.value.selectedClipId = 'clip-7';
            handleKeydown(descriptor({ key: 'F1' }));
            expect(executeAppAction).toHaveBeenCalledWith({
                type: 'duplicateClipToNextBar',
                payload: { clipId: 'clip-7' },
            });
        });
    });

    describe('executeShortcutAction — callback dispatch', () => {
        it('dispatches each simple panel/dialog/view callback to its handler with the right arguments', () => {
            const cases: Array<{ callbackId: string; assertDispatched: () => void }> = [
                { callbackId: 'zoomIn', assertDispatched: () => expect(zoomTimeline).toHaveBeenCalledWith(4) },
                { callbackId: 'zoomOut', assertDispatched: () => expect(zoomTimeline).toHaveBeenCalledWith(-4) },
                {
                    callbackId: 'toggleCommandPalette',
                    assertDispatched: () => expect(toggleCommandPalette).toHaveBeenCalledTimes(1),
                },
                {
                    callbackId: 'selectAllClips',
                    assertDispatched: () => expect(selectAllClips).toHaveBeenCalledWith(getAllClipIds),
                },
                { callbackId: 'undo', assertDispatched: () => expect(undo).toHaveBeenCalledTimes(1) },
                { callbackId: 'redo', assertDispatched: () => expect(redo).toHaveBeenCalledTimes(1) },
                { callbackId: 'toggleMixer', assertDispatched: () => expect(toggleMixer).toHaveBeenCalledTimes(1) },
                {
                    callbackId: 'toggleTrackList',
                    assertDispatched: () => expect(toggleTrackList).toHaveBeenCalledTimes(1),
                },
                {
                    callbackId: 'toggleVirtualKeyboard',
                    assertDispatched: () => expect(toggleVirtualKeyboard).toHaveBeenCalledTimes(1),
                },
                {
                    callbackId: 'showAutomationPanel',
                    assertDispatched: () => expect(showAutomationPanel).toHaveBeenCalledTimes(1),
                },
                {
                    callbackId: 'openExportDialog',
                    assertDispatched: () => expect(openExportDialog).toHaveBeenCalledTimes(1),
                },
                {
                    callbackId: 'openPreferencesDialog',
                    assertDispatched: () => expect(openPreferencesDialog).toHaveBeenCalledTimes(1),
                },
            ];

            for (const { callbackId, assertDispatched } of cases) {
                shortcutStoreMock.value.definitions = [callbackDefinition({ id: 'test.case', key: 'F1', callbackId })];
                const prevent = handleKeydown(descriptor({ key: 'F1' }));
                expect(prevent).toBe(true);
                assertDispatched();
            }
        });

        it('cycles automation visibility without requesting preventDefault', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'test.cycle-automation', key: 'F1', callbackId: 'cycleAutomationVisibility' }),
            ];

            const prevent = handleKeydown(descriptor({ key: 'F1' }));

            expect(prevent).toBe(false);
            expect(cycleAutomationVisibility).toHaveBeenCalledTimes(1);
        });

        it('duplicates the selected track, and no-ops when nothing is selected', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'test.dup-track', key: 'F1', callbackId: 'duplicateTrack' }),
            ];

            const preventWithoutSelection = handleKeydown(descriptor({ key: 'F1' }));
            expect(preventWithoutSelection).toBe(true);
            expect(duplicateTrack).not.toHaveBeenCalled();

            trackStoreMock.value.selectedTrackId = 'track-1';
            handleKeydown(descriptor({ key: 'F1' }));
            expect(duplicateTrack).toHaveBeenCalledWith('track-1');
        });

        it('accepts a selected ghost clip on Tab before falling back to the normal mode toggle', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'test.toggle-mode', key: 'F1', callbackId: 'toggleWorkspaceMode' }),
            ];
            trackStoreMock.value.ghostClips = [{ id: 'ghost-1', trackId: 't1' }];
            clipSelectionStoreMock.value.selectedClipId = 'ghost-1';

            handleKeydown(descriptor({ key: 'F1' }));
            expect(acceptGhostClip).toHaveBeenCalledWith('ghost-1');
            expect(toggleWorkspaceMode).not.toHaveBeenCalled();

            clipSelectionStoreMock.value.selectedClipId = null;
            handleKeydown(descriptor({ key: 'F1' }));
            expect(toggleWorkspaceMode).toHaveBeenCalledTimes(1);
        });

        it('resolves deleteSelection to a marquee delete, a clip delete, or a no-op', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'editing.deleteSelection', key: 'F1', callbackId: 'deleteSelection' }),
            ];

            clipSelectionStoreMock.value.marqueeSelection = { startBeat: 1, endBeat: 3, trackIds: ['t1'] };
            const marqueePrevent = handleKeydown(descriptor({ key: 'F1' }));
            expect(marqueePrevent).toBe(true);
            expect(deleteTimeRange).toHaveBeenCalledWith(1, 3, ['t1']);
            expect(setMarqueeSelection).toHaveBeenCalledWith(null);

            clipSelectionStoreMock.value.marqueeSelection = null;
            clipSelectionStoreMock.value.selectedClipIds = ['clip-1'];
            trackStoreMock.value.tracks = [{ id: 't1', clips: [{ id: 'clip-1', startBeat: 0, endBeat: 2 }] }];
            const clipPrevent = handleKeydown(descriptor({ key: 'F1' }));
            expect(clipPrevent).toBe(true);
            expect(removeClip).toHaveBeenCalledWith('clip-1');
            expect(clearClipSelection).toHaveBeenCalled();
            expect(pushUndoEntry).toHaveBeenCalledWith('Delete 1 clip', expect.any(Function), expect.any(Function));

            clipSelectionStoreMock.value.selectedClipIds = [];
            const nonePrevent = handleKeydown(descriptor({ key: 'F1' }));
            expect(nonePrevent).toBe(false);
        });

        it('does nothing when the selected clip ids no longer resolve to real clips', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'editing.deleteSelection', key: 'F1', callbackId: 'deleteSelection' }),
            ];
            clipSelectionStoreMock.value.selectedClipIds = ['missing-clip'];
            trackStoreMock.value.tracks = [{ id: 't1', clips: [] }];

            const prevent = handleKeydown(descriptor({ key: 'F1' }));

            expect(prevent).toBe(false);
            expect(pushUndoEntry).not.toHaveBeenCalled();
        });

        it('prefers the marquee, then multi-clip span, then a single clip for the loop region', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'arrangement.loopFromSelection', key: 'F1', callbackId: 'loopFromSelection' }),
            ];

            clipSelectionStoreMock.value.marqueeSelection = { startBeat: 2, endBeat: 10, trackIds: ['t1'] };
            handleKeydown(descriptor({ key: 'F1' }));

            clipSelectionStoreMock.value.marqueeSelection = null;
            clipSelectionStoreMock.value.selectedClipIds = ['c1', 'c2'];
            trackStoreMock.value.tracks = [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 4 },
                        { id: 'c2', startBeat: 4, endBeat: 9 },
                    ],
                },
            ];
            handleKeydown(descriptor({ key: 'F1' }));

            clipSelectionStoreMock.value.selectedClipIds = [];
            clipSelectionStoreMock.value.selectedClipId = 'c1';
            handleKeydown(descriptor({ key: 'F1' }));

            expect(setLoopRegion).toHaveBeenNthCalledWith(1, 2, 10);
            expect(setLoopRegion).toHaveBeenNthCalledWith(2, 0, 9);
            expect(setLoopRegion).toHaveBeenNthCalledWith(3, 0, 4);
        });

        it('consumes the key without moving the loop region when nothing is selected', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'arrangement.loopFromSelection', key: 'F1', callbackId: 'loopFromSelection' }),
            ];

            const prevent = handleKeydown(descriptor({ key: 'F1' }));

            expect(prevent).toBe(true);
            expect(setLoopRegion).not.toHaveBeenCalled();
        });

        it('deletes the marqueed time range and no-ops without one', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'arrangement.deleteTimeRange', key: 'F1', callbackId: 'deleteTimeRange' }),
            ];
            clipSelectionStoreMock.value.marqueeSelection = { startBeat: 1, endBeat: 5, trackIds: ['t1'] };

            const withMarquee = handleKeydown(descriptor({ key: 'F1' }));
            expect(withMarquee).toBe(true);
            expect(deleteTimeRange).toHaveBeenCalledWith(1, 5, ['t1']);

            clipSelectionStoreMock.value.marqueeSelection = null;
            const withoutMarquee = handleKeydown(descriptor({ key: 'F1' }));
            expect(withoutMarquee).toBe(false);
            expect(deleteTimeRange).toHaveBeenCalledTimes(1);
        });

        it('inserts silence at the marqueed range and no-ops without one', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'arrangement.insertSilence', key: 'F1', callbackId: 'insertSilence' }),
            ];
            clipSelectionStoreMock.value.marqueeSelection = { startBeat: 2, endBeat: 5, trackIds: ['t1'] };
            trackStoreMock.value.tracks = [{ id: 't1', clips: [] }];
            const undoTransaction = { undo: vi.fn(), redo: vi.fn(() => true) };
            vi.mocked(executeUndoableInsertTime).mockReturnValueOnce(undoTransaction);

            const withMarquee = handleKeydown(descriptor({ key: 'F1' }));
            expect(withMarquee).toBe(true);
            expect(executeUndoableInsertTime).toHaveBeenCalledWith(2, 3);
            expect(pushUndoEntry).toHaveBeenCalledWith('Insert Silence', expect.any(Function), expect.any(Function));
            const undoEntryCall = vi.mocked(pushUndoEntry).mock.calls[0];
            if (!undoEntryCall) {
                throw new Error('expected Insert Silence undo callback');
            }
            const [, undoEntry, redoEntry] = undoEntryCall;
            undoEntry();
            redoEntry();
            expect(undoTransaction.undo).toHaveBeenCalledOnce();
            expect(undoTransaction.redo).toHaveBeenCalledOnce();
            expect(deleteTimeRange).not.toHaveBeenCalled();

            clipSelectionStoreMock.value.marqueeSelection = null;
            const withoutMarquee = handleKeydown(descriptor({ key: 'F1' }));
            expect(withoutMarquee).toBe(false);
            expect(executeUndoableInsertTime).toHaveBeenCalledTimes(1);
        });

        it('duplicates the marqueed time range and wires an undo entry that reverses it', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({
                    id: 'arrangement.duplicateTimeRange',
                    key: 'F1',
                    callbackId: 'duplicateTimeRange',
                }),
            ];
            clipSelectionStoreMock.value.marqueeSelection = { startBeat: 2, endBeat: 6, trackIds: ['t1'] };
            trackStoreMock.value.tracks = [
                { id: 't1', clips: [] },
                { id: 't2', clips: [] },
            ];
            const undoTransaction = { undo: vi.fn(), redo: vi.fn(() => true) };
            vi.mocked(executeUndoableDuplicateTimeRange).mockReturnValueOnce(undoTransaction);

            handleKeydown(descriptor({ key: 'F1' }));

            expect(executeUndoableDuplicateTimeRange).toHaveBeenCalledExactlyOnceWith(2, 6);
            const call = vi.mocked(pushUndoEntry).mock.calls[0];
            if (!call) {
                throw new Error('expected pushUndoEntry to have been called');
            }
            const [, undoEntry, redoEntry] = call;
            undoEntry();
            expect(deleteTimeRange).not.toHaveBeenCalled();
            redoEntry();
            expect(undoTransaction.undo).toHaveBeenCalledOnce();
            expect(undoTransaction.redo).toHaveBeenCalledOnce();
        });

        it('cycles selection to the next and previous ghost clip, wrapping at the ends', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({
                    id: 'arrangement.cycleGhostClipNext',
                    key: 'F1',
                    callbackId: 'cycleGhostClipNext',
                }),
                callbackDefinition({
                    id: 'arrangement.cycleGhostClipPrev',
                    key: 'F2',
                    callbackId: 'cycleGhostClipPrev',
                }),
            ];
            trackStoreMock.value.tracks = [
                { id: 't1', clips: [{ id: 'g1', startBeat: 0, endBeat: 1, isGhost: true }] },
            ];
            trackStoreMock.value.ghostClips = [{ id: 'g2', trackId: 't1' }];

            clipSelectionStoreMock.value.selectedClipId = 'g2';
            handleKeydown(descriptor({ key: 'F1' }));
            expect(selectClipWithFocus).toHaveBeenNthCalledWith(1, 'g1');

            clipSelectionStoreMock.value.selectedClipId = 'g1';
            handleKeydown(descriptor({ key: 'F2' }));
            expect(selectClipWithFocus).toHaveBeenNthCalledWith(2, 'g2');
        });

        it('does nothing when there are no ghost clips to cycle through', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({
                    id: 'arrangement.cycleGhostClipNext',
                    key: 'F1',
                    callbackId: 'cycleGhostClipNext',
                }),
            ];

            const prevent = handleKeydown(descriptor({ key: 'F1' }));

            expect(prevent).toBe(false);
            expect(selectClipWithFocus).not.toHaveBeenCalled();
        });
    });

    describe('stopPlayback callback branches', () => {
        it('dismisses a selected ghost clip, then clears a clip selection, then stops loop-station slots, before falling through to transport', () => {
            shortcutStoreMock.value.definitions = [
                callbackDefinition({ id: 'transport.stopPlayback', key: 'F1', callbackId: 'stopPlayback' }),
            ];

            trackStoreMock.value.ghostClips = [{ id: 'ghost-1', trackId: 't1' }];
            clipSelectionStoreMock.value.selectedClipId = 'ghost-1';
            const dismissesGhost = handleKeydown(descriptor({ key: 'F1' }));
            expect(dismissesGhost).toBe(true);
            expect(dismissGhostClip).toHaveBeenCalledWith('ghost-1');
            expect(stopPlaybackMock).not.toHaveBeenCalled();

            trackStoreMock.value.ghostClips = [];
            clipSelectionStoreMock.value.selectedClipIds = ['clip-1'];
            const clearsSelection = handleKeydown(descriptor({ key: 'F1' }));
            expect(clearsSelection).toBe(false);
            expect(clearClipSelection).toHaveBeenCalled();
            expect(stopPlaybackMock).not.toHaveBeenCalled();

            clipSelectionStoreMock.value.selectedClipIds = [];
            clipSelectionStoreMock.value.selectedClipId = null;
            loopStationStoreMock.value.slots = [{ state: 'playing' }];
            handleKeydown(descriptor({ key: 'F1' }));
            expect(stopAllSlots).toHaveBeenCalledTimes(1);
            expect(stopPlaybackMock).not.toHaveBeenCalled();
        });
    });

    describe('AI leader chord (g, then d/m/c/b)', () => {
        const leaderKeyDefinition = callbackDefinition({ id: 'ai.leaderKey', key: 'g', callbackId: 'aiLeaderKey' });

        it('arms on g without dispatching, then resolves d/m/c to their generation actions', () => {
            shortcutStoreMock.value.definitions = [leaderKeyDefinition];
            const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(1000);
            const cases = [
                { key: 'd', action: { type: 'generateDrumPattern', payload: { style: 'rock' } } },
                { key: 'm', action: { type: 'generateMelody', payload: { style: 'simple' } } },
                { key: 'c', action: { type: 'generateChordProgression', payload: { style: 'pop' } } },
            ] as const;

            for (const testCase of cases) {
                const armed = handleKeydown(descriptor({ key: 'g' }));
                expect(armed).toBe(true);
                expect(executeAppAction).not.toHaveBeenCalled();

                const dispatched = handleKeydown(descriptor({ key: testCase.key }));
                expect(dispatched).toBe(true);
                expect(executeAppAction).toHaveBeenCalledWith(testCase.action);
                vi.mocked(executeAppAction).mockClear();
            }

            performanceNow.mockRestore();
        });

        it('requires a selected clip before resolving the bassline chord', () => {
            shortcutStoreMock.value.definitions = [leaderKeyDefinition];
            const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(1000);

            clipSelectionStoreMock.value.selectedClipId = null;
            handleKeydown(descriptor({ key: 'g' }));
            const consumedWithoutSelection = handleKeydown(descriptor({ key: 'b' }));
            expect(consumedWithoutSelection).toBe(true);
            expect(executeAppAction).not.toHaveBeenCalled();

            clipSelectionStoreMock.value.selectedClipId = 'clip-1';
            handleKeydown(descriptor({ key: 'g' }));
            const dispatched = handleKeydown(descriptor({ key: 'b' }));
            expect(dispatched).toBe(true);
            expect(executeAppAction).toHaveBeenCalledWith({
                type: 'generateBassline',
                payload: { clipId: 'clip-1', style: 'root-fifth' },
            });

            performanceNow.mockRestore();
        });

        it('expires after the timeout window and falls through to normal key handling', () => {
            shortcutStoreMock.value.definitions = [leaderKeyDefinition];
            const performanceNow = vi
                .spyOn(performance, 'now')
                .mockReturnValueOnce(1000)
                .mockReturnValueOnce(3000)
                .mockReturnValue(1000);

            handleKeydown(descriptor({ key: 'g' }));
            const prevent = handleKeydown(descriptor({ key: 'd' }));

            expect(executeAppAction).not.toHaveBeenCalled();
            expect(setEditingTool).toHaveBeenCalledWith('draw');
            expect(prevent).toBe(false);

            performanceNow.mockRestore();
        });

        it('disarms and falls through when the second key is not a recognized chord letter', () => {
            shortcutStoreMock.value.definitions = [leaderKeyDefinition];
            const performanceNow = vi.spyOn(performance, 'now').mockReturnValue(1000);

            handleKeydown(descriptor({ key: 'g' }));
            const prevent = handleKeydown(descriptor({ key: 'z' }));

            expect(prevent).toBe(false);
            expect(executeAppAction).not.toHaveBeenCalled();

            performanceNow.mockRestore();
        });
    });
});
