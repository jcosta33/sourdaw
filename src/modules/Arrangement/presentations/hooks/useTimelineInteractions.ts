import { type MouseEvent, type DragEvent, useRef, useState } from 'react';
import { broadcastPresence } from '#/modules/Collaboration/useCases/collaboration/sessionManagement';
import { collaborationStore } from '#/modules/Collaboration/stores/collaborationStore';
import { timelineViewStore, zoomTimeline } from '../../stores/timelineViewStore';
import { useTimelineGestures } from './useTimelineGestures';
import { useTimelineFileDrop } from './useTimelineFileDrop';
import { setPlayheadFromClick } from '../../useCases/timelineInteractions/setPlayheadFromClick';
import { beginClipDrag, type DragState } from '../../useCases/timelineInteractions/beginClipDrag';
import { clipDragPreviewRef, type ClipPreviewPosition } from '../../stores/clipDragPreviewRef';
import { hitTestClip, hitTestTrack } from '../../useCases/timelineInteractions/hitTestClip';
import { hitTestClipEdge } from '../../useCases/timelineInteractions/hitTestClipEdge';
import { snapToGrid } from '../../useCases/timelineInteractions/snapToGrid';
import { snapToGridOrClips } from '../../useCases/timelineInteractions/snapToGridOrClips';
import {
    selectTrack,
    setWorkspaceMode,
    addClip,
    removeClip,
    moveClip,
    removeAutomationPoint,
    batchAddAutomationPoints,
    pushUndoEntry,
    setLoopRegion,
    trimClipStart,
    trimClipEnd,
} from '../../useCases/timelineViewActions';
import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { toggleLoop } from '#/modules/Transport/useCases/transportControls/toggleLoop';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
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
import {
    handleCutTool,
    handleDrawTool,
    handleAutomationTool,
    tryPaintSubLane,
    paintAutoDragPoint,
} from '../helpers/timelineTools';

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
    const lastPresenceBroadcastRef = useRef<number>(0);

    useTimelineGestures(canvasRef);

    const getCanvasCoords = (e: MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            return { x: 0, y: 0 };
        }
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const getBeatFromX = (x: number): number => canvasXToBeat(x);

    const { handleFileDrop, isDragOver, setIsDragOver, isImporting } = useTimelineFileDrop({
        getCanvasCoords: (e: DragEvent<HTMLDivElement>): { x: number; y: number } => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) {
                return { x: 0, y: 0 };
            }
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        },
        getBeatFromX,
    });

    const getActiveTool = () => workspaceStore.value?.activeTool ?? 'select';
    const getScrollY = () => timelineViewStore.value?.scrollY ?? 0;

    // ── Mouse Down ────────────────────────────────────────────────────────────

    const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
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
            // Capture original positions for all selected clips so mousemove can
            // write preview positions without touching any store.
            const selectedIds = workspaceStore.value?.selectedClipIds ?? [];
            const allIds = selectedIds.length > 1 && selectedIds.includes(drag.clipId) ? selectedIds : [drag.clipId];
            const state = trackStore.value;
            if (state) {
                const originals = new Map<string, ClipPreviewPosition>();
                for (const t of state.tracks) {
                    for (const clip of t.clips) {
                        if (allIds.includes(clip.id)) {
                            originals.set(clip.id, {
                                trackId: t.id,
                                startBeat: clip.startBeat,
                                endBeat: clip.endBeat,
                            });
                        }
                    }
                }
                clipDragPreviewRef.current = { positions: new Map(originals), originals };
            }
            setDragState(drag);
            return;
        }

        if (!clipHit) {
            selectTrack(hitTestTrack(y));
            clearClipSelection();
            rubberBandRef.current = { startX: x, startY: y };
            setPlayheadFromClick(x);
        }
    };

    // ── Mouse Move ────────────────────────────────────────────────────────────

    const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
        const { x, y } = getCanvasCoords(e);

        // Broadcast cursor presence to collaborators (~10 Hz throttle)
        if (collaborationStore.value?.isEnabled) {
            const now = performance.now();
            if (now - lastPresenceBroadcastRef.current > 100) {
                lastPresenceBroadcastRef.current = now;
                const cursorBeat = getBeatFromX(x);
                const tracks = trackStore.value?.tracks ?? [];
                const contentY = getContentY(y, getScrollY());
                const trackHit = getTrackAtYHelper(tracks, Math.max(0, contentY));
                broadcastPresence({
                    view: 'arrangement',
                    cursorBeat,
                    cursorTrackId: trackHit?.id ?? null,
                    selectedClipIds: [],
                    selectedNoteIds: [],
                    viewportStartBeat: 0,
                    viewportEndBeat: 0,
                    viewportTrackIds: [],
                    action: null,
                    playheadBeat: null,
                });
            }
        }

        // Hover cursor (no active drag)
        if (
            !dragState &&
            !loopDragRef.current &&
            !autoDragRef.current &&
            !drawDragRef.current &&
            !rubberBandRef.current
        ) {
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
                if (!getTransportState()?.isLooping) {
                    toggleLoop();
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
            const newStart = Math.max(0, Math.min(dragState.endBeat - 0.25, snapToGrid(rawBeat)));
            const preview = clipDragPreviewRef.current;
            if (preview) {
                const orig = preview.originals.get(dragState.clipId);
                if (orig) {
                    preview.positions.set(dragState.clipId, { ...orig, startBeat: newStart });
                }
            }
            return;
        }
        if (dragState.mode === 'stretch') {
            const newEnd = Math.max(dragState.startBeat + 0.25, snapToGrid(rawBeat));
            const preview = clipDragPreviewRef.current;
            if (preview) {
                const orig = preview.originals.get(dragState.clipId);
                if (orig) {
                    preview.positions.set(dragState.clipId, { ...orig, endBeat: newEnd });
                }
            }
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
        const snappedBeat = Math.max(
            0,
            snapToGridOrClips(rawBeat - dragState.offsetBeat, snapTrackId, dragState.clipId)
        );

        if (targetTrack) {
            const selectedIds = workspaceStore.value?.selectedClipIds ?? [];
            const preview = clipDragPreviewRef.current;
            if (preview) {
                const primaryOrig = preview.originals.get(dragState.clipId);
                if (selectedIds.length > 1 && selectedIds.includes(dragState.clipId) && primaryOrig) {
                    const beatDelta = snappedBeat - primaryOrig.startBeat;
                    for (const id of selectedIds) {
                        const orig = preview.originals.get(id);
                        if (orig) {
                            const newStart = Math.max(0, orig.startBeat + beatDelta);
                            preview.positions.set(id, {
                                trackId: targetTrack.id,
                                startBeat: newStart,
                                endBeat: newStart + (orig.endBeat - orig.startBeat),
                            });
                        }
                    }
                } else if (primaryOrig) {
                    const duration = primaryOrig.endBeat - primaryOrig.startBeat;
                    preview.positions.set(dragState.clipId, {
                        trackId: targetTrack.id,
                        startBeat: snappedBeat,
                        endBeat: snappedBeat + duration,
                    });
                }
            }
        }
    };

    // ── Mouse Up ──────────────────────────────────────────────────────────────

    const handleMouseUp = (e: MouseEvent<HTMLCanvasElement>) => {
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
                    () => {
                        for (const p of savedPoints) {
                            removeAutomationPoint(laneId, p.beat);
                        }
                    },
                    () => {
                        batchAddAutomationPoints(laneId, savedPoints);
                    }
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
            const clip = addClip({
                trackId: drawTrackId,
                startBeat: s,
                endBeat: s + length,
                name: `Clip ${s}`,
                type: drawClipType,
            });
            if (clip) {
                const clipId = clip.id;
                pushUndoEntry(
                    'Draw clip',
                    () => removeClip(clipId),
                    () =>
                        addClip({
                            trackId: drawTrackId,
                            startBeat: s,
                            endBeat: s + length,
                            name: `Clip ${s}`,
                            type: drawClipType,
                        })
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
            const {
                startBeat: origStart,
                endBeat: origEnd,
                sourceTrackId: origTrackId,
                clipId: dragClipId,
                mode: dragMode,
            } = dragState;

            // Commit preview positions to the store in one batch, then clear the ref.
            const preview = clipDragPreviewRef.current;
            clipDragPreviewRef.current = null;

            if (preview && preview.positions.size > 0) {
                const primaryPos = preview.positions.get(dragClipId);
                const primaryOrig = preview.originals.get(dragClipId);

                if (dragMode === 'move') {
                    for (const [clipId, pos] of preview.positions) {
                        const orig = preview.originals.get(clipId);
                        moveClip(clipId, pos.trackId, pos.startBeat, orig?.startBeat);
                    }
                    if (primaryPos && primaryOrig) {
                        const { trackId: newTrackId, startBeat: newStart } = primaryPos;
                        if (newStart !== primaryOrig.startBeat || newTrackId !== primaryOrig.trackId) {
                            pushUndoEntry(
                                'Move clip',
                                () => moveClip(dragClipId, origTrackId, origStart),
                                () => moveClip(dragClipId, newTrackId, newStart)
                            );
                        }
                    }
                } else if (dragMode === 'trim-start' && primaryPos) {
                    trimClipStart(dragClipId, primaryPos.startBeat);
                    if (primaryOrig && primaryPos.startBeat !== primaryOrig.startBeat) {
                        const newStart = primaryPos.startBeat;
                        pushUndoEntry(
                            'Trim clip start',
                            () => trimClipStart(dragClipId, origStart),
                            () => trimClipStart(dragClipId, newStart)
                        );
                    }
                } else if (dragMode === 'stretch' && primaryPos) {
                    trimClipEnd(dragClipId, primaryPos.endBeat);
                    if (primaryOrig && primaryPos.endBeat !== primaryOrig.endBeat) {
                        const newEnd = primaryPos.endBeat;
                        pushUndoEntry(
                            'Trim clip end',
                            () => trimClipEnd(dragClipId, origEnd),
                            () => trimClipEnd(dragClipId, newEnd)
                        );
                    }
                }
            }

            setDragState(null);
            if (canvasRef.current) {
                canvasRef.current.style.cursor = '';
            }
        }
    };

    // ── Double Click ──────────────────────────────────────────────────────────

    const handleDoubleClick = (e: MouseEvent<HTMLCanvasElement>) => {
        const { x, y } = getCanvasCoords(e);
        const hit = hitTestClip(x, y);
        if (hit) {
            selectTrack(hit.trackId);
            selectClip(hit.clipId);
            setWorkspaceMode('clip');
        }
    };

    // ── Context Menu ──────────────────────────────────────────────────────────

    const handleContextMenu = (e: MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const { x, y } = getCanvasCoords(e);
        const hit = hitTestClip(x, y);
        if (hit) {
            selectTrack(hit.trackId);
            selectClip(hit.clipId);
            setContextMenu({
                kind: 'clip',
                x: e.clientX,
                y: e.clientY,
                clipId: hit.clipId,
                trackId: hit.trackId,
                splitBeat: getBeatFromX(x),
            });
        } else {
            setContextMenu({
                kind: 'empty',
                x: e.clientX,
                y: e.clientY,
                trackId: hitTestTrack(y),
                beat: Math.floor(getBeatFromX(x)),
            });
        }
    };

    // ── Pointer (pinch-zoom) ──────────────────────────────────────────────────

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.set(e.pointerId, e.nativeEvent);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (pointersRef.current.size === 2) {
            const prev = pointersRef.current.get(e.pointerId);
            pointersRef.current.set(e.pointerId, e.nativeEvent);
            if (!prev) {
                return;
            }
            const [p1, p2] = [...pointersRef.current.values()];
            if (!p1 || !p2) {
                return;
            }
            const prevOther = [...pointersRef.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
            if (!prevOther) {
                return;
            }
            const prevDist = Math.hypot(prev.clientX - prevOther.clientX, prev.clientY - prevOther.clientY);
            const currDist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
            const delta = currDist - prevDist;
            if (Math.abs(delta) > 1) {
                zoomTimeline(delta > 0 ? 2 : -2);
            }
        } else {
            pointersRef.current.set(e.pointerId, e.nativeEvent);
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.delete(e.pointerId);
    };

    // ── Cursor ────────────────────────────────────────────────────────────────

    const getCursor = (): string => {
        if (hoverCursor) {
            return hoverCursor;
        }
        switch (getActiveTool()) {
            case 'cut':
                return 'crosshair';
            case 'draw':
                return 'cell';
            case 'automation':
                return 'crosshair';
            case 'stretch':
                return 'ew-resize';
            default:
                return 'default';
        }
    };

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
