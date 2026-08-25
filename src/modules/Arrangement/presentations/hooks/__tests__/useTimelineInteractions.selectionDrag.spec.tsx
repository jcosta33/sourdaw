import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack, type Clip, type Track, type TrackKind } from '../../../models/Track';
import { clipDragPreviewRef, previewDirtyFlag } from '../../../stores/clipDragPreviewRef';
import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { timelineViewStore } from '../../../stores/timelineViewStore';
import { defaultTrackState, trackStore } from '../../../stores/trackStore';
import { moveClip } from '../../../useCases/clip/moveClip';
import { useTimelineInteractions } from '../useTimelineInteractions';

/**
 * Regression specs for the selection/drag commit core. Unlike
 * `useTimelineInteractions.spec.tsx`, these specs run the REAL selection,
 * move, and duplicate use cases against the REAL track/selection stores —
 * only geometry (hit testing, snapping, render model) and side-effect sinks
 * (undo transport, automation/MIDI satellite writes, notifications) are
 * mocked. The mocked-out sibling spec cannot see selection collapse or
 * per-clip undo behavior at all.
 */

const mocks = vi.hoisted(() => {
    // Widen the box values so tests can swap store payloads without casts.
    const storeBox = (value: Record<string, unknown>) => ({ value });
    return {
        hitTestClip: vi.fn(),
        hitTestClipEdge: vi.fn(),
        hitTestTrack: vi.fn(),
        beginClipDrag: vi.fn(),
        getTrackAtY: vi.fn(),
        buildTimelineRenderModel: vi.fn(),
        snapToGrid: vi.fn((beat: number) => beat),
        snapToGridOrClips: vi.fn((beat: number) => beat),
        snapToZeroCrossing: vi.fn((_: unknown, beat: number) => beat),
        setPlayheadFromClick: vi.fn(),
        selectTrack: vi.fn(),
        canvasXToBeat: vi.fn((x: number) => x / 100),
        getContentY: vi.fn((y: number, scrollY: number) => y + scrollY),
        handleCutTool: vi.fn(),
        handleDrawTool: vi.fn(),
        handleAutomationTool: vi.fn(),
        tryPaintSubLane: vi.fn(),
        paintAutoDragPoint: vi.fn(),
        commitInlineAutomationPaint: vi.fn(),
        commitInlineMidiNoteMove: vi.fn(),
        slipClipContent: vi.fn(),
        trimClipStart: vi.fn(),
        trimClipEnd: vi.fn(),
        toggleInlineEditing: vi.fn(),
        acceptGhostClip: vi.fn(),
        planRippleInsert: vi.fn(),
        rippleInsertClip: vi.fn(),
        undoRippleInsertClip: vi.fn(),
        planRippleMove: vi.fn(),
        rippleMoveClip: vi.fn(),
        broadcastPresence: vi.fn(),
        setWorkspaceMode: vi.fn(),
        toggleLoop: vi.fn(),
        getTransportState: vi.fn(),
        setLoopRegion: vi.fn(),
        pushUndoEntry: vi.fn(),
        shiftClipAutomation: vi.fn(),
        duplicateClipAutomation: vi.fn(),
        duplicateClipNotes: vi.fn(),
        removeMidiClipData: vi.fn(),
        notifyUser: vi.fn(),
        collaborationStoreValue: storeBox({ isEnabled: false }),
        workspaceStoreValue: storeBox({ activeTool: 'select', automationVisibility: 'hidden' }),
        midiStoreValue: storeBox({ notesByClipId: {} }),
        preferencesStoreValue: storeBox({}),
    };
});

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    broadcastPresence: mocks.broadcastPresence,
}));
vi.mock('#/modules/Collaboration/stores', () => ({
    collaborationStore: {
        get value() {
            return mocks.collaborationStoreValue.value;
        },
    },
}));
vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    workspaceStore: {
        get value() {
            return mocks.workspaceStoreValue.value;
        },
    },
}));
vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setWorkspaceMode: mocks.setWorkspaceMode,
}));
vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    toggleLoop: mocks.toggleLoop,
    getTransportState: mocks.getTransportState,
    setLoopRegion: mocks.setLoopRegion,
}));
vi.mock('#/modules/Preferences/stores', () => ({
    preferencesStore: {
        get value() {
            return mocks.preferencesStoreValue.value;
        },
    },
}));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: mocks.pushUndoEntry,
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    shiftClipAutomation: mocks.shiftClipAutomation,
    duplicateClipAutomation: mocks.duplicateClipAutomation,
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    duplicateClipNotes: mocks.duplicateClipNotes,
    removeMidiClipData: mocks.removeMidiClipData,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestClip', () => ({ hitTestClip: mocks.hitTestClip }));
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestTrack', () => ({
    hitTestTrack: mocks.hitTestTrack,
}));
vi.mock('../../../useCases/timelineInteractions/hitTestClipEdge', () => ({ hitTestClipEdge: mocks.hitTestClipEdge }));
vi.mock('../../../useCases/timelineInteractions/beginClipDrag', () => ({ beginClipDrag: mocks.beginClipDrag }));
vi.mock('../../../useCases/timelineInteractions/getTrackAtY', () => ({ getTrackAtY: mocks.getTrackAtY }));
vi.mock('../../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: mocks.buildTimelineRenderModel,
}));
vi.mock('../../../useCases/timelineInteractions/snapToGrid', () => ({ snapToGrid: mocks.snapToGrid }));
vi.mock('../../../useCases/timelineInteractions/snapToGridOrClips', () => ({
    snapToGridOrClips: mocks.snapToGridOrClips,
}));
vi.mock('../../../useCases/timelineInteractions/snapToZeroCrossing', () => ({
    snapToZeroCrossing: mocks.snapToZeroCrossing,
}));
vi.mock('../../../useCases/timelineInteractions/setPlayheadFromClick', () => ({
    setPlayheadFromClick: mocks.setPlayheadFromClick,
}));
vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({ selectTrack: mocks.selectTrack }));
vi.mock('../../helpers/timelineMouse', () => ({
    canvasXToBeat: mocks.canvasXToBeat,
    getContentY: mocks.getContentY,
}));
vi.mock('../../helpers/timelineTools', () => ({
    handleCutTool: mocks.handleCutTool,
    handleDrawTool: mocks.handleDrawTool,
    handleAutomationTool: mocks.handleAutomationTool,
    tryPaintSubLane: mocks.tryPaintSubLane,
    paintAutoDragPoint: mocks.paintAutoDragPoint,
}));
vi.mock('../../../useCases/timelineInteractions/commitInlineAutomationPaint', () => ({
    commitInlineAutomationPaint: mocks.commitInlineAutomationPaint,
}));
vi.mock('../../../useCases/timelineInteractions/commitInlineMidiNoteMove', () => ({
    commitInlineMidiNoteMove: mocks.commitInlineMidiNoteMove,
}));
vi.mock('../../../useCases/clipEditing/slipClipContent', () => ({ slipClipContent: mocks.slipClipContent }));
vi.mock('../../../useCases/clipEditing/trimClipStart', () => ({ trimClipStart: mocks.trimClipStart }));
vi.mock('../../../useCases/clipEditing/trimClipEnd', () => ({ trimClipEnd: mocks.trimClipEnd }));
vi.mock('../../../useCases/clipEditing/toggleInlineEditing', () => ({
    toggleInlineEditing: mocks.toggleInlineEditing,
}));
vi.mock('../../../useCases/clip/acceptGhostClip', () => ({ acceptGhostClip: mocks.acceptGhostClip }));
vi.mock('../../../useCases/rippleInsert/planRippleInsert', () => ({ planRippleInsert: mocks.planRippleInsert }));
vi.mock('../../../useCases/rippleInsert/rippleInsertClip', () => ({
    rippleInsertClip: mocks.rippleInsertClip,
}));
vi.mock('../../../useCases/rippleInsert/undoRippleInsertClip', () => ({
    undoRippleInsertClip: mocks.undoRippleInsertClip,
}));
vi.mock('../../../useCases/rippleMove/planRippleMove', () => ({ planRippleMove: mocks.planRippleMove }));
vi.mock('../../../useCases/rippleMove/rippleMoveClip', () => ({ rippleMoveClip: mocks.rippleMoveClip }));

type ClipInput = {
    id: string;
    trackId: string;
    startBeat?: number;
    endBeat?: number;
    type?: 'audio' | 'midi';
    locked?: boolean;
    name?: string;
};

const makeClip = (input: ClipInput): Clip => ({
    id: input.id,
    trackId: input.trackId,
    name: input.name ?? input.id,
    startBeat: input.startBeat ?? 0,
    endBeat: input.endBeat ?? 4,
    type: input.type ?? 'audio',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '',
    locked: input.locked ?? false,
    muted: false,
});

const makeTrack = (id: string, kind: TrackKind, clips: Clip[]): Track => ({
    ...createTrack({ id, name: id, kind, withoutDefaultDevice: true }),
    clips,
});

const modelTracks = (tracks: Track[]) =>
    tracks.map((track) => ({ id: track.id, kind: track.kind, height: track.height, clips: track.clips }));

const clipOnTrack = (trackId: string, clipId: string): Clip | undefined =>
    trackStore.value?.tracks.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId);

describe('useTimelineInteractions — selection/drag commit core (real stores)', () => {
    let canvas: HTMLCanvasElement;
    let canvasRef: { current: HTMLCanvasElement | null };

    const renderInteractions = () => renderHook(() => useTimelineInteractions(canvasRef as any));

    const mouseDown = (
        result: ReturnType<typeof renderInteractions>,
        x: number,
        y: number,
        modifiers: { altKey?: boolean; shiftKey?: boolean } = {}
    ) =>
        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: x, clientY: y, ...modifiers } as any);
        });

    const mouseMove = (result: ReturnType<typeof renderInteractions>, x: number, y: number) =>
        act(() => {
            result.current.handleMouseMove({ clientX: x, clientY: y } as any);
        });

    const mouseUp = (result: ReturnType<typeof renderInteractions>, x: number, y: number) =>
        act(() => {
            result.current.handleMouseUp({ clientX: x, clientY: y } as any);
        });

    /** Two audio tracks: t1 holds c1 (0–4), t2 holds c2 (2–6); both selected, c1 primary. */
    const setupTwoSelectedClips = () => {
        const tracks = [
            makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
            makeTrack('t2', 'audio', [makeClip({ id: 'c2', trackId: 't2', startBeat: 2, endBeat: 6 })]),
        ];
        trackStore.set({ ...defaultTrackState, tracks });
        clipSelectionStore.set({
            selectedClipId: 'c1',
            selectedClipIds: ['c1', 'c2'],
            marqueeSelection: null,
        });
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.beginClipDrag.mockReturnValue({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 4,
            offsetBeat: 0,
            mode: 'move',
        });
        mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
        return tracks;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        canvas = document.createElement('canvas');
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 500 } as any);
        canvasRef = { current: canvas };

        trackStore.set({ ...defaultTrackState, tracks: [] });
        clipSelectionStore.set({ ...defaultClipSelectionState });
        timelineViewStore.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 100,
            autoScrollEnabled: true,
            viewportHeight: 0,
        });
        clipDragPreviewRef.current = null;
        previewDirtyFlag.value = false;

        mocks.workspaceStoreValue.value = { activeTool: 'select', automationVisibility: 'hidden' };
        mocks.collaborationStoreValue.value = { isEnabled: false };
        mocks.midiStoreValue.value = { notesByClipId: {} };
        mocks.preferencesStoreValue.value = {};
        mocks.buildTimelineRenderModel.mockReturnValue({ tracks: [], tempo: 120 });
        mocks.hitTestClip.mockReturnValue(null);
        mocks.hitTestClipEdge.mockReturnValue(null);
        mocks.hitTestTrack.mockReturnValue(null);
        mocks.beginClipDrag.mockReturnValue(null);
        mocks.getTrackAtY.mockReturnValue(null);
        mocks.tryPaintSubLane.mockReturnValue(false);
    });

    describe('fix 1 — pointer-down on a multi-selection member', () => {
        it('preserves the multi-selection on pointer-down', () => {
            setupTwoSelectedClips();
            const { result } = renderInteractions();

            mouseDown(result, 10, 20);

            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['c1', 'c2']);
            expect(clipSelectionStore.value?.selectedClipId).toBe('c1');
        });

        it('collapses the selection to the clicked clip when released without a drag', () => {
            setupTwoSelectedClips();
            const { result } = renderInteractions();

            mouseDown(result, 10, 20);
            mouseUp(result, 10, 20);

            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['c1']);
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        });

        it('moves the whole selection — and keeps it — when the press becomes a drag', () => {
            setupTwoSelectedClips();
            mocks.getTrackAtY.mockReturnValue({ index: 0, id: 't1' });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 200, 20);
            mouseUp(result, 200, 20);

            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(2);
            expect(clipOnTrack('t2', 'c2')?.startBeat).toBe(4);
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['c1', 'c2']);
        });

        it('shift-click still toggles membership instead of preserving or collapsing', () => {
            setupTwoSelectedClips();
            const { result } = renderInteractions();

            mouseDown(result, 10, 20, { shiftKey: true });

            // c1 was a member; shift-click removes just it.
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['c2']);
        });
    });

    describe('fix 2 — multi-clip move undo', () => {
        it('pushes one history entry whose undo/redo restores every moved clip and its followed automation', () => {
            setupTwoSelectedClips();
            mocks.getTrackAtY.mockReturnValue({ index: 0, id: 't1' });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 200, 20);
            mouseUp(result, 200, 20);

            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(2);
            expect(clipOnTrack('t2', 'c2')?.startBeat).toBe(4);
            // Automation follows each moved clip from its own origin.
            expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', 2, 't1');
            expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c2', 2, 't2');

            expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
            const [label, undoEntry, redoEntry] = mocks.pushUndoEntry.mock.calls[0]! as [
                string,
                () => void,
                () => void,
            ];
            expect(label).toBe('Move 2 clips');

            act(() => undoEntry());
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(clipOnTrack('t2', 'c2')?.startBeat).toBe(2);
            // Followed automation is restored per clip, not just for the primary.
            expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', -2, 't1');
            expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c2', -2, 't2');

            act(() => redoEntry());
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(2);
            expect(clipOnTrack('t2', 'c2')?.startBeat).toBe(4);
        });
    });

    describe('fix 3 — per-clip track offsets', () => {
        const setupThreeTracks = () => {
            const tracks = [
                makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
                makeTrack('t2', 'audio', [makeClip({ id: 'c2', trackId: 't2', startBeat: 2, endBeat: 6 })]),
                makeTrack('t3', 'audio', []),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({
                selectedClipId: 'c1',
                selectedClipIds: ['c1', 'c2'],
                marqueeSelection: null,
            });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockReturnValue({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode: 'move',
            });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            return tracks;
        };

        it('keeps each clip’s track offset when the selection is dragged across tracks', () => {
            setupThreeTracks();
            // Drag c1 down one track (t1 → t2), same beat.
            mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 0, 120);

            // Preview: c1 lands on t2, c2 follows with its +1 offset onto t3.
            expect(clipDragPreviewRef.current?.positions.get('c1')?.trackId).toBe('t2');
            expect(clipDragPreviewRef.current?.positions.get('c2')?.trackId).toBe('t3');

            mouseUp(result, 0, 120);

            expect(clipOnTrack('t2', 'c1')?.startBeat).toBe(0);
            expect(clipOnTrack('t3', 'c2')?.startBeat).toBe(2);
        });

        it('clamps the vertical offset at the edge of the track list', () => {
            setupThreeTracks();
            // Drag c1 down two tracks (t1 → t3); c2's +2 offset would leave the list.
            mocks.getTrackAtY.mockReturnValue({ index: 2, id: 't3' });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 0, 220);
            mouseUp(result, 0, 220);

            expect(clipOnTrack('t3', 'c1')).toBeDefined();
            // Clamped to the last track rather than rejecting or wrapping.
            expect(clipOnTrack('t3', 'c2')?.startBeat).toBe(2);
        });
    });

    describe('fix 4 — cross-track Alt+drag duplicate', () => {
        const setupDuplicateDrag = (destinationClips: Clip[] = []) => {
            const tracks = [
                makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
                makeTrack('t2', 'audio', destinationClips),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({ ...defaultClipSelectionState });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            // Honor the mode argument: the hook flips move → duplicate on Alt.
            mocks.beginClipDrag.mockImplementation((_x: number, _y: number, mode: string) => ({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode,
            }));
            mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
        };

        it('creates the copy on the dragged-to track, exactly as previewed', () => {
            setupDuplicateDrag();
            const { result } = renderInteractions();

            mouseDown(result, 0, 20, { altKey: true });
            mouseMove(result, 800, 120);
            mouseUp(result, 800, 120);

            // Original untouched on the source track.
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(trackStore.value?.tracks.find((track) => track.id === 't1')?.clips).toHaveLength(1);

            // Copy on the DESTINATION track at the drop beat.
            const t2Clips = trackStore.value?.tracks.find((track) => track.id === 't2')?.clips ?? [];
            expect(t2Clips).toHaveLength(1);
            expect(t2Clips[0]).toMatchObject({ trackId: 't2', startBeat: 8, endBeat: 12, name: 'c1 (copy)' });

            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Duplicate 1 clip',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('undo removes exactly the created copy — a pre-existing destination clip survives; redo recreates it', () => {
            const innocent = makeClip({ id: 'c9', trackId: 't2', startBeat: 4, endBeat: 8 });
            setupDuplicateDrag([innocent]);
            const { result } = renderInteractions();

            mouseDown(result, 0, 20, { altKey: true });
            mouseMove(result, 1200, 120);
            mouseUp(result, 1200, 120);

            const t2AfterDrop = trackStore.value?.tracks.find((track) => track.id === 't2')?.clips ?? [];
            const copy = t2AfterDrop.find((clip) => clip.id !== 'c9');
            expect(copy).toBeDefined();
            expect(clipOnTrack('t2', 'c9')).toBeDefined();

            const [, undoEntry, redoEntry] = mocks.pushUndoEntry.mock.calls[0]! as [string, () => void, () => void];

            act(() => undoEntry());
            // The innocent destination-track clip survives; only the copy goes.
            expect(clipOnTrack('t2', 'c9')).toBeDefined();
            expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(1);
            expect(clipOnTrack('t1', 'c1')).toBeDefined();

            act(() => redoEntry());
            const t2AfterRedo = trackStore.value?.tracks.find((track) => track.id === 't2')?.clips ?? [];
            expect(t2AfterRedo).toHaveLength(2);
            // Redo recreates the very same copy (same id, same position).
            expect(t2AfterRedo.find((clip) => clip.id === copy!.id)).toMatchObject({
                trackId: 't2',
                startBeat: 12,
            });
        });
    });

    describe('fix 5 — rejected drops and locked clips', () => {
        it('rejects dropping an audio clip onto a MIDI track: no mutation, no history, reason surfaced', () => {
            const tracks = [
                makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
                makeTrack('t2', 'midi', []),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockReturnValue({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode: 'move',
            });
            mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 200, 120);

            // The drop target is rejected during the drag, via the cursor…
            expect(canvas.style.cursor).toBe('not-allowed');

            mouseUp(result, 200, 120);

            // …and via transient status at drop time. Nothing moved, no history.
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringMatching(/MIDI/i), 'warning');
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(0);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        });

        it('a locked-clip drag moves nothing and pushes no history, with lock feedback', () => {
            const tracks = [
                makeTrack('t1', 'audio', [
                    makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4, locked: true }),
                ]),
                makeTrack('t2', 'audio', []),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockReturnValue({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode: 'move',
            });
            mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 200, 120);

            // Lock feedback during the drag, not a silent skip at commit.
            expect(canvas.style.cursor).toBe('not-allowed');

            mouseUp(result, 200, 120);

            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringMatching(/[Ll]ock/), 'warning');
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        });

        it('excludes locked members from a multi-clip drag while unlocked members move', () => {
            const tracks = [
                makeTrack('t1', 'audio', [
                    makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4, locked: true }),
                    makeClip({ id: 'c2', trackId: 't1', startBeat: 4, endBeat: 8 }),
                ]),
                makeTrack('t2', 'audio', []),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({
                selectedClipId: 'c2',
                selectedClipIds: ['c1', 'c2'],
                marqueeSelection: null,
            });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c2', trackId: 't1' });
            mocks.beginClipDrag.mockReturnValue({
                clipId: 'c2',
                sourceTrackId: 't1',
                startBeat: 4,
                endBeat: 8,
                offsetBeat: 0,
                mode: 'move',
            });
            mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            mouseDown(result, 400, 20);
            mouseMove(result, 400, 120);
            mouseUp(result, 400, 120);

            // The locked clip never left its track; the unlocked one moved.
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(clipOnTrack('t2', 'c2')?.startBeat).toBe(4);
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringMatching(/[Ll]ock/), 'warning');
        });
    });

    describe('review 1 — a rejected/locked primary must not turn a real group drag into a click', () => {
        it('commits followers when the pressed clip is locked, notifies, and keeps the selection', () => {
            const tracks = [
                makeTrack('t1', 'audio', [
                    makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4, locked: true }),
                    makeClip({ id: 'c2', trackId: 't1', startBeat: 4, endBeat: 8 }),
                ]),
                makeTrack('t2', 'audio', []),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({
                selectedClipId: 'c1',
                selectedClipIds: ['c1', 'c2'],
                marqueeSelection: null,
            });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockReturnValue({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode: 'move',
            });
            mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 0, 120);
            mouseUp(result, 0, 120);

            // The locked primary stays; the unlocked follower commits.
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(clipOnTrack('t2', 'c2')?.startBeat).toBe(4);
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringMatching(/[Ll]ock/), 'warning');
            // A real drag happened: no click-collapse of the multi-selection.
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['c1', 'c2']);
            expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        });

        it('commits followers when the pressed clip is kind-rejected, surfaces the reason, keeps the selection', () => {
            const tracks = [
                makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
                makeTrack('t2', 'midi', [
                    makeClip({ id: 'c2', trackId: 't2', startBeat: 2, endBeat: 6, type: 'midi' }),
                ]),
                makeTrack('t3', 'midi', []),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({
                selectedClipId: 'c1',
                selectedClipIds: ['c1', 'c2'],
                marqueeSelection: null,
            });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockReturnValue({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode: 'move',
            });
            // Drag the group down one track: c1 (audio) onto t2 (midi) is
            // rejected; c2 (midi) continues to t3 (midi).
            mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 0, 120);
            mouseUp(result, 0, 120);

            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(clipOnTrack('t3', 'c2')?.startBeat).toBe(2);
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringMatching(/MIDI/i), 'warning');
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['c1', 'c2']);
        });
    });

    describe('review 3 — non-content track drops are rejected at preview time', () => {
        it.each(['folder', 'master', 'bus'] as const)(
            'rejects a clip drop onto a %s track with cursor and drop-time feedback',
            (kind) => {
                const tracks = [
                    makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
                    makeTrack('t2', kind, []),
                ];
                trackStore.set({ ...defaultTrackState, tracks });
                mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
                mocks.beginClipDrag.mockReturnValue({
                    clipId: 'c1',
                    sourceTrackId: 't1',
                    startBeat: 0,
                    endBeat: 4,
                    offsetBeat: 0,
                    mode: 'move',
                });
                mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
                mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
                const { result } = renderInteractions();

                mouseDown(result, 0, 20);
                mouseMove(result, 200, 120);

                expect(canvas.style.cursor).toBe('not-allowed');

                mouseUp(result, 200, 120);

                expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
                expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(0);
                expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
                expect(mocks.notifyUser).toHaveBeenCalledWith(
                    expect.stringMatching(/does not accept clips/i),
                    'warning'
                );
            }
        );
    });

    describe('review 4 — multi-clip ripple move undo', () => {
        it('restores every moved clip and every neighbor shifted by any of the per-clip ripple plans', () => {
            mocks.workspaceStoreValue.value = {
                activeTool: 'select',
                automationVisibility: 'hidden',
                rippleEditing: true,
            };
            const tracks = [
                makeTrack('t1', 'audio', [
                    makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 2 }),
                    makeClip({ id: 'c2', trackId: 't1', startBeat: 4, endBeat: 6 }),
                    makeClip({ id: 'c3', trackId: 't1', startBeat: 8, endBeat: 10 }),
                    makeClip({ id: 'c4', trackId: 't1', startBeat: 12, endBeat: 14 }),
                ]),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({
                selectedClipId: 'c1',
                selectedClipIds: ['c1', 'c2'],
                marqueeSelection: null,
            });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockReturnValue({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 2,
                offsetBeat: 0,
                mode: 'move',
            });
            mocks.getTrackAtY.mockReturnValue({ index: 0, id: 't1' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            // Each moved clip gets its own ripple plan shifting a distinct neighbor.
            mocks.planRippleMove.mockImplementation(({ clipId }: { clipId: string }) => {
                if (clipId === 'c1') {
                    return {
                        gapClosedClips: [{ clipId: 'c3', origStartBeat: 8, origEndBeat: 10 }],
                        destinationOpenedClips: [],
                    };
                }
                if (clipId === 'c2') {
                    return {
                        gapClosedClips: [{ clipId: 'c4', origStartBeat: 12, origEndBeat: 14 }],
                        destinationOpenedClips: [],
                    };
                }
                return null;
            });
            mocks.rippleMoveClip.mockImplementation(
                (input: {
                    trackId: string;
                    clipId: string;
                    newStartBeat: number;
                    plan: { gapClosedClips: { clipId: string; origStartBeat: number }[] };
                }) => {
                    moveClip(input.clipId, input.trackId, input.newStartBeat);
                    for (const shifted of input.plan.gapClosedClips) {
                        moveClip(shifted.clipId, input.trackId, shifted.origStartBeat + 1);
                    }
                }
            );
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 100, 20);
            mouseUp(result, 100, 20);

            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(1);
            expect(clipOnTrack('t1', 'c2')?.startBeat).toBe(5);
            expect(clipOnTrack('t1', 'c3')?.startBeat).toBe(9);
            expect(clipOnTrack('t1', 'c4')?.startBeat).toBe(13);

            expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
            const [label, undoEntry, redoEntry] = mocks.pushUndoEntry.mock.calls[0]! as [
                string,
                () => void,
                () => void,
            ];
            expect(label).toBe('Move clip (ripple)');

            act(() => undoEntry());
            // Both moved clips AND both ripple-shifted neighbors return.
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(clipOnTrack('t1', 'c2')?.startBeat).toBe(4);
            expect(clipOnTrack('t1', 'c3')?.startBeat).toBe(8);
            expect(clipOnTrack('t1', 'c4')?.startBeat).toBe(12);

            act(() => redoEntry());
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(1);
            expect(clipOnTrack('t1', 'c2')?.startBeat).toBe(5);
            expect(clipOnTrack('t1', 'c3')?.startBeat).toBe(9);
            expect(clipOnTrack('t1', 'c4')?.startBeat).toBe(13);
        });

        it('merges per-clip plans first-wins: a neighbor in two plans restores to its true original', () => {
            mocks.workspaceStoreValue.value = {
                activeTool: 'select',
                automationVisibility: 'hidden',
                rippleEditing: true,
            };
            const tracks = [
                makeTrack('t1', 'audio', [
                    makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 2 }),
                    makeClip({ id: 'c2', trackId: 't1', startBeat: 4, endBeat: 6 }),
                    makeClip({ id: 'c3', trackId: 't1', startBeat: 8, endBeat: 10 }),
                ]),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({
                selectedClipId: 'c1',
                selectedClipIds: ['c1', 'c2'],
                marqueeSelection: null,
            });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockReturnValue({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 2,
                offsetBeat: 0,
                mode: 'move',
            });
            mocks.getTrackAtY.mockReturnValue({ index: 0, id: 't1' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            // c3 appears in BOTH plans. Plans are computed sequentially with
            // each rippleMoveClip applied in between, so c1's plan records c3's
            // true pre-drag origin (8) while c2's plan records the
            // already-shifted position (10). Undo must restore 8.
            mocks.planRippleMove.mockImplementation(({ clipId }: { clipId: string }) => {
                if (clipId === 'c1') {
                    return {
                        gapClosedClips: [{ clipId: 'c3', origStartBeat: 8, origEndBeat: 10 }],
                        destinationOpenedClips: [],
                    };
                }
                if (clipId === 'c2') {
                    return {
                        gapClosedClips: [{ clipId: 'c3', origStartBeat: 10, origEndBeat: 12 }],
                        destinationOpenedClips: [],
                    };
                }
                return null;
            });
            mocks.rippleMoveClip.mockImplementation(
                (input: {
                    trackId: string;
                    clipId: string;
                    newStartBeat: number;
                    plan: { gapClosedClips: { clipId: string; origStartBeat: number }[] };
                }) => {
                    moveClip(input.clipId, input.trackId, input.newStartBeat);
                    for (const shifted of input.plan.gapClosedClips) {
                        moveClip(shifted.clipId, input.trackId, shifted.origStartBeat + 2);
                    }
                }
            );
            const { result } = renderInteractions();

            mouseDown(result, 0, 20);
            mouseMove(result, 200, 20);
            mouseUp(result, 200, 20);

            // Sequential application: c3 shifts 8 → 10 → 12.
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(2);
            expect(clipOnTrack('t1', 'c2')?.startBeat).toBe(6);
            expect(clipOnTrack('t1', 'c3')?.startBeat).toBe(12);

            const [, undoEntry, redoEntry] = mocks.pushUndoEntry.mock.calls[0]! as [string, () => void, () => void];

            act(() => undoEntry());
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(0);
            expect(clipOnTrack('t1', 'c2')?.startBeat).toBe(4);
            // First-wins: c1's plan holds the true pre-drag original.
            expect(clipOnTrack('t1', 'c3')?.startBeat).toBe(8);

            act(() => redoEntry());
            expect(clipOnTrack('t1', 'c1')?.startBeat).toBe(2);
            expect(clipOnTrack('t1', 'c2')?.startBeat).toBe(6);
            expect(clipOnTrack('t1', 'c3')?.startBeat).toBe(12);
        });
    });

    describe('review 5 — duplicate-mode coverage', () => {
        it('rejected Alt+drag duplicate onto an incompatible track creates no copy and no history', () => {
            const tracks = [
                makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
                makeTrack('t2', 'midi', []),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockImplementation((_x: number, _y: number, mode: string) => ({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode,
            }));
            mocks.getTrackAtY.mockReturnValue({ index: 1, id: 't2' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20, { altKey: true });
            mouseMove(result, 800, 120);
            mouseUp(result, 800, 120);

            expect(trackStore.value?.tracks.find((track) => track.id === 't1')?.clips).toHaveLength(1);
            expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(0);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringMatching(/MIDI/i), 'warning');
        });

        it('multi-clip Alt+drag duplicate pushes one entry; undo removes exactly the pre-allocated copies', () => {
            const tracks = [
                makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
                makeTrack('t2', 'audio', [makeClip({ id: 'c2', trackId: 't2', startBeat: 2, endBeat: 6 })]),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({
                selectedClipId: 'c1',
                selectedClipIds: ['c1', 'c2'],
                marqueeSelection: null,
            });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockImplementation((_x: number, _y: number, mode: string) => ({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode,
            }));
            // Same-track drop, +2 beats: copies at c1→2 (t1) and c2→4 (t2).
            mocks.getTrackAtY.mockReturnValue({ index: 0, id: 't1' });
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20, { altKey: true });
            mouseMove(result, 200, 20);
            mouseUp(result, 200, 20);

            const t1Clips = trackStore.value?.tracks.find((track) => track.id === 't1')?.clips ?? [];
            const t2Clips = trackStore.value?.tracks.find((track) => track.id === 't2')?.clips ?? [];
            const copy1 = t1Clips.find((clip) => clip.id !== 'c1');
            const copy2 = t2Clips.find((clip) => clip.id !== 'c2');
            expect(copy1?.startBeat).toBe(2);
            expect(copy2?.startBeat).toBe(4);

            expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
            const [label, undoEntry, redoEntry] = mocks.pushUndoEntry.mock.calls[0]! as [
                string,
                () => void,
                () => void,
            ];
            expect(label).toBe('Duplicate 2 clips');

            act(() => undoEntry());
            // Exactly the two copies go; both originals survive.
            expect(trackStore.value?.tracks.find((track) => track.id === 't1')?.clips).toHaveLength(1);
            expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(1);
            expect(clipOnTrack('t1', 'c1')).toBeDefined();
            expect(clipOnTrack('t2', 'c2')).toBeDefined();

            act(() => redoEntry());
            expect(
                trackStore.value?.tracks.find((track) => track.id === 't1')?.clips.find((clip) => clip.id === copy1!.id)
            ).toMatchObject({ startBeat: 2 });
            expect(
                trackStore.value?.tracks.find((track) => track.id === 't2')?.clips.find((clip) => clip.id === copy2!.id)
            ).toMatchObject({ startBeat: 4 });
        });

        it('a motionless Alt+click duplicates nothing, pushes no history, and keeps the selection', () => {
            const tracks = [
                makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
                makeTrack('t2', 'audio', [makeClip({ id: 'c2', trackId: 't2', startBeat: 2, endBeat: 6 })]),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            clipSelectionStore.set({
                selectedClipId: 'c1',
                selectedClipIds: ['c1', 'c2'],
                marqueeSelection: null,
            });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockImplementation((_x: number, _y: number, mode: string) => ({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode,
            }));
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            // Alt+press and release without any mousemove: a duplicate gesture
            // that never moved. Pinned contract: nothing is duplicated and the
            // selection is preserved (Alt marks drag intent, not selection).
            mouseDown(result, 0, 20, { altKey: true });
            mouseUp(result, 0, 20);

            expect(trackStore.value?.tracks.find((track) => track.id === 't1')?.clips).toHaveLength(1);
            expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(1);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(['c1', 'c2']);
        });

        it('a motionless Alt+click on a single clip creates no stacked copy', () => {
            const tracks = [
                makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
            ];
            trackStore.set({ ...defaultTrackState, tracks });
            mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
            mocks.beginClipDrag.mockImplementation((_x: number, _y: number, mode: string) => ({
                clipId: 'c1',
                sourceTrackId: 't1',
                startBeat: 0,
                endBeat: 4,
                offsetBeat: 0,
                mode,
            }));
            mocks.buildTimelineRenderModel.mockReturnValue({ tracks: modelTracks(tracks), tempo: 120 });
            const { result } = renderInteractions();

            mouseDown(result, 0, 20, { altKey: true });
            mouseUp(result, 0, 20);

            expect(trackStore.value?.tracks.find((track) => track.id === 't1')?.clips).toHaveLength(1);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        });
    });
});
