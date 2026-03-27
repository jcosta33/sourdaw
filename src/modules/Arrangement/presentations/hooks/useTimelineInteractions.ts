import { type MouseEvent, type DragEvent, useRef, useState, useCallback } from 'react';
import { timelineViewStore, zoomTimeline } from '../../stores/timelineViewStore';
import { useTimelineGestures } from './useTimelineGestures';
import { useTimelineFileDrop } from './useTimelineFileDrop';
import { setPlayheadFromClick } from '../../useCases/timelineInteractions/setPlayheadFromClick';
import { beginClipDrag, type DragState } from '../../useCases/timelineInteractions/beginClipDrag';
import { commitClipDrag } from '../../useCases/timelineInteractions/commitClipDrag';
import { hitTestClip, hitTestTrack } from '../../useCases/timelineInteractions/hitTestClip';
import { hitTestClipEdge } from '../../useCases/timelineInteractions/hitTestClipEdge';
import { snapToGrid } from '../../useCases/timelineInteractions/snapToGrid';
import { snapToGridOrClips } from '../../useCases/timelineInteractions/snapToGridOrClips';
import {
    selectTrack,
    setWorkspaceMode,
    addClip,
    removeClip,
    moveClipPreview,
    moveClip,
    removeAutomationPoint,
    batchAddAutomationPoints,
    pushUndoEntry,
    setLoopRegion,
    trimClipStart,
    trimClipEnd,
} from '../../useCases/timelineViewActions';
import { type AutomationPoint } from '#/modules/Automation/useCases/automation/types';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { getTrackAtY as getTrackAtYHelper } from '../../useCases/timelineInteractions/getTrackAtY';
import {
    toggleClipInSelection,
    selectClipWithFocus,
    clearClipSelection,
    setClipSelection,
    selectClip,
} from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { canvasXToBeat, getContentY } from '../helpers/timelineMouse';
import { handleCutTool, handleDrawTool, handleAutomationTool, tryPaintSubLane, paintAutoDragPoint } from '../helpers/timelineTools';

type ClipMenuState = { kind: 'clip'; x: number; y: number; clipId: string; trackId: string; splitBeat: number };
type EmptyMenuState = { kind: 'empty'; x: number; y: number; trackId: string | null; beat: number };
export type ContextMenuState = ClipMenuState | EmptyMenuState | null;

export const useTimelineInteractions = (canvasRef: React.RefObject<HTMLCanvasElement | null>) => {
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
    const pointersRef = useRef<Map<number, PointerEvent>>(new Map());
    const loopDragRef = useRef<{ startBeat: number } | null>(null);
    const autoDragRef = useRef<{ laneId: string; trackId: string; points: AutomationPoint[] } | null>(null);
    const drawDragRef = useRef<{ trackId: string; startBeat: number; clipType: 'audio' | 'midi' } | null>(null);
    const [rubberBand, setRubberBand] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(
        null
    );
    const rubberBandRef = useRef<{ startX: number; startY: number } | null>(null);
    const [hoverCursor, setHoverCursor] = useState<string | null>(null);

    useTimelineGestures(canvasRef);

    const getCanvasCoords = useCallback(
        (e: MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) {
                return { x: 0, y: 0 };
            }
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        },
        [canvasRef]
    );

    const getBeatFromX = useCallback((x: number): number => canvasXToBeat(x), []);

    const { handleFileDrop, isDragOver, setIsDragOver, isImporting } = useTimelineFileDrop({
        getCanvasCoords: useCallback(
            (e: DragEvent<HTMLDivElement>): { x: number; y: number } => {
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) {
                    return { x: 0, y: 0 };
                }
                return { x: e.clientX - rect.left, y: e.clientY - rect.top };
            },
            [canvasRef]
        ),
        getBeatFromX,
    });

    const getActiveTool = () => workspaceStore.value?.activeTool ?? 'select';
    const getScrollY = () => timelineViewStore.value?.scrollY ?? 0;

    // ── Mouse Down ────────────────────────────────────────────────────────────

    const handleMouseDown = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            if (e.button !== 0) {
                return;
            }
            const { x, y } = getCanvasCoords(e);
            const beat = getBeatFromX(x);
            const tool = getActiveTool();

            // Sub-lane paint when automation panel is visible (any tool)
            if (workspaceStore.value?.automationVisibility !== 'hidden') {
                if (tryPaintSubLane(x, y, autoDragRef)) {
                    return;
                }
            }

            if (tool === 'cut') {
                handleCutTool(x, y, snapToGrid(beat));
                return;
            }
            if (tool === 'draw') {
                handleDrawTool(x, y, beat, drawDragRef);
                return;
            }
            if (tool === 'automation') {
                handleAutomationTool(x, y, beat, getScrollY(), autoDragRef);
                return;
            }

            // ── Select tool: clip hit → select + maybe begin drag ──
            const clipHit = hitTestClip(x, y);
            if (clipHit) {
                selectTrack(clipHit.trackId);
                if (e.shiftKey || e.metaKey) {
                    toggleClipInSelection(clipHit.clipId);
                } else {
                    selectClipWithFocus(clipHit.clipId);
                }
            }

            const edgeHit = hitTestClipEdge(x, y);
            let dragMode: 'move' | 'stretch' | 'trim-start' = tool === 'stretch' ? 'stretch' : 'move';
            if (edgeHit && edgeHit.edge !== 'body' && tool === 'select') {
                dragMode = edgeHit.edge === 'left' ? 'trim-start' : 'stretch';
            }

            const drag = beginClipDrag(x, y, dragMode);
            if (drag) {
                setDragState(drag);
                return;
            }

            if (!clipHit) {
                selectTrack(hitTestTrack(y));
                clearClipSelection();
                rubberBandRef.current = { startX: x, startY: y };
                setPlayheadFromClick(x);
            }
        },
        [getCanvasCoords, getBeatFromX]
    );

    // ── Mouse Move ────────────────────────────────────────────────────────────

    const handleMouseMove = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            const { x, y } = getCanvasCoords(e);

            // Hover cursor (no active drag)
            if (!dragState && !loopDragRef.current && !autoDragRef.current && !drawDragRef.current && !rubberBandRef.current) {
                if (getActiveTool() === 'select') {
                    const edgeHit = hitTestClipEdge(x, y);
                    setHoverCursor(edgeHit && edgeHit.edge !== 'body' ? 'ew-resize' : null);
                } else {
                    setHoverCursor(null);
                }
            }

            if (loopDragRef.current) {
                const currentBeat = getBeatFromX(x);
                const { startBeat } = loopDragRef.current;
                const loopStart = Math.min(startBeat, currentBeat);
                const loopEnd = Math.max(startBeat, currentBeat);
                if (loopEnd - loopStart > 0.25) {
                    setLoopRegion(Math.floor(loopStart), Math.ceil(loopEnd));
                    const state = transportStore.value;
                    if (state && !state.isLooping) {
                        transportStore.set({ ...state, isLooping: true });
                    }
                }
                return;
            }

            if (autoDragRef.current) {
                paintAutoDragPoint(x, y, getScrollY(), autoDragRef);
                return;
            }

            if (drawDragRef.current) {
                return;
            }

            if (rubberBandRef.current) {
                const { startX, startY } = rubberBandRef.current;
                if (Math.abs(x - startX) > 4 || Math.abs(y - startY) > 4) {
                    setRubberBand({ startX, startY, endX: x, endY: y });
                }
                return;
            }

            if (!dragState) {
                return;
            }
            if (canvasRef.current) {
                canvasRef.current.style.cursor = 'grabbing';
            }

            const view = timelineViewStore.value;
            if (!view) {
                return;
            }
            const rawBeat = x / view.pixelsPerBeat + view.scrollX / view.pixelsPerBeat;

            if (dragState.mode === 'trim-start') {
                trimClipStart(dragState.clipId, Math.max(0, Math.min(dragState.endBeat - 0.25, snapToGrid(rawBeat))));
                return;
            }
            if (dragState.mode === 'stretch') {
                trimClipEnd(dragState.clipId, Math.max(dragState.startBeat + 0.25, snapToGrid(rawBeat)));
                return;
            }

            const contentY = getContentY(y, getScrollY());
            const model = buildTimelineRenderModel();
            const tracks = model?.tracks;
            if (!tracks) {
                return;
            }
            const trackHit = getTrackAtYHelper(tracks, Math.max(0, contentY));
            const targetTrack = trackHit ? tracks[trackHit.index] : null;
            const snapTrackId = targetTrack?.id ?? dragState.sourceTrackId;
            const snappedBeat = Math.max(0, snapToGridOrClips(rawBeat - dragState.offsetBeat, snapTrackId, dragState.clipId));

            if (targetTrack) {
                const selectedIds = workspaceStore.value?.selectedClipIds ?? [];
                if (selectedIds.length > 1 && selectedIds.includes(dragState.clipId)) {
                    const state = trackStore.value;
                    if (state) {
                        const primaryClip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === dragState.clipId);
                        if (primaryClip) {
                            const beatDelta = snappedBeat - primaryClip.startBeat;
                            for (const id of selectedIds) {
                                const clip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
                                if (clip) {
                                    moveClipPreview(id, targetTrack.id, Math.max(0, snapToGridOrClips(clip.startBeat + beatDelta, targetTrack.id, id)));
                                }
                            }
                        }
                    }
                } else {
                    moveClipPreview(dragState.clipId, targetTrack.id, snappedBeat);
                }
            }
        },
        [dragState, getCanvasCoords, getBeatFromX, canvasRef]
    );

    // ── Mouse Up ──────────────────────────────────────────────────────────────

    const handleMouseUp = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            if (loopDragRef.current) {
                loopDragRef.current = null;
                return;
            }

            if (autoDragRef.current) {
                const { laneId, points: drawnPoints } = autoDragRef.current;
                if (drawnPoints.length > 0) {
                    const savedPoints = drawnPoints.map((p) => ({ ...p }));
                    pushUndoEntry(
                        `Draw ${savedPoints.length} automation point${savedPoints.length > 1 ? 's' : ''}`,
                        () => { for (const p of savedPoints) { removeAutomationPoint(laneId, p.beat); } },
                        () => { batchAddAutomationPoints(laneId, savedPoints); }
                    );
                }
                autoDragRef.current = null;
                return;
            }

            if (drawDragRef.current) {
                const { x } = getCanvasCoords(e);
                const endBeat = Math.ceil(getBeatFromX(x));
                const { startBeat, trackId: drawTrackId, clipType: drawClipType } = drawDragRef.current;
                const s = Math.min(startBeat, endBeat);
                const length = Math.max(1, Math.max(startBeat, endBeat) - s);
                const clip = addClip({ trackId: drawTrackId, startBeat: s, endBeat: s + length, name: `Clip ${s}`, type: drawClipType });
                if (clip) {
                    const clipId = clip.id;
                    pushUndoEntry(
                        'Draw clip',
                        () => removeClip(clipId),
                        () => addClip({ trackId: drawTrackId, startBeat: s, endBeat: s + length, name: `Clip ${s}`, type: drawClipType })
                    );
                }
                drawDragRef.current = null;
                return;
            }

            if (rubberBandRef.current && rubberBand) {
                const view = timelineViewStore.value;
                const model = buildTimelineRenderModel();
                if (view && model) {
                    const left = Math.min(rubberBand.startX, rubberBand.endX);
                    const right = Math.max(rubberBand.startX, rubberBand.endX);
                    const sY = view.scrollY ?? 0;
                    const top = Math.min(rubberBand.startY, rubberBand.endY) + sY;
                    const bottom = Math.max(rubberBand.startY, rubberBand.endY) + sY;
                    const leftBeat = left / view.pixelsPerBeat + view.scrollX / view.pixelsPerBeat;
                    const rightBeat = right / view.pixelsPerBeat + view.scrollX / view.pixelsPerBeat;

                    const hitIds: string[] = [];
                    let trackYOffset = 0;
                    for (const track of model.tracks) {
                        const h = track.height;
                        if (!(trackYOffset + h < top || trackYOffset > bottom)) {
                            for (const clip of track.clips) {
                                if (clip.endBeat > leftBeat && clip.startBeat < rightBeat) {
                                    hitIds.push(clip.id);
                                }
                            }
                        }
                        trackYOffset += h;
                    }
                    setClipSelection(hitIds);
                }
                rubberBandRef.current = null;
                setRubberBand(null);
                return;
            }
            rubberBandRef.current = null;
            setRubberBand(null);

            if (dragState) {
                const { x, y } = getCanvasCoords(e);
                const { startBeat: origStart, endBeat: origEnd, sourceTrackId: origTrackId, clipId: dragClipId, mode: dragMode } = dragState;
                commitClipDrag(dragState, x, y);

                const afterClip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === dragClipId);
                if (afterClip) {
                    const { startBeat: newStart, endBeat: newEnd, trackId: newTrackId } = afterClip;
                    const changed = newStart !== origStart || newEnd !== origEnd || newTrackId !== origTrackId;
                    if (changed) {
                        if (dragMode === 'move') {
                            pushUndoEntry('Move clip', () => moveClip(dragClipId, origTrackId, origStart), () => moveClip(dragClipId, newTrackId, newStart));
                        } else if (dragMode === 'trim-start') {
                            pushUndoEntry('Trim clip start', () => trimClipStart(dragClipId, origStart), () => trimClipStart(dragClipId, newStart));
                        } else if (dragMode === 'stretch') {
                            pushUndoEntry('Trim clip end', () => trimClipEnd(dragClipId, origEnd), () => trimClipEnd(dragClipId, newEnd));
                        }
                    }
                }
                setDragState(null);
                if (canvasRef.current) {
                    canvasRef.current.style.cursor = '';
                }
            }
        },
        [dragState, rubberBand, getCanvasCoords, getBeatFromX, canvasRef]
    );

    // ── Double Click ──────────────────────────────────────────────────────────

    const handleDoubleClick = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            const { x, y } = getCanvasCoords(e);
            const hit = hitTestClip(x, y);
            if (hit) {
                selectTrack(hit.trackId);
                selectClip(hit.clipId);
                setWorkspaceMode('clip');
            }
        },
        [getCanvasCoords]
    );

    // ── Context Menu ──────────────────────────────────────────────────────────

    const handleContextMenu = useCallback(
        (e: MouseEvent<HTMLCanvasElement>) => {
            e.preventDefault();
            const { x, y } = getCanvasCoords(e);
            const hit = hitTestClip(x, y);
            if (hit) {
                selectTrack(hit.trackId);
                selectClip(hit.clipId);
                setContextMenu({ kind: 'clip', x: e.clientX, y: e.clientY, clipId: hit.clipId, trackId: hit.trackId, splitBeat: getBeatFromX(x) });
            } else {
                setContextMenu({ kind: 'empty', x: e.clientX, y: e.clientY, trackId: hitTestTrack(y), beat: Math.floor(getBeatFromX(x)) });
            }
        },
        [getCanvasCoords, getBeatFromX]
    );

    // ── Pointer (pinch-zoom) ──────────────────────────────────────────────────

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.set(e.pointerId, e.nativeEvent);
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (pointersRef.current.size === 2) {
            const prev = pointersRef.current.get(e.pointerId);
            pointersRef.current.set(e.pointerId, e.nativeEvent);
            if (!prev) return;
            const [p1, p2] = [...pointersRef.current.values()];
            if (!p1 || !p2) return;
            const prevOther = [...pointersRef.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
            if (!prevOther) return;
            const prevDist = Math.hypot(prev.clientX - prevOther.clientX, prev.clientY - prevOther.clientY);
            const currDist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
            const delta = currDist - prevDist;
            if (Math.abs(delta) > 1) {
                zoomTimeline(delta > 0 ? 2 : -2);
            }
        } else {
            pointersRef.current.set(e.pointerId, e.nativeEvent);
        }
    }, []);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.delete(e.pointerId);
    }, []);

    // ── Cursor ────────────────────────────────────────────────────────────────

    const getCursor = useCallback((): string => {
        if (hoverCursor) return hoverCursor;
        switch (getActiveTool()) {
            case 'cut': return 'crosshair';
            case 'draw': return 'cell';
            case 'automation': return 'crosshair';
            case 'stretch': return 'ew-resize';
            default: return 'default';
        }
    }, [hoverCursor]);

    return {
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleDoubleClick,
        handleContextMenu,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerCancel: handlePointerUp,
        handleFileDrop,
        getCursor,
        setIsDragOver,
        isDragOver,
        isImporting,
        rubberBand,
        contextMenu,
        setContextMenu,
    };
};
