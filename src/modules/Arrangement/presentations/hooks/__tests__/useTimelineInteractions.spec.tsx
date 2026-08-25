import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useTimelineInteractions } from '../useTimelineInteractions';

// Massive mock list
type MockStoreBox = { value: Record<string, unknown> };
const mocks = vi.hoisted(
    (): {
        broadcastPresence: ReturnType<typeof vi.fn>;
        zoomTimeline: ReturnType<typeof vi.fn>;
        setPlayheadFromClick: ReturnType<typeof vi.fn>;
        beginClipDrag: ReturnType<typeof vi.fn>;
        hitTestClip: ReturnType<typeof vi.fn>;
        hitTestTrack: ReturnType<typeof vi.fn>;
        hitTestClipEdge: ReturnType<typeof vi.fn>;
        snapToGrid: ReturnType<typeof vi.fn>;
        snapToGridOrClips: ReturnType<typeof vi.fn>;
        snapToZeroCrossing: ReturnType<typeof vi.fn>;
        setMarqueeSelection: ReturnType<typeof vi.fn>;
        toggleClipInSelection: ReturnType<typeof vi.fn>;
        selectClipWithFocus: ReturnType<typeof vi.fn>;
        clearClipSelection: ReturnType<typeof vi.fn>;
        setClipSelection: ReturnType<typeof vi.fn>;
        selectClip: ReturnType<typeof vi.fn>;
        setWorkspaceMode: ReturnType<typeof vi.fn>;
        toggleLoop: ReturnType<typeof vi.fn>;
        getTransportState: ReturnType<typeof vi.fn>;
        setLoopRegion: ReturnType<typeof vi.fn>;
        commitInlineAutomationPaint: ReturnType<typeof vi.fn>;
        commitInlineMidiNoteMove: ReturnType<typeof vi.fn>;
        pushUndoEntry: ReturnType<typeof vi.fn>;
        selectTrack: ReturnType<typeof vi.fn>;
        addClip: ReturnType<typeof vi.fn>;
        removeClip: ReturnType<typeof vi.fn>;
        moveClip: ReturnType<typeof vi.fn>;
        trimClipStart: ReturnType<typeof vi.fn>;
        trimClipEnd: ReturnType<typeof vi.fn>;
        buildTimelineRenderModel: ReturnType<typeof vi.fn>;
        getTrackAtY: ReturnType<typeof vi.fn>;
        canvasXToBeat: ReturnType<typeof vi.fn>;
        getContentY: ReturnType<typeof vi.fn>;
        tryPaintSubLane: ReturnType<typeof vi.fn>;
        paintAutoDragPoint: ReturnType<typeof vi.fn>;
        handleCutTool: ReturnType<typeof vi.fn>;
        handleDrawTool: ReturnType<typeof vi.fn>;
        handleAutomationTool: ReturnType<typeof vi.fn>;
        acceptGhostClip: ReturnType<typeof vi.fn>;
        toggleInlineEditing: ReturnType<typeof vi.fn>;
        duplicateClipCore: ReturnType<typeof vi.fn>;
        slipClipContent: ReturnType<typeof vi.fn>;
        planRippleInsert: ReturnType<typeof vi.fn>;
        rippleInsertClip: ReturnType<typeof vi.fn>;
        undoRippleInsertClip: ReturnType<typeof vi.fn>;
        planRippleMove: ReturnType<typeof vi.fn>;
        rippleMoveClip: ReturnType<typeof vi.fn>;
        getTrackStoreState: ReturnType<typeof vi.fn>;
        setTrackState: ReturnType<typeof vi.fn>;
        collaborationStoreValue: MockStoreBox;
        timelineViewStoreValue: MockStoreBox;
        workspaceStoreValue: MockStoreBox;
        clipSelectionStoreValue: MockStoreBox;
        trackStoreValue: MockStoreBox;
        midiStoreValue: MockStoreBox;
        preferencesStoreValue: MockStoreBox;
        inlineMidiNotePreviewRef: { current: unknown };
    } => ({
        broadcastPresence: vi.fn(),
        zoomTimeline: vi.fn(),
        setPlayheadFromClick: vi.fn(),
        beginClipDrag: vi.fn(),
        hitTestClip: vi.fn(),
        hitTestTrack: vi.fn(),
        hitTestClipEdge: vi.fn(),
        snapToGrid: vi.fn((buffer) => buffer),
        snapToGridOrClips: vi.fn((beat) => beat),
        snapToZeroCrossing: vi.fn((_, beat) => beat),
        setMarqueeSelection: vi.fn(),
        toggleClipInSelection: vi.fn(),
        selectClipWithFocus: vi.fn(),
        clearClipSelection: vi.fn(),
        setClipSelection: vi.fn(),
        selectClip: vi.fn(),
        setWorkspaceMode: vi.fn(),
        toggleLoop: vi.fn(),
        getTransportState: vi.fn(),
        setLoopRegion: vi.fn(),
        commitInlineAutomationPaint: vi.fn(),
        commitInlineMidiNoteMove: vi.fn(),
        pushUndoEntry: vi.fn(),
        selectTrack: vi.fn(),
        addClip: vi.fn(),
        removeClip: vi.fn(),
        moveClip: vi.fn(),
        trimClipStart: vi.fn(),
        trimClipEnd: vi.fn(),
        buildTimelineRenderModel: vi.fn(),
        getTrackAtY: vi.fn(),
        canvasXToBeat: vi.fn((x) => x / 100),
        getContentY: vi.fn((y, state) => y + state),
        tryPaintSubLane: vi.fn(),
        paintAutoDragPoint: vi.fn(),
        handleCutTool: vi.fn(),
        handleDrawTool: vi.fn(),
        handleAutomationTool: vi.fn(),
        acceptGhostClip: vi.fn(),
        toggleInlineEditing: vi.fn(),
        duplicateClipCore: vi.fn(),
        slipClipContent: vi.fn(),
        planRippleInsert: vi.fn(),
        rippleInsertClip: vi.fn(),
        undoRippleInsertClip: vi.fn(),
        planRippleMove: vi.fn(),
        rippleMoveClip: vi.fn(),
        getTrackStoreState: vi.fn(),
        setTrackState: vi.fn(),
        collaborationStoreValue: { value: { isEnabled: false } },
        timelineViewStoreValue: { value: { scrollY: 0, pixelsPerBeat: 100, scrollX: 0 } },
        workspaceStoreValue: {
            value: { activeTool: 'select', selectedClipIds: [], automationVisibility: 'hidden' },
        },
        clipSelectionStoreValue: {
            value: { selectedClipId: null, selectedClipIds: [], marqueeSelection: null },
        },
        trackStoreValue: { value: { tracks: [] } },
        midiStoreValue: { value: { notesByClipId: {} } },
        preferencesStoreValue: { value: {} },
        inlineMidiNotePreviewRef: { current: null },
    })
);

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
vi.mock('../../../stores/timelineViewStore', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    timelineViewStore: {
        get value() {
            return mocks.timelineViewStoreValue.value;
        },
    },
    zoomTimeline: mocks.zoomTimeline,
}));
vi.mock('../../../useCases/timelineInteractions/setPlayheadFromClick', () => ({
    setPlayheadFromClick: mocks.setPlayheadFromClick,
}));
vi.mock('../../../useCases/timelineInteractions/beginClipDrag', () => ({ beginClipDrag: mocks.beginClipDrag }));
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestClip', () => ({ hitTestClip: mocks.hitTestClip }));
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestTrack', () => ({
    hitTestTrack: mocks.hitTestTrack,
}));
vi.mock('../../../useCases/timelineInteractions/hitTestClipEdge', () => ({ hitTestClipEdge: mocks.hitTestClipEdge }));
vi.mock('../../../useCases/timelineInteractions/snapToGrid', () => ({ snapToGrid: mocks.snapToGrid }));
vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    workspaceStore: {
        get value() {
            return mocks.workspaceStoreValue.value;
        },
    },
}));
vi.mock('../../../stores/clipSelectionStore', () => ({
    clipSelectionStore: {
        get value() {
            return mocks.clipSelectionStoreValue.value;
        },
    },
}));
vi.mock('#/modules/Preferences/stores', () => ({
    preferencesStore: {
        get value() {
            return mocks.preferencesStoreValue.value;
        },
    },
}));
vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setWorkspaceMode: mocks.setWorkspaceMode,
}));
vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
        subscribe: vi.fn(() => () => {}),
    },
}));
vi.mock('../../../useCases/clipSelection/toggleClipInSelection', () => ({
    toggleClipInSelection: mocks.toggleClipInSelection,
}));
vi.mock('../../../useCases/clipSelection/selectClipWithFocus', () => ({
    selectClipWithFocus: mocks.selectClipWithFocus,
}));
vi.mock('../../../useCases/clipSelection/clearClipSelection', () => ({ clearClipSelection: mocks.clearClipSelection }));
vi.mock('../../../useCases/clipSelection/setClipSelection', () => ({ setClipSelection: mocks.setClipSelection }));
vi.mock('../../../useCases/clipSelection/selectClip', () => ({ selectClip: mocks.selectClip }));
vi.mock('../../../useCases/clipSelection/setMarqueeSelection', () => ({
    setMarqueeSelection: mocks.setMarqueeSelection,
}));
vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    toggleLoop: mocks.toggleLoop,
    getTransportState: mocks.getTransportState,
    setLoopRegion: mocks.setLoopRegion,
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: mocks.pushUndoEntry,
}));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
    },
}));
vi.mock('../../../stores/inlineMidiNotePreviewRef', () => ({
    inlineMidiNotePreviewRef: mocks.inlineMidiNotePreviewRef,
}));
vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({ selectTrack: mocks.selectTrack }));
vi.mock('../../../useCases/clip/addClip', () => ({ addClip: mocks.addClip }));
vi.mock('../../../useCases/clip/removeClip', () => ({ removeClip: mocks.removeClip }));
vi.mock('../../../useCases/clip/moveClip', () => ({ moveClip: mocks.moveClip }));
vi.mock('../../../useCases/clipEditing/trimClipStart', () => ({ trimClipStart: mocks.trimClipStart }));
vi.mock('../../../useCases/clipEditing/trimClipEnd', () => ({ trimClipEnd: mocks.trimClipEnd }));
vi.mock('../../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: mocks.buildTimelineRenderModel,
}));
vi.mock('../../../useCases/timelineInteractions/commitInlineAutomationPaint', () => ({
    commitInlineAutomationPaint: mocks.commitInlineAutomationPaint,
}));
vi.mock('../../../useCases/timelineInteractions/commitInlineMidiNoteMove', () => ({
    commitInlineMidiNoteMove: mocks.commitInlineMidiNoteMove,
}));
vi.mock('../../../useCases/timelineInteractions/getTrackAtY', () => ({ getTrackAtY: mocks.getTrackAtY }));
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
vi.mock('../../../useCases/clip/acceptGhostClip', () => ({ acceptGhostClip: mocks.acceptGhostClip }));
vi.mock('../../../useCases/clipEditing/toggleInlineEditing', () => ({
    toggleInlineEditing: mocks.toggleInlineEditing,
}));
vi.mock('../../../useCases/clip/duplicateClipCore', () => ({ duplicateClipCore: mocks.duplicateClipCore }));
vi.mock('../../../useCases/clipEditing/slipClipContent', () => ({ slipClipContent: mocks.slipClipContent }));
vi.mock('../../../useCases/rippleInsert/planRippleInsert', () => ({ planRippleInsert: mocks.planRippleInsert }));
vi.mock('../../../useCases/rippleInsert/rippleInsertClip', () => ({
    rippleInsertClip: mocks.rippleInsertClip,
}));
vi.mock('../../../useCases/rippleInsert/undoRippleInsertClip', () => ({
    undoRippleInsertClip: mocks.undoRippleInsertClip,
}));
vi.mock('../../../useCases/rippleMove/planRippleMove', () => ({ planRippleMove: mocks.planRippleMove }));
vi.mock('../../../useCases/rippleMove/rippleMoveClip', () => ({ rippleMoveClip: mocks.rippleMoveClip }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../useCases/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../useCases/timelineInteractions/snapToGridOrClips', () => ({
    snapToGridOrClips: mocks.snapToGridOrClips,
}));
vi.mock('../../../useCases/timelineInteractions/snapToZeroCrossing', () => ({
    snapToZeroCrossing: mocks.snapToZeroCrossing,
}));

describe('useTimelineInteractions', () => {
    let canvas: HTMLCanvasElement;
    let canvasRef: { current: HTMLCanvasElement | null };

    beforeEach(() => {
        vi.clearAllMocks();
        canvas = document.createElement('canvas');
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 500 } as any);
        canvasRef = { current: canvas };
        mocks.buildTimelineRenderModel.mockReturnValue({ tracks: [], tempo: 120 });
        mocks.hitTestClip.mockReturnValue(null);
        mocks.beginClipDrag.mockReturnValue(undefined);
        mocks.hitTestClipEdge.mockReturnValue(null);
        mocks.workspaceStoreValue.value = { activeTool: 'select', selectedClipIds: [], automationVisibility: 'hidden' };
        mocks.timelineViewStoreValue.value = { scrollY: 0, pixelsPerBeat: 100, scrollX: 0 };
        mocks.collaborationStoreValue.value = { isEnabled: false };
        mocks.trackStoreValue.value = { tracks: [] };
        mocks.midiStoreValue.value = { notesByClipId: {} };
        mocks.inlineMidiNotePreviewRef.current = null;
        mocks.clipSelectionStoreValue.value = { selectedClipId: null, selectedClipIds: [], marqueeSelection: null };
    });

    it('selects a clip on mouse down', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 50, clientY: 50 } as any);
        });

        expect(mocks.selectTrack).toHaveBeenCalledWith('t1');
        expect(mocks.selectClipWithFocus).toHaveBeenCalledWith('c1');
    });

    it('clears selection and starts rubber band when clicking empty space', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        mocks.hitTestClip.mockReturnValue(null);
        mocks.hitTestTrack.mockReturnValue('t1');

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 10, clientY: 10 } as any);
        });

        expect(mocks.clearClipSelection).toHaveBeenCalled();
        expect(mocks.selectTrack).toHaveBeenCalledWith('t1');
        expect(mocks.setPlayheadFromClick).toHaveBeenCalledWith(10);
    });

    it('opens context menu on right click', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });

        const mockEvent = {
            preventDefault: vi.fn(),
            clientX: 100,
            clientY: 200,
            button: 2, // Right click
        };

        act(() => {
            result.current.handleContextMenu(mockEvent as any);
        });

        expect(result.current.contextMenu).toMatchObject({
            kind: 'clip',
            clipId: 'c1',
            x: 100,
            y: 200,
        });
    });

    it('handles rubber band dragging', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        // Start rubber band
        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 10, clientY: 10 } as any);
        });

        // Move mouse
        act(() => {
            result.current.handleMouseMove({ clientX: 50, clientY: 50 } as any);
        });

        expect(result.current.rubberBand).toEqual({
            startX: 10,
            startY: 10,
            endX: 50,
            endY: 50,
        });
    });

    it('previews an inline MIDI note drag and commits once on mouse up', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));
        mocks.hitTestClip.mockReturnValue({
            clipId: 'clip-1',
            trackId: 'track-1',
            noteId: 'note-1',
            noteHeight: 10,
        });
        mocks.midiStoreValue.value = {
            notesByClipId: {
                'clip-1': [{ id: 'note-1', pitch: 60, startBeat: 1, duration: 0.5, velocity: 100 }],
            },
        };

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 100, clientY: 100 } as any);
            result.current.handleMouseMove({ clientX: 250, clientY: 80 } as any);
        });

        expect(mocks.inlineMidiNotePreviewRef.current).toEqual({
            clipId: 'clip-1',
            noteId: 'note-1',
            pitch: 62,
            startBeat: 2.5,
        });

        act(() => {
            result.current.handleMouseUp({ clientX: 250, clientY: 80 } as any);
        });

        expect(mocks.inlineMidiNotePreviewRef.current).toBeNull();
        expect(mocks.commitInlineMidiNoteMove).toHaveBeenCalledTimes(1);
        expect(mocks.commitInlineMidiNoteMove).toHaveBeenCalledWith({
            clipId: 'clip-1',
            noteId: 'note-1',
            pitch: 62,
            startBeat: 2.5,
        });
    });

    it('stages visible automation paint and commits it on mouse up', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));
        const draft = {
            laneId: 'lane-1',
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }],
        };
        mocks.workspaceStoreValue.value = {
            activeTool: 'select',
            selectedClipIds: [],
            automationVisibility: 'visible',
        };
        mocks.tryPaintSubLane.mockImplementation((_, __, ref) => {
            ref.current = draft;
            return true;
        });

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 100, clientY: 100 } as any);
            result.current.handleMouseUp({ clientX: 100, clientY: 100 } as any);
        });

        expect(mocks.commitInlineAutomationPaint).toHaveBeenCalledTimes(1);
        expect(mocks.commitInlineAutomationPaint).toHaveBeenCalledWith(draft);
    });

    const trimCases = [
        {
            name: 'trim start',
            mode: 'trim-start',
            edge: 'left',
            lowerUseCase: mocks.trimClipStart,
            expectedLabel: 'Trim clip start',
        },
        {
            name: 'trim end',
            mode: 'stretch',
            edge: 'right',
            lowerUseCase: mocks.trimClipEnd,
            expectedLabel: 'Trim clip end',
        },
    ] as const;

    const commitTrimPreview = ({ mode, edge }: Pick<(typeof trimCases)[number], 'mode' | 'edge'>) => {
        mocks.trackStoreValue.value = {
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', startBeat: 0, endBeat: 4 }] }],
        };
        mocks.hitTestClip.mockReturnValue({ clipId: 'clip-1', trackId: 'track-1' });
        mocks.hitTestClipEdge.mockReturnValue({ edge });
        mocks.beginClipDrag.mockReturnValue({
            clipId: 'clip-1',
            sourceTrackId: 'track-1',
            startBeat: 0,
            endBeat: 4,
            offsetBeat: 0,
            mode,
        });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 200, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 200, clientY: 20 } as any);
        });
    };

    it.each(trimCases)(
        '$name publishes no callback undo entry after a rejected write',
        ({ mode, edge, lowerUseCase }) => {
            lowerUseCase.mockReturnValue(false);
            commitTrimPreview({ mode, edge });

            expect(lowerUseCase).toHaveBeenCalledWith('clip-1', 2);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        }
    );

    it.each(trimCases)(
        '$name preserves callback undo publication after a committed write',
        ({ mode, edge, lowerUseCase, expectedLabel }) => {
            lowerUseCase.mockReturnValue(true);
            commitTrimPreview({ mode, edge });

            expect(lowerUseCase).toHaveBeenCalledWith('clip-1', 2);
            expect(mocks.pushUndoEntry).toHaveBeenCalledOnce();
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(expectedLabel, expect.any(Function), expect.any(Function));
        }
    );

    const pointer = (pointerId: number, clientX: number, clientY: number) =>
        ({ pointerId, clientX, clientY, nativeEvent: { clientX, clientY } }) as any;

    it('applies a proportional pinch-zoom step (not a fixed ±2)', () => {
        // finding #81/#17: the pointer pinch must scale with the spread delta to
        // match the Ctrl+wheel / gesture feel, instead of a flat ±2 ppb jump.
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handlePointerDown(pointer(1, 0, 0));
            result.current.handlePointerDown(pointer(2, 100, 0)); // 100px apart
        });
        // Spread grows by 50px (pointer 2 moves 100 → 150).
        act(() => {
            result.current.handlePointerMove(pointer(2, 150, 0));
        });

        // 50px delta * 0.02 = +1.0 ppb — proportional, and distinct from the old ±2.
        expect(mocks.zoomTimeline).toHaveBeenCalledTimes(1);
        expect(mocks.zoomTimeline).toHaveBeenCalledWith(1);
    });

    it('ignores a 3rd pointer so it cannot pollute the pinch distance (finding #60)', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handlePointerDown(pointer(1, 0, 0));
            result.current.handlePointerDown(pointer(2, 100, 0));
            result.current.handlePointerDown(pointer(3, 999, 999)); // 3rd contact — ignored
        });

        // Moving the (untracked) 3rd pointer must not trigger a zoom: it isn't in
        // the 2-pointer map, so there is no prior position to diff against.
        act(() => {
            result.current.handlePointerMove(pointer(3, 0, 0));
        });
        expect(mocks.zoomTimeline).not.toHaveBeenCalled();

        // The genuine two-pointer pinch still works: pointer 2 spreads by 100px.
        act(() => {
            result.current.handlePointerMove(pointer(2, 200, 0));
        });
        expect(mocks.zoomTimeline).toHaveBeenCalledTimes(1);
        expect(mocks.zoomTimeline).toHaveBeenCalledWith(2); // 100px * 0.02
    });

    it('dispatches to the cut tool when the active tool is cut', () => {
        mocks.workspaceStoreValue.value = { activeTool: 'cut', selectedClipIds: [], automationVisibility: 'hidden' };
        mocks.snapToGrid.mockReturnValue(7);
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 50, clientY: 50 } as any);
        });

        expect(mocks.handleCutTool).toHaveBeenCalledWith(50, 50, 7);
        expect(mocks.hitTestClip).not.toHaveBeenCalled();
    });

    it('dispatches to the draw tool when the active tool is draw', () => {
        mocks.workspaceStoreValue.value = { activeTool: 'draw', selectedClipIds: [], automationVisibility: 'hidden' };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 30, clientY: 30 } as any);
        });

        expect(mocks.handleDrawTool).toHaveBeenCalledWith(30, 30, 0.3, expect.any(Object));
    });

    it('skips the automation tool paint when the lane is hidden', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'automation',
            selectedClipIds: [],
            automationVisibility: 'hidden',
        };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 30, clientY: 30 } as any);
        });

        expect(mocks.handleAutomationTool).not.toHaveBeenCalled();
    });

    it('paints via the automation tool when the lane is visible', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'automation',
            selectedClipIds: [],
            automationVisibility: 'visible',
        };
        // Sub-lane paint runs first when the lane is visible; make it miss so the
        // automation tool dispatch is reached.
        mocks.tryPaintSubLane.mockReturnValue(false);
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 30, clientY: 30 } as any);
        });

        expect(mocks.handleAutomationTool).toHaveBeenCalledWith(30, 30, 0.3, 0, expect.any(Object));
    });

    it('returns the tool-specific cursor for each active tool', () => {
        const { result, rerender } = renderHook(() => useTimelineInteractions(canvasRef as any));
        const cases: Array<[string, string]> = [
            ['cut', 'crosshair'],
            ['draw', 'cell'],
            ['automation', 'crosshair'],
            ['stretch', 'ew-resize'],
            ['marquee', 'default'],
            ['select', 'default'],
        ];
        for (const [tool, expected] of cases) {
            mocks.workspaceStoreValue.value = {
                activeTool: tool,
                selectedClipIds: [],
                automationVisibility: 'hidden',
            };
            rerender();
            expect(result.current.getCursor()).toBe(expected);
        }
    });

    it('ignores a non-primary mouse button on mouse down', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 2, clientX: 50, clientY: 50 } as any);
        });

        expect(mocks.hitTestClip).not.toHaveBeenCalled();
        expect(mocks.selectTrack).not.toHaveBeenCalled();
    });

    it('opens an empty-space context menu when no clip is hit', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));
        mocks.hitTestClip.mockReturnValue(null);
        mocks.hitTestTrack.mockReturnValue('t-empty');

        act(() => {
            result.current.handleContextMenu({
                preventDefault: vi.fn(),
                clientX: 80,
                clientY: 90,
            } as any);
        });

        expect(result.current.contextMenu).toMatchObject({
            kind: 'empty',
            trackId: 't-empty',
            beat: 0,
            x: 80,
            y: 90,
        });
    });

    it('accepts a ghost clip on click instead of selecting it', () => {
        mocks.hitTestClip.mockReturnValue({ clipId: 'ghost-1', trackId: 't1' });
        mocks.trackStoreValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'ghost-1', startBeat: 0, endBeat: 2, isGhost: true }] }],
        };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 50, clientY: 50 } as any);
        });

        expect(mocks.acceptGhostClip).toHaveBeenCalledWith('ghost-1');
        expect(mocks.selectClipWithFocus).not.toHaveBeenCalled();
    });

    it('toggles a clip into the selection on shift+click', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 50, clientY: 50, shiftKey: true } as any);
        });

        expect(mocks.toggleClipInSelection).toHaveBeenCalledWith('c1');
        expect(mocks.selectClipWithFocus).not.toHaveBeenCalled();
    });

    it('toggles inline editing on a midi clip double click', () => {
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.trackStoreValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'midi', startBeat: 0, endBeat: 2 }] }],
        };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleDoubleClick({ clientX: 50, clientY: 50 } as any);
        });

        expect(mocks.toggleInlineEditing).toHaveBeenCalledWith('c1');
    });

    it('opens the clip editor on an audio clip double click', () => {
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.trackStoreValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'audio', startBeat: 0, endBeat: 2 }] }],
        };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleDoubleClick({ clientX: 50, clientY: 50 } as any);
        });

        expect(mocks.selectClip).toHaveBeenCalledWith('c1');
        expect(mocks.setWorkspaceMode).toHaveBeenCalledWith('clip');
    });

    it('draws a clip via the draw tool and pushes a non-ripple undo entry', () => {
        mocks.workspaceStoreValue.value = { activeTool: 'draw', selectedClipIds: [], automationVisibility: 'hidden' };
        mocks.handleDrawTool.mockImplementation((_x, _y, _beat, ref) => {
            ref.current = { trackId: 't1', startBeat: 2, clipType: 'audio' };
        });
        mocks.addClip.mockReturnValue({ id: 'drawn-1' });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 200, clientY: 50 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 500, clientY: 50 } as any);
        });

        // startBeat 2, endBeat ceil(5.0)=5 → length max(1, 3) = 3.
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({ trackId: 't1', startBeat: 2, endBeat: 5, type: 'audio' })
        );
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith('Draw clip', expect.any(Function), expect.any(Function));
        expect(mocks.planRippleInsert).not.toHaveBeenCalled();
    });

    it('draws a clip with ripple editing enabled and inserts shifted clips', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'draw',
            selectedClipIds: [],
            automationVisibility: 'hidden',
            rippleEditing: true,
        };
        mocks.handleDrawTool.mockImplementation((_x, _y, _beat, ref) => {
            ref.current = { trackId: 't1', startBeat: 2, clipType: 'midi' };
        });
        mocks.addClip.mockReturnValue({ id: 'drawn-1' });
        mocks.planRippleInsert.mockReturnValue({ shiftedClips: [{ clipId: 'other', deltaBeat: 3 }] });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 200, clientY: 50 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 500, clientY: 50 } as any);
        });

        expect(mocks.rippleInsertClip).toHaveBeenCalled();
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
            'Draw clip (ripple)',
            expect.any(Function),
            expect.any(Function)
        );
    });

    it('draws with ripple enabled but no shifted clips falls back to a plain draw undo', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'draw',
            selectedClipIds: [],
            automationVisibility: 'hidden',
            rippleEditing: true,
        };
        mocks.handleDrawTool.mockImplementation((_x, _y, _beat, ref) => {
            ref.current = { trackId: 't1', startBeat: 2, clipType: 'audio' };
        });
        mocks.addClip.mockReturnValue({ id: 'drawn-1' });
        mocks.planRippleInsert.mockReturnValue({ shiftedClips: [] });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 200, clientY: 50 } as any);
            result.current.handleMouseUp({ clientX: 500, clientY: 50 } as any);
        });

        expect(mocks.rippleInsertClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith('Draw clip', expect.any(Function), expect.any(Function));
    });

    it('does not push an undo entry when the drawn clip add returns nothing', () => {
        mocks.workspaceStoreValue.value = { activeTool: 'draw', selectedClipIds: [], automationVisibility: 'hidden' };
        mocks.handleDrawTool.mockImplementation((_x, _y, _beat, ref) => {
            ref.current = { trackId: 't1', startBeat: 2, clipType: 'audio' };
        });
        mocks.addClip.mockReturnValue(undefined);
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 200, clientY: 50 } as any);
            result.current.handleMouseUp({ clientX: 500, clientY: 50 } as any);
        });

        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('slip-edits clip content on Ctrl+Shift+drag and commits the new offset', () => {
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.trackStoreValue.value = {
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', type: 'audio', startBeat: 0, endBeat: 4, audioOffsetBeats: 0 }],
                },
            ],
        };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({
                button: 0,
                clientX: 100,
                clientY: 50,
                ctrlKey: true,
                shiftKey: true,
            } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 250, clientY: 50 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 250, clientY: 50 } as any);
        });

        // 150px / 100ppb = 1.5 beats delta → new offset 1.5.
        expect(mocks.slipClipContent).toHaveBeenCalledWith('c1', 'audio', 1.5);
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
            'Slip clip content',
            expect.any(Function),
            expect.any(Function)
        );
    });

    it('does not commit a slip when the drag delta is sub-threshold', () => {
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.trackStoreValue.value = {
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', type: 'audio', startBeat: 0, endBeat: 4, audioOffsetBeats: 0 }],
                },
            ],
        };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({
                button: 0,
                clientX: 100,
                clientY: 50,
                ctrlKey: true,
                shiftKey: true,
            } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 100, clientY: 50 } as any);
        });

        expect(mocks.slipClipContent).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('commits a clip move to a new track position with a plain undo entry', () => {
        mocks.trackStoreValue.value = {
            tracks: [
                { id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] },
                { id: 't2', clips: [] },
            ],
        };
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.beginClipDrag.mockReturnValue({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 4,
            offsetBeat: 0,
            mode: 'move',
        });
        mocks.getTrackAtY.mockReturnValue({ index: 1 });
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [
                { id: 't1', height: 100, clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] },
                { id: 't2', height: 100, clips: [] },
            ],
            tempo: 120,
        });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 300, clientY: 120 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 300, clientY: 120 } as any);
        });

        expect(mocks.moveClip).toHaveBeenCalledWith('c1', 't2', expect.any(Number), 0);
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith('Move clip', expect.any(Function), expect.any(Function));
    });

    it('commits an Alt+drag duplicate with a duplicate undo entry', () => {
        mocks.trackStoreValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
        };
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.beginClipDrag.mockReturnValue({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 4,
            offsetBeat: 0,
            mode: 'duplicate',
        });
        mocks.getTrackAtY.mockReturnValue({ index: 0 });
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [{ id: 't1', height: 100, clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
            tempo: 120,
        });
        // duplicateClipCore appends a new clip to the track; simulate by mutating store.
        mocks.duplicateClipCore.mockImplementation(() => {
            const s = mocks.trackStoreValue.value as { tracks: { id: string; clips: { id: string }[] }[] };
            s.tracks[0]!.clips.push({ id: 'copy-1' });
        });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 20, altKey: true } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 300, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 300, clientY: 20 } as any);
        });

        expect(mocks.duplicateClipCore).toHaveBeenCalled();
        expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
            'Duplicate 1 clip',
            expect.any(Function),
            expect.any(Function)
        );
    });

    it('selects clips intersecting a finished rubber-band and clears the marquee', () => {
        mocks.hitTestClip.mockReturnValue(null);
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [{ id: 't1', height: 100, clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
            tempo: 120,
        });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 10 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 400, clientY: 50 } as any);
        });
        // The rubber-band state must be live before mouse-up consumes it.
        expect(result.current.rubberBand).toMatchObject({ startX: 0, startY: 10, endX: 400, endY: 50 });
        act(() => {
            result.current.handleMouseUp({ clientX: 400, clientY: 50 } as any);
        });

        expect(mocks.setClipSelection).toHaveBeenCalledWith(['c1']);
        expect(mocks.setMarqueeSelection).toHaveBeenCalledWith(null);
    });

    it('uses marquee selection when the active tool is marquee', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'marquee',
            selectedClipIds: [],
            automationVisibility: 'hidden',
        };
        mocks.hitTestClip.mockReturnValue(null);
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [{ id: 't1', height: 100, clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
            tempo: 120,
        });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 10 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 400, clientY: 50 } as any);
        });
        expect(result.current.rubberBand).toMatchObject({ startX: 0, startY: 10, endX: 400, endY: 50 });
        act(() => {
            result.current.handleMouseUp({ clientX: 400, clientY: 50 } as any);
        });

        expect(mocks.setMarqueeSelection).toHaveBeenCalledWith(expect.objectContaining({ trackIds: ['t1'] }));
    });

    it('clears the marquee on a plain click with the marquee tool', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'marquee',
            selectedClipIds: [],
            automationVisibility: 'hidden',
        };
        mocks.hitTestClip.mockReturnValue(null);
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 10, clientY: 10 } as any);
            result.current.handleMouseUp({ clientX: 10, clientY: 10 } as any);
        });

        expect(mocks.setMarqueeSelection).toHaveBeenCalledWith(null);
    });

    it('tracks a single pointer move when no pinch is active', () => {
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handlePointerDown(pointer(1, 10, 10));
        });
        // A single-pointer move (size 1 < 2) must record the new position rather
        // than attempt a pinch zoom.
        act(() => {
            result.current.handlePointerMove(pointer(1, 40, 40));
        });

        expect(mocks.zoomTimeline).not.toHaveBeenCalled();
    });

    it('defaults a missing audio offset to 0 when starting a slip drag', () => {
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        // The clip carries no audioOffsetBeats — the slip start must fall back to 0.
        mocks.trackStoreValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'audio', startBeat: 0, endBeat: 4 }] }],
        };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({
                button: 0,
                clientX: 100,
                clientY: 50,
                ctrlKey: true,
                shiftKey: true,
            } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 250, clientY: 50 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 250, clientY: 50 } as any);
        });

        // 150px / 100ppb = 1.5 beats from a base offset of 0.
        expect(mocks.slipClipContent).toHaveBeenCalledWith('c1', 'audio', 1.5);
    });

    it('defaults a missing midi offset to 0 when starting a slip drag on a midi clip', () => {
        mocks.hitTestClip.mockReturnValue({ clipId: 'cm', trackId: 't1' });
        mocks.trackStoreValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'cm', type: 'midi', startBeat: 0, endBeat: 4 }] }],
        };
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({
                button: 0,
                clientX: 100,
                clientY: 50,
                ctrlKey: true,
                shiftKey: true,
            } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 200, clientY: 50 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 200, clientY: 50 } as any);
        });

        // 100px / 100ppb = 1.0 beats from a base offset of 0.
        expect(mocks.slipClipContent).toHaveBeenCalledWith('cm', 'midi', 1);
    });

    it('broadcasts cursor presence to collaborators while dragging (throttled)', () => {
        mocks.collaborationStoreValue.value = { isEnabled: true };
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.trackStoreValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'audio', startBeat: 0, endBeat: 4 }] }],
        };
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [{ id: 't1', height: 100, clips: [] }],
            tempo: 120,
        });
        mocks.getTrackAtY.mockReturnValue({ index: 0 });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 100, clientY: 50 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 300, clientY: 50 } as any);
        });

        // The cursor presence delta must carry the dragged-to beat (cursor-only,
        // no playheadBeat) and a resolved track id.
        expect(mocks.broadcastPresence).toHaveBeenCalledWith(
            expect.objectContaining({ cursorBeat: expect.any(Number) })
        );
        const presenceCall = mocks.broadcastPresence.mock.calls[0]![0];
        expect(presenceCall).not.toHaveProperty('playheadBeat');
        expect(presenceCall.cursorTrackId).not.toBeUndefined();
    });

    it('snaps a stretch (trim-end) drag to the nearest zero crossing for audio clips', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'select',
            selectedClipIds: [],
            automationVisibility: 'hidden',
        };
        mocks.preferencesStoreValue.value = { snapToZeroCrossing: true };
        mocks.trackStoreValue.value = {
            tracks: [{ id: 't1', clips: [{ id: 'c1', type: 'audio', startBeat: 0, endBeat: 4 }] }],
        };
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.hitTestClipEdge.mockReturnValue({ edge: 'right' });
        mocks.beginClipDrag.mockReturnValue({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 4,
            offsetBeat: 0,
            mode: 'stretch',
        });
        mocks.snapToZeroCrossing.mockReturnValue(7);
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 200, clientY: 20 } as any);
        });

        // snapToZeroCrossing was consulted for the audio clip and its result (7) used.
        expect(mocks.snapToZeroCrossing).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'c1' }),
            expect.any(Number)
        );
    });

    it('skips selected ids that have no preview original during a multi-clip move', () => {
        mocks.trackStoreValue.value = {
            tracks: [
                { id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] },
                { id: 't2', clips: [] },
            ],
        };
        mocks.clipSelectionStoreValue.value = {
            selectedClipId: 'c1',
            selectedClipIds: ['c1', 'c2'], // c2 has no preview original — must be skipped.
            marqueeSelection: null,
        };
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.beginClipDrag.mockReturnValue({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 4,
            offsetBeat: 0,
            mode: 'move',
        });
        mocks.getTrackAtY.mockReturnValue({ index: 1 });
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [
                { id: 't1', height: 100, clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] },
                { id: 't2', height: 100, clips: [] },
            ],
            tempo: 120,
        });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 300, clientY: 120 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 300, clientY: 120 } as any);
        });

        // Only c1 (which has an original) is moved; c2 is skipped silently.
        expect(mocks.moveClip).toHaveBeenCalledWith('c1', 't2', expect.any(Number), 0);
        expect(mocks.moveClip).not.toHaveBeenCalledWith('c2', expect.anything(), expect.anything(), expect.anything());
    });

    it('re-inserts the clip via the draw-ripple redo callback', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'draw',
            selectedClipIds: [],
            automationVisibility: 'hidden',
            rippleEditing: true,
        };
        mocks.handleDrawTool.mockImplementation((_x, _y, _beat, ref) => {
            ref.current = { trackId: 't1', startBeat: 2, clipType: 'midi' };
        });
        // First addClip (draw) returns a clip; the redo's addClip returns a clip too.
        mocks.addClip.mockReturnValue({ id: 'drawn-1' });
        mocks.planRippleInsert.mockReturnValue({ shiftedClips: [{ clipId: 'other', deltaBeat: 3 }] });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 200, clientY: 50 } as any);
            result.current.handleMouseUp({ clientX: 500, clientY: 50 } as any);
        });

        // The redo callback (3rd arg) must re-add the clip and replay the ripple insert.
        const redo = mocks.pushUndoEntry.mock.calls.at(-1)![2] as () => void;
        mocks.rippleInsertClip.mockClear();
        mocks.addClip.mockClear();
        act(() => redo());

        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 't1' }));
        expect(mocks.rippleInsertClip).toHaveBeenCalled();
    });

    it('commits a same-track move with ripple editing and replays undo/redo', () => {
        mocks.workspaceStoreValue.value = {
            activeTool: 'select',
            selectedClipIds: [],
            automationVisibility: 'hidden',
            rippleEditing: true,
        };
        mocks.trackStoreValue.value = {
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', type: 'audio', startBeat: 0, endBeat: 4 },
                        { id: 'c2', type: 'audio', startBeat: 4, endBeat: 8 },
                    ],
                },
            ],
        };
        mocks.hitTestClip.mockReturnValue({ clipId: 'c1', trackId: 't1' });
        mocks.beginClipDrag.mockReturnValue({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 4,
            offsetBeat: 0,
            mode: 'move',
        });
        mocks.getTrackAtY.mockReturnValue({ index: 0 });
        mocks.buildTimelineRenderModel.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    height: 100,
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 4 },
                        { id: 'c2', startBeat: 4, endBeat: 8 },
                    ],
                },
            ],
            tempo: 120,
        });
        // Ripple move produces a plan that closes a gap on c2.
        mocks.planRippleMove.mockReturnValue({
            gapClosedClips: [{ clipId: 'c2', origStartBeat: 4, origEndBeat: 8 }],
            destinationOpenedClips: [],
        });
        // Undo reads getTrackStoreState to restore shifted clips.
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 2, endBeat: 6 },
                        { id: 'c2', startBeat: 6, endBeat: 10 },
                    ],
                },
            ],
        });
        const { result } = renderHook(() => useTimelineInteractions(canvasRef as any));

        act(() => {
            result.current.handleMouseDown({ button: 0, clientX: 0, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseMove({ clientX: 200, clientY: 20 } as any);
        });
        act(() => {
            result.current.handleMouseUp({ clientX: 200, clientY: 20 } as any);
        });

        // Ripple move committed: rippleMoveClip ran and an undo entry was pushed.
        expect(mocks.rippleMoveClip).toHaveBeenCalled();
        const rippleCall = mocks.pushUndoEntry.mock.calls.find((call) => call[0] === 'Move clip (ripple)');
        expect(rippleCall).toBeTruthy();

        // Undo restores the moved clip and the ripple-shifted sibling.
        mocks.moveClip.mockClear();
        mocks.setTrackState.mockClear();
        const undo = rippleCall![1] as () => void;
        act(() => undo());
        expect(mocks.moveClip).toHaveBeenCalledWith('c1', 't1', expect.any(Number));
        expect(mocks.setTrackState).toHaveBeenCalled();

        // Redo replays the ripple move.
        mocks.rippleMoveClip.mockClear();
        mocks.planRippleMove.mockReturnValue({
            gapClosedClips: [],
            destinationOpenedClips: [],
        });
        const redo = rippleCall![2] as () => void;
        act(() => redo());
        expect(mocks.planRippleMove).toHaveBeenCalled();
    });
});
