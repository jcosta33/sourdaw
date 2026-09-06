import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack, type Clip, type Track, type TrackKind } from '../../../models/Track';
import { clipDragPreviewRef, previewDirtyFlag } from '../../../stores/clipDragPreviewRef';
import { clipSelectionStore, defaultClipSelectionState } from '../../../stores/clipSelectionStore';
import { timelineViewStore } from '../../../stores/timelineViewStore';
import { defaultTrackState, trackStore } from '../../../stores/trackStore';
import { cancelActiveTimelineGesture } from '../../../useCases/timelineInteractions/cancelActiveTimelineGesture';
import { useTimelineInteractions } from '../useTimelineInteractions';

/**
 * Gesture-cancellation specs (Escape / window blur / visibility change /
 * pointer leaving the canvas). Real Arrangement stores and real
 * cancelActiveTimelineGesture; geometry (hit testing, snapping, render
 * model), useTimelineFileDrop, removeClipSatelliteData, and other
 * side-effect sinks are mocked. The Escape key path itself (cancel before
 * marquee / clip selection / transport stop) is covered in
 * `handleKeydown.spec.ts`.
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
        executeUserAppAction: vi.fn(),
        generateGroupId: vi.fn((label: string) => ({ groupId: 'group-cancel', groupLabel: label })),
        shiftClipAutomation: vi.fn(),
        duplicateClipAutomation: vi.fn(),
        duplicateClipNotes: vi.fn(),
        removeMidiClipData: vi.fn(),
        notifyUser: vi.fn(),
        collaborationStoreValue: storeBox({ isEnabled: false }),
        workspaceStoreValue: storeBox({ activeTool: 'select', automationVisibility: 'hidden' }),
        preferencesStoreValue: storeBox({}),
    };
});

vi.mock('#/modules/Collaboration/useCases', () => ({
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
vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    setWorkspaceMode: mocks.setWorkspaceMode,
}));
vi.mock('#/modules/Transport/useCases', () => ({
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
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: mocks.executeUserAppAction,
    generateGroupId: mocks.generateGroupId,
    pushUndoEntry: mocks.pushUndoEntry,
}));
vi.mock('#/modules/Automation/useCases', () => ({
    shiftClipAutomation: mocks.shiftClipAutomation,
    duplicateClipAutomation: mocks.duplicateClipAutomation,
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    // Full factory, not importOriginal: the spec never exercises the inline
    // note paths, and loading the real barrel would drag in MIDI's whole
    // Project/CrdtDocument graph for two side-effect sinks.
    duplicateClipNotes: mocks.duplicateClipNotes,
    removeMidiClipData: mocks.removeMidiClipData,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

vi.mock('../useTimelineFileDrop', () => ({
    useTimelineFileDrop: () => ({
        handleFileDrop: vi.fn(),
        isDragOver: false,
        setIsDragOver: vi.fn(),
        isImporting: false,
    }),
}));
vi.mock('../../../useCases/clip/removeClipSatelliteData', () => ({
    removeClipSatelliteData: vi.fn(),
}));

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

const makeClip = (input: { id: string; trackId: string; startBeat?: number; endBeat?: number }): Clip => ({
    id: input.id,
    trackId: input.trackId,
    name: input.id,
    startBeat: input.startBeat ?? 0,
    endBeat: input.endBeat ?? 4,
    type: 'audio',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '',
    locked: false,
    muted: false,
});

const makeTrack = (id: string, kind: TrackKind, clips: Clip[]): Track => ({
    ...createTrack({ id, name: id, kind, withoutDefaultDevice: true }),
    clips,
});

describe('useTimelineInteractions — gesture cancellation', () => {
    let canvas: HTMLCanvasElement;
    let canvasRef: { current: HTMLCanvasElement | null };

    const renderInteractions = () => renderHook(() => useTimelineInteractions(canvasRef as any));

    const setupMoveDrag = () => {
        const tracks = [
            makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })]),
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
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: tracks.map((track) => ({ id: track.id, kind: track.kind, height: track.height, clips: [] })),
            tempo: 120,
        });
    };

    const beginMoveDrag = (result: ReturnType<typeof renderInteractions>['result']) => {
        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 200, clientY: 120 } as any);
        });
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
        mocks.preferencesStoreValue.value = {};
        mocks.buildTimelineRenderModel.mockReturnValue({ tracks: [], tempo: 120 });
        mocks.hitTestClip.mockReturnValue(null);
        mocks.hitTestClipEdge.mockReturnValue(null);
        mocks.hitTestTrack.mockReturnValue(null);
        mocks.beginClipDrag.mockReturnValue(null);
        mocks.getTrackAtY.mockReturnValue(null);
        mocks.tryPaintSubLane.mockReturnValue(false);
    });

    it('Escape cancels an in-progress move drag: original positions, no history entry', () => {
        setupMoveDrag();
        const { result } = renderInteractions();
        beginMoveDrag(result);

        // The preview is live during the drag.
        expect(clipDragPreviewRef.current?.positions.get('c1')?.trackId).toBe('t2');

        let cancelled = false;
        act(() => {
            cancelled = cancelActiveTimelineGesture();
        });

        expect(cancelled).toBe(true);
        expect(clipDragPreviewRef.current).toBeNull();
        expect(canvas.style.cursor).toBe('');

        // A later mouse-up (real or synthetic) commits nothing.
        act(() => {
            result.current.handleMouseUp({ clientX: 200, clientY: 120 } as any);
        });

        const t1 = trackStore.value?.tracks.find((track) => track.id === 't1');
        expect(t1?.clips.find((clip) => clip.id === 'c1')?.startBeat).toBe(0);
        expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(0);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('window blur cancels an in-progress drag the same way', () => {
        setupMoveDrag();
        const { result } = renderInteractions();
        beginMoveDrag(result);

        act(() => {
            window.dispatchEvent(new Event('blur'));
        });

        expect(clipDragPreviewRef.current).toBeNull();
        act(() => {
            result.current.handleMouseUp({ clientX: 200, clientY: 120 } as any);
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(0);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('visibilitychange to hidden cancels an in-progress drag', () => {
        setupMoveDrag();
        const { result } = renderInteractions();
        beginMoveDrag(result);

        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        visibility.mockRestore();

        expect(clipDragPreviewRef.current).toBeNull();
        act(() => {
            result.current.handleMouseUp({ clientX: 200, clientY: 120 } as any);
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(0);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('pointer leaving the canvas mid-drag cancels instead of committing at the last position', () => {
        setupMoveDrag();
        const { result } = renderInteractions();
        beginMoveDrag(result);

        act(() => {
            result.current.handleMouseLeave();
        });

        expect(clipDragPreviewRef.current).toBeNull();
        const t1 = trackStore.value?.tracks.find((track) => track.id === 't1');
        expect(t1?.clips.find((clip) => clip.id === 'c1')?.startBeat).toBe(0);
        expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(0);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('Escape cancels an in-progress marquee without selecting anything', () => {
        mocks.hitTestClip.mockReturnValue(null);
        mocks.hitTestTrack.mockReturnValue('t1');
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', height: 100, clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
            tempo: 120,
        });
        const { result } = renderInteractions();

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 10 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 400, clientY: 50 } as any);
        });
        expect(result.current.rubberBand).not.toBeNull();

        let cancelled = false;
        act(() => {
            cancelled = cancelActiveTimelineGesture();
        });

        expect(cancelled).toBe(true);
        expect(result.current.rubberBand).toBeNull();

        act(() => {
            result.current.handleMouseUp({ clientX: 400, clientY: 50 } as any);
        });
        expect(clipSelectionStore.value?.selectedClipIds).toEqual([]);
        expect(clipSelectionStore.value?.marqueeSelection).toBeNull();
    });

    it('Escape discards a draw gesture without adding a clip', () => {
        mocks.workspaceStoreValue.value = { activeTool: 'draw', automationVisibility: 'hidden' };
        trackStore.set({ ...defaultTrackState, tracks: [makeTrack('t1', 'audio', [])] });
        mocks.handleDrawTool.mockImplementation((_x: number, _y: number, _beat: number, ref: { current: unknown }) => {
            ref.current = { trackId: 't1', startBeat: 2, clipType: 'audio' };
        });
        const { result } = renderInteractions();

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 200, clientY: 50 } as any);
        });

        let cancelled = false;
        act(() => {
            cancelled = cancelActiveTimelineGesture();
        });
        expect(cancelled).toBe(true);

        act(() => {
            result.current.handleMouseUp({ clientX: 500, clientY: 50 } as any);
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 't1')?.clips).toHaveLength(0);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('returns false when no gesture is active, so Escape can fall through', () => {
        renderInteractions();
        expect(cancelActiveTimelineGesture()).toBe(false);
    });

    it('Escape cancels a mid-trim drag without committing or pushing history', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [makeTrack('t1', 'audio', [makeClip({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 4 })])],
        });
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.hitTestClipEdge.mockReturnValue({ edge: 'left' });
        mocks.beginClipDrag.mockReturnValue({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 4,
            offsetBeat: 0,
            mode: 'trim-start',
        });
        const { result } = renderInteractions();

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 200, clientY: 20 } as any);
        });
        // The trim preview is live during the drag.
        expect(clipDragPreviewRef.current?.positions.get('c1')?.startBeat).toBe(2);

        let cancelled = false;
        act(() => {
            cancelled = cancelActiveTimelineGesture();
        });
        expect(cancelled).toBe(true);

        act(() => {
            result.current.handleMouseUp({ clientX: 200, clientY: 20 } as any);
        });
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(trackStore.value?.tracks.find((track) => track.id === 't1')?.clips[0]?.startBeat).toBe(0);
    });

    it('a committed drag is not rewound by a later cancel', () => {
        setupMoveDrag();
        const { result } = renderInteractions();
        beginMoveDrag(result);
        act(() => {
            result.current.handleMouseUp({ clientX: 200, clientY: 120 } as any);
        });

        // The single-clip move commits through the registered moveClip action
        // (#3641); at this layer the dispatch is mocked, so the commit is
        // exactly one dispatch and the store stays as the gesture left it.
        expect(mocks.executeUserAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'moveClip',
            payload: { clipId: 'c1', trackId: 't2', startBeat: 2 },
        });

        let cancelled = true;
        act(() => {
            cancelled = cancelActiveTimelineGesture();
        });
        expect(cancelled).toBe(false);
        // The later cancel neither re-dispatches the committed move nor rewinds.
        expect(mocks.executeUserAppAction).toHaveBeenCalledTimes(1);
        expect(trackStore.value?.tracks.find((track) => track.id === 't2')?.clips).toHaveLength(0);
    });
});
