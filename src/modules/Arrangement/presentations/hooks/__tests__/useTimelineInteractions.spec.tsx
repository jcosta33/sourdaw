import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineInteractions } from '../useTimelineInteractions';

// Massive mock list
const mocks = vi.hoisted(() => ({
    broadcastPresence: vi.fn(),
    collaborationStoreValue: { value: { isEnabled: false } },
    timelineViewStoreValue: { value: { scrollY: 0, pixelsPerBeat: 100, scrollX: 0 } },
    zoomTimeline: vi.fn(),
    setPlayheadFromClick: vi.fn(),
    beginClipDrag: vi.fn(),
    hitTestClip: vi.fn(),
    hitTestTrack: vi.fn(),
    hitTestClipEdge: vi.fn(),
    snapToGrid: vi.fn(b => b),
    workspaceStoreValue: { value: { activeTool: 'select', selectedClipIds: [], automationVisibility: 'hidden' } },
    toggleClipInSelection: vi.fn(),
    selectClipWithFocus: vi.fn(),
    clearClipSelection: vi.fn(),
    setClipSelection: vi.fn(),
    selectClip: vi.fn(),
    setWorkspaceMode: vi.fn(),
    trackStoreValue: { value: { tracks: [] } },
    toggleLoop: vi.fn(),
    getTransportState: vi.fn(),
    setLoopRegion: vi.fn(),
    removeAutomationPoint: vi.fn(),
    batchAddAutomationPoints: vi.fn(),
    pushUndoEntry: vi.fn(),
    selectTrack: vi.fn(),
    addClip: vi.fn(),
    removeClip: vi.fn(),
    moveClip: vi.fn(),
    trimClipStart: vi.fn(),
    trimClipEnd: vi.fn(),
    buildTimelineRenderModel: vi.fn(),
    getTrackAtY: vi.fn(),
    canvasXToBeat: vi.fn(x => x / 100),
    getContentY: vi.fn((y, s) => y + s),
    tryPaintSubLane: vi.fn(),
    paintAutoDragPoint: vi.fn(),
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    broadcastPresence: mocks.broadcastPresence
}));
vi.mock('#/modules/Collaboration/stores', () => ({ collaborationStore: { get value() { return mocks.collaborationStoreValue.value; } } }));
vi.mock('../../../stores/timelineViewStore', async (importOriginal) => ({ 
    ...(await importOriginal<any>()),
    timelineViewStore: { get value() { return mocks.timelineViewStoreValue.value; } },
    zoomTimeline: mocks.zoomTimeline,
}));
vi.mock('../../../useCases/timelineInteractions/setPlayheadFromClick', () => ({ setPlayheadFromClick: mocks.setPlayheadFromClick }));
vi.mock('../../../useCases/timelineInteractions/beginClipDrag', () => ({ beginClipDrag: mocks.beginClipDrag }));
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestClip', () => ({ hitTestClip: mocks.hitTestClip }));
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestTrack', () => ({ hitTestTrack: mocks.hitTestTrack }));
vi.mock('../../../useCases/timelineInteractions/hitTestClipEdge', () => ({ hitTestClipEdge: mocks.hitTestClipEdge }));
vi.mock('../../../useCases/timelineInteractions/snapToGrid', () => ({ snapToGrid: mocks.snapToGrid }));
vi.mock('#/modules/Workspace/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    workspaceStore: { get value() { return mocks.workspaceStoreValue.value; } },
    preferencesStore: { value: {} }
}));
vi.mock('#/modules/Workspace/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    toggleClipInSelection: mocks.toggleClipInSelection,
    selectClipWithFocus: mocks.selectClipWithFocus,
    clearClipSelection: mocks.clearClipSelection,
    setClipSelection: mocks.setClipSelection,
    selectClip: mocks.selectClip,
    setWorkspaceMode: mocks.setWorkspaceMode,
}));
vi.mock('../../../stores/trackStore', () => ({ trackStore: { get value() { return mocks.trackStoreValue.value; } } }));
vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    toggleLoop: mocks.toggleLoop,
    getTransportState: mocks.getTransportState,
    setLoopRegion: mocks.setLoopRegion,
}));
vi.mock('#/modules/Automation', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    removeAutomationPoint: mocks.removeAutomationPoint,
    batchAddAutomationPoints: mocks.batchAddAutomationPoints,
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    pushUndoEntry: mocks.pushUndoEntry
}));
vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({ selectTrack: mocks.selectTrack }));
vi.mock('../../../useCases/clip/addClip', () => ({ addClip: mocks.addClip }));
vi.mock('../../../useCases/clip/removeClip', () => ({ removeClip: mocks.removeClip }));
vi.mock('../../../useCases/clip/moveClip', () => ({ moveClip: mocks.moveClip }));
vi.mock('../../../useCases/clipEditing/trimClipStart', () => ({ trimClipStart: mocks.trimClipStart }));
vi.mock('../../../useCases/clipEditing/trimClipEnd', () => ({ trimClipEnd: mocks.trimClipEnd }));
vi.mock('../../../useCases/buildTimelineRenderModel', () => ({ buildTimelineRenderModel: mocks.buildTimelineRenderModel }));
vi.mock('../../../useCases/timelineInteractions/getTrackAtY', () => ({ getTrackAtY: mocks.getTrackAtY }));
vi.mock('../helpers/timelineMouse', () => ({
    canvasXToBeat: mocks.canvasXToBeat,
    getContentY: mocks.getContentY,
}));
vi.mock('../helpers/timelineTools', () => ({
    handleCutTool: vi.fn(),
    handleDrawTool: vi.fn(),
    handleAutomationTool: vi.fn(),
    tryPaintSubLane: mocks.tryPaintSubLane,
    paintAutoDragPoint: mocks.paintAutoDragPoint,
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
});
