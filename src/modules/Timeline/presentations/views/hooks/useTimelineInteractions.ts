import {
    type MouseEvent as ReactMouseEvent,
    type DragEvent as ReactDragEvent,
    useRef,
    useState,
    useCallback,
    useEffect,
} from 'react';
import {
    zoomTimeline,
    scrollTimeline,
    setAutoScroll,
    setScrollY,
    timelineViewStore,
} from '../../../stores/timelineViewStore';
import {
    setPlayheadFromClick,
    beginClipDrag,
    commitClipDrag,
    hitTestClip,
    hitTestTrack,
    hitTestClipEdge,
    snapToGrid,
    snapToGridOrClips,
    getTrackAtY,
    type DragState,
    hitTestAutomationSubLane,
} from '../../../useCases/timelineInteractions';
import {
    selectTrack,
    setWorkspaceMode,
    splitClip,
    trimClipStart,
    trimClipEnd,
    addClip,
    removeClip,
    moveClipPreview,
    moveClip,
    decodeAudioFile,
    importMidiFile,
    addTrack,
    addDevice,
    addAutomationPoint,
    addAutomationLane,
    removeAutomationPoint,
    batchAddAutomationPoints,
    pushUndoEntry,
    setLoopRegion,
} from '../../../useCases/timelineViewActions';
import { type AutomationPoint } from '#/modules/Track/useCases/trackQueries';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { buildTimelineRenderModel } from '../../../useCases/buildTimelineRenderModel';

interface GestureEvent extends UIEvent {
    readonly scale: number;
    readonly rotation: number;
}

const RULER_HEIGHT = 0;

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
    const [isDragOver, setIsDragOver] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        let lastScale = 1;
        const onGestureStart = (e: Event) => {
            e.preventDefault();
            lastScale = 1;
        };
        const onGestureChange = (e: Event) => {
            e.preventDefault();
            const ge = e as GestureEvent;
            const delta = ge.scale - lastScale;
            lastScale = ge.scale;
            zoomTimeline(delta * 2);
        };
        const onGestureEnd = (e: Event) => e.preventDefault();

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const isPinch = Math.abs(e.deltaY) < 10;
                const zoomFactor = isPinch ? -e.deltaY * 0.02 : -e.deltaY * 0.005;
                zoomTimeline(zoomFactor);
            } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                scrollTimeline(e.deltaX || e.deltaY);
                const transport = transportStore.value;
                if (transport?.isPlaying) {
                    setAutoScroll(false);
                }
            } else {
                const currentY = timelineViewStore.value?.scrollY ?? 0;
                const trackState = trackStore.value;
                const canvas = canvasRef.current;
                const totalTrackH = (trackState?.tracks ?? []).reduce((s, t) => s + (t.height ?? 64), 0);
                const viewH = canvas ? canvas.clientHeight : 600;
                const maxY = Math.max(0, totalTrackH - viewH);
                setScrollY(Math.min(maxY, Math.max(0, currentY + e.deltaY)));
            }
        };

        canvas.addEventListener('gesturestart', onGestureStart, { passive: false });
        canvas.addEventListener('gesturechange', onGestureChange, { passive: false });
        canvas.addEventListener('gestureend', onGestureEnd, { passive: false });
        canvas.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            canvas.removeEventListener('gesturestart', onGestureStart);
            canvas.removeEventListener('gesturechange', onGestureChange);
            canvas.removeEventListener('gestureend', onGestureEnd);
            canvas.removeEventListener('wheel', onWheel);
        };
    }, [canvasRef]);

    const getCanvasCoords = useCallback(
        (e: ReactMouseEvent<HTMLCanvasElement> | ReactDragEvent<HTMLDivElement>): { x: number; y: number } => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) {
                return { x: 0, y: 0 };
            }
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        },
        [canvasRef]
    );

    const getBeatFromX = useCallback((x: number): number => {
        const viewState = timelineViewStore.value;
        if (!viewState) {
            return 0;
        }
        return x / viewState.pixelsPerBeat + viewState.scrollX / viewState.pixelsPerBeat;
    }, []);

    const getActiveTool = () => workspaceStore.value?.activeTool ?? 'select';

    const handleMouseDown = useCallback(
        (e: ReactMouseEvent<HTMLCanvasElement>) => {
            if (e.button !== 0) {
                return;
            }
            const { x, y } = getCanvasCoords(e);
            const tool = getActiveTool();

            // Check sub-lane click when automation is visible (any tool)
            const wsState = workspaceStore.value;
            if (wsState && wsState.automationVisibility !== 'hidden') {
                const subLaneHit = hitTestAutomationSubLane(x, y);
                if (subLaneHit) {
                    const point: AutomationPoint = {
                        beat: subLaneHit.beat,
                        value: subLaneHit.value,
                        curve: 'linear',
                        tension: 0,
                    };
                    addAutomationPoint(subLaneHit.laneId, point);
                    autoDragRef.current = { laneId: subLaneHit.laneId, trackId: subLaneHit.trackId, points: [point] };
                    selectTrack(subLaneHit.trackId);
                    return;
                }
            }

            if (tool === 'cut') {
                const hit = hitTestClip(x, y);
                if (hit) {
                    const beat = getBeatFromX(x);
                    const state = trackStore.value;
                    const origClip = state?.tracks.flatMap((t) => t.clips).find((c) => c.id === hit.clipId);
                    if (origClip) {
                        const savedClip = { ...origClip };
                        splitClip(hit.clipId, beat);
                        const afterState = trackStore.value;
                        const newClips =
                            afterState?.tracks
                                .flatMap((t) => t.clips)
                                .filter(
                                    (c) =>
                                        c.id !== hit.clipId &&
                                        (c.startBeat === savedClip.startBeat || c.startBeat === beat) &&
                                        c.endBeat <= savedClip.endBeat &&
                                        c.startBeat >= savedClip.startBeat
                                ) ?? [];
                        const newClipIds = newClips.map((c) => c.id);
                        pushUndoEntry(
                            'Split clip',
                            () => {
                                for (const id of newClipIds) {
                                    removeClip(id);
                                }
                                addClip({
                                    trackId: savedClip.trackId,
                                    startBeat: savedClip.startBeat,
                                    endBeat: savedClip.endBeat,
                                    name: savedClip.name,
                                    type: savedClip.type,
                                    audioBufferId: savedClip.audioBufferId,
                                });
                            },
                            () => splitClip(hit.clipId, beat)
                        );
                    }
                }
                return;
            }

            if (tool === 'draw') {
                const trackId = hitTestTrack(y);
                if (trackId) {
                    const beat = getBeatFromX(x);
                    const track = trackStore.value?.tracks.find((t) => t.id === trackId);
                    const clipType = track?.kind === 'midi' ? 'midi' : 'audio';
                    drawDragRef.current = {
                        trackId,
                        startBeat: Math.floor(beat),
                        clipType,
                    };
                    selectTrack(trackId);
                }
                return;
            }

            if (tool === 'automation') {
                // Check sub-lane first
                const subLaneHit = hitTestAutomationSubLane(x, y);
                if (subLaneHit) {
                    const point: AutomationPoint = {
                        beat: subLaneHit.beat,
                        value: subLaneHit.value,
                        curve: 'linear',
                        tension: 0,
                    };
                    addAutomationPoint(subLaneHit.laneId, point);
                    autoDragRef.current = { laneId: subLaneHit.laneId, trackId: subLaneHit.trackId, points: [point] };
                    selectTrack(subLaneHit.trackId);
                    return;
                }

                const trackId = hitTestTrack(y);
                if (trackId) {
                    const beat = getBeatFromX(x);
                    const contentY = y - RULER_HEIGHT + (timelineViewStore.value?.scrollY ?? 0);
                    const tracks = trackStore.value?.tracks ?? [];
                    const trackHit = getTrackAtY(tracks, contentY);
                    const trackHeight = trackHit ? (tracks[trackHit.index]?.height ?? 64) : 64;
                    const trackOffset = trackHit
                        ? tracks.slice(0, trackHit.index).reduce((sum, t) => sum + (t.height ?? 64), 0)
                        : 0;
                    const trackLocalY = contentY - trackOffset;
                    const value = Math.max(0, Math.min(1, 1 - trackLocalY / trackHeight));

                    const autoState = automationStore.value;
                    let lane = autoState?.lanes.find((l) => l.trackId === trackId && l.parameterId === 'gain');
                    if (!lane) {
                        addAutomationLane(trackId, 'gain', 'Gain');
                        lane = automationStore.value?.lanes.find(
                            (l) => l.trackId === trackId && l.parameterId === 'gain'
                        );
                    }
                    if (lane) {
                        const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
                        addAutomationPoint(lane.id, point);
                        autoDragRef.current = { laneId: lane.id, trackId, points: [point] };
                    }
                    selectTrack(trackId);
                }
                return;
            }

            const clipHit = hitTestClip(x, y);
            if (clipHit) {
                selectTrack(clipHit.trackId);
                const ws = workspaceStore.value;
                if (ws) {
                    if (e.shiftKey || e.metaKey) {
                        const ids = new Set(ws.selectedClipIds);
                        if (ids.has(clipHit.clipId)) {
                            ids.delete(clipHit.clipId);
                        } else {
                            ids.add(clipHit.clipId);
                        }
                        workspaceStore.set({ ...ws, selectedClipId: clipHit.clipId, selectedClipIds: [...ids] });
                    } else {
                        workspaceStore.set({
                            ...ws,
                            selectedClipId: clipHit.clipId,
                            selectedClipIds: [clipHit.clipId],
                        });
                    }
                }
            }

            const edgeHit = hitTestClipEdge(x, y);
            let dragMode: 'move' | 'stretch' | 'trim-start' = tool === 'stretch' ? 'stretch' : 'move';
            if (edgeHit && tool === 'select') {
                if (edgeHit.edge === 'left') {
                    dragMode = 'trim-start';
                } else if (edgeHit.edge === 'right') {
                    dragMode = 'stretch';
                }
            }

            const drag = beginClipDrag(x, y, dragMode);
            if (drag) {
                setDragState(drag);
                return;
            }

            if (!clipHit) {
                const trackId = hitTestTrack(y);
                selectTrack(trackId);
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipId: null, selectedClipIds: [] });
                }
                rubberBandRef.current = { startX: x, startY: y };
                setPlayheadFromClick(x);
                return;
            }
        },
        [getCanvasCoords, getBeatFromX]
    );

    const handleMouseMove = useCallback(
        (e: ReactMouseEvent<HTMLCanvasElement>) => {
            if (
                !dragState &&
                !loopDragRef.current &&
                !autoDragRef.current &&
                !drawDragRef.current &&
                !rubberBandRef.current
            ) {
                const tool = getActiveTool();
                if (tool === 'select') {
                    const { x, y } = getCanvasCoords(e);
                    const edgeHit = hitTestClipEdge(x, y);
                    if (edgeHit && (edgeHit.edge === 'left' || edgeHit.edge === 'right')) {
                        setHoverCursor('ew-resize');
                    } else {
                        setHoverCursor(null);
                    }
                } else {
                    setHoverCursor(null);
                }
            }

            if (loopDragRef.current) {
                const { x } = getCanvasCoords(e);
                const currentBeat = getBeatFromX(x);
                const startBeat = loopDragRef.current.startBeat;
                const Math_min = Math.min;
                const Math_max = Math.max;
                const loopStart = Math_min(startBeat, currentBeat);
                const loopEnd = Math_max(startBeat, currentBeat);
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
                const { x, y } = getCanvasCoords(e);
                const beat = getBeatFromX(x);
                const contentY = y - RULER_HEIGHT + (timelineViewStore.value?.scrollY ?? 0);
                const tracks = trackStore.value?.tracks ?? [];
                const trackHit = getTrackAtY(tracks, contentY);
                const trackHeight = trackHit ? (tracks[trackHit.index]?.height ?? 64) : 64;
                const trackOffset = trackHit
                    ? tracks.slice(0, trackHit.index).reduce((sum, t) => sum + (t.height ?? 64), 0)
                    : 0;
                const trackLocalY = contentY - trackOffset;
                const value = Math.max(0, Math.min(1, 1 - trackLocalY / trackHeight));

                const lastPoint = autoDragRef.current.points[autoDragRef.current.points.length - 1];
                if (!lastPoint || Math.abs(beat - lastPoint.beat) >= 0.1) {
                    const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
                    autoDragRef.current.points.push(point);
                    addAutomationPoint(autoDragRef.current.laneId, point);
                }
                return;
            }

            if (drawDragRef.current) {
                return;
            }

            if (rubberBandRef.current) {
                const { x: mx, y: my } = getCanvasCoords(e);
                const dx = Math.abs(mx - rubberBandRef.current.startX);
                const dy = Math.abs(my - rubberBandRef.current.startY);
                if (dx > 4 || dy > 4) {
                    setRubberBand({
                        startX: rubberBandRef.current.startX,
                        startY: rubberBandRef.current.startY,
                        endX: mx,
                        endY: my,
                    });
                }
                return;
            }

            if (!dragState) {
                return;
            }
            const canvas = canvasRef.current;
            if (canvas) {
                canvas.style.cursor = 'grabbing';
            }
            const { x: mx, y: my } = getCanvasCoords(e);
            const viewState = timelineViewStore.value;
            if (!viewState) {
                return;
            }

            const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
            const rawBeat = mx / viewState.pixelsPerBeat + viewportStartBeat;

            if (dragState.mode === 'trim-start') {
                const snappedBeat = Math.min(dragState.endBeat - 0.25, snapToGrid(rawBeat));
                trimClipStart(dragState.clipId, Math.max(0, snappedBeat));
                return;
            }

            if (dragState.mode === 'stretch') {
                const snappedBeat = Math.max(dragState.startBeat + 0.25, snapToGrid(rawBeat));
                trimClipEnd(dragState.clipId, snappedBeat);
                return;
            }

            const contentY = my - RULER_HEIGHT + (timelineViewStore.value?.scrollY ?? 0);
            const tracks = trackStore.value?.tracks;
            if (!tracks) {
                return;
            }
            const trackHit = getTrackAtY(tracks, Math.max(0, contentY));
            const targetTrack = trackHit ? tracks[trackHit.index] : null;
            const snapTrackId = targetTrack?.id ?? dragState.sourceTrackId;
            const snappedBeat = Math.max(
                0,
                snapToGridOrClips(rawBeat - dragState.offsetBeat, snapTrackId, dragState.clipId)
            );
            if (targetTrack) {
                const ws = workspaceStore.value;
                const selectedIds = ws?.selectedClipIds ?? [];
                if (selectedIds.length > 1 && selectedIds.includes(dragState.clipId)) {
                    const state = trackStore.value;
                    if (state) {
                        const primaryClip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === dragState.clipId);
                        if (primaryClip) {
                            const beatDelta = snappedBeat - primaryClip.startBeat;
                            for (const id of selectedIds) {
                                const clip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
                                if (clip) {
                                    moveClipPreview(
                                        id,
                                        targetTrack.id,
                                        Math.max(0, snapToGridOrClips(clip.startBeat + beatDelta, targetTrack.id, id))
                                    );
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

    const handleMouseUp = useCallback(
        (e: ReactMouseEvent<HTMLCanvasElement>) => {
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
                const startBeat = drawDragRef.current.startBeat;
                const s = Math.min(startBeat, endBeat);
                const en = Math.max(startBeat, endBeat);
                const length = Math.max(1, en - s);
                const drawTrackId = drawDragRef.current.trackId;
                const drawClipType = drawDragRef.current.clipType;
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
                const model = buildTimelineRenderModel();
                const viewState = timelineViewStore.value;
                if (viewState && model) {
                    const left = Math.min(rubberBand.startX, rubberBand.endX);
                    const right = Math.max(rubberBand.startX, rubberBand.endX);
                    const sY = viewState.scrollY ?? 0;
                    const top = Math.min(rubberBand.startY, rubberBand.endY) - RULER_HEIGHT + sY;
                    const bottom = Math.max(rubberBand.startY, rubberBand.endY) - RULER_HEIGHT + sY;

                    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
                    const leftBeat = left / viewState.pixelsPerBeat + viewportStartBeat;
                    const rightBeat = right / viewState.pixelsPerBeat + viewportStartBeat;

                    const hitIds: string[] = [];
                    let trackYOffset = 0;

                    for (let ti = 0; ti < model.tracks.length; ti++) {
                        const perTrackHeight = model.tracks[ti]!.height;
                        const trackTop = trackYOffset;
                        const trackBottom = trackYOffset + perTrackHeight;
                        trackYOffset += perTrackHeight;
                        if (trackBottom < top || trackTop > bottom) {
                            continue;
                        }
                        for (const clip of model.tracks[ti]!.clips) {
                            if (clip.endBeat > leftBeat && clip.startBeat < rightBeat) {
                                hitIds.push(clip.id);
                            }
                        }
                    }

                    const ws = workspaceStore.value;
                    if (ws) {
                        workspaceStore.set({
                            ...ws,
                            selectedClipId: hitIds[0] ?? null,
                            selectedClipIds: hitIds,
                        });
                    }
                }
                rubberBandRef.current = null;
                setRubberBand(null);
                return;
            }
            rubberBandRef.current = null;
            setRubberBand(null);

            if (dragState) {
                const { x, y } = getCanvasCoords(e);
                const origStart = dragState.startBeat;
                const origEnd = dragState.endBeat;
                const origTrackId = dragState.sourceTrackId;
                const dragClipId = dragState.clipId;
                const dragMode = dragState.mode;

                commitClipDrag(dragState, x, y);

                const afterClip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === dragClipId);
                if (afterClip) {
                    const newStart = afterClip.startBeat;
                    const newEnd = afterClip.endBeat;
                    const newTrackId = afterClip.trackId;
                    const changed = newStart !== origStart || newEnd !== origEnd || newTrackId !== origTrackId;

                    if (changed) {
                        if (dragMode === 'move') {
                            pushUndoEntry(
                                'Move clip',
                                () => moveClip(dragClipId, origTrackId, origStart),
                                () => moveClip(dragClipId, newTrackId, newStart)
                            );
                        } else if (dragMode === 'trim-start') {
                            pushUndoEntry(
                                'Trim clip start',
                                () => trimClipStart(dragClipId, origStart),
                                () => trimClipStart(dragClipId, newStart)
                            );
                        } else if (dragMode === 'stretch') {
                            pushUndoEntry(
                                'Trim clip end',
                                () => trimClipEnd(dragClipId, origEnd),
                                () => trimClipEnd(dragClipId, newEnd)
                            );
                        }
                    }
                }

                setDragState(null);
                const canvas = canvasRef.current;
                if (canvas) {
                    canvas.style.cursor = '';
                }
            }
        },
        [dragState, rubberBand, getCanvasCoords, getBeatFromX, canvasRef]
    );

    const handleDoubleClick = useCallback(
        (e: ReactMouseEvent<HTMLCanvasElement>) => {
            const { x, y } = getCanvasCoords(e);
            if (y < RULER_HEIGHT) {
                return;
            }
            const hit = hitTestClip(x, y);
            if (hit) {
                selectTrack(hit.trackId);
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipId: hit.clipId });
                }
                setWorkspaceMode('clip');
            }
        },
        [getCanvasCoords]
    );

    const handleContextMenu = useCallback(
        (e: ReactMouseEvent<HTMLCanvasElement>) => {
            e.preventDefault();
            const { x, y } = getCanvasCoords(e);
            if (y < RULER_HEIGHT) {
                return;
            }

            const hit = hitTestClip(x, y);
            if (hit) {
                selectTrack(hit.trackId);
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipId: hit.clipId });
                }
                setContextMenu({
                    kind: 'clip',
                    x: e.clientX,
                    y: e.clientY,
                    clipId: hit.clipId,
                    trackId: hit.trackId,
                    splitBeat: getBeatFromX(x),
                });
            } else {
                const trackId = hitTestTrack(y);
                setContextMenu({
                    kind: 'empty',
                    x: e.clientX,
                    y: e.clientY,
                    trackId,
                    beat: Math.floor(getBeatFromX(x)),
                });
            }
        },
        [getCanvasCoords, getBeatFromX]
    );

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.set(e.pointerId, e.nativeEvent);
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
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
    }, []);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.delete(e.pointerId);
    }, []);

    const handleFileDrop = useCallback(
        async (e: ReactDragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setIsDragOver(false);

            const { x, y } = getCanvasCoords(e);
            const trackHit = hitTestTrack(y);
            const beat = Math.max(0, Math.floor(getBeatFromX(x)));

            const sampleData = e.dataTransfer.getData('application/x-webdaw-sample');
            if (sampleData) {
                try {
                    const sample = JSON.parse(sampleData) as {
                        name: string;
                        id: string;
                        duration: string;
                        durationSeconds?: number;
                        audioBufferId?: string;
                    };
                    let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                    const sampleTargetTrack = targetTrackId
                        ? trackStore.value?.tracks.find((t) => t.id === targetTrackId)
                        : null;
                    if (!targetTrackId || !sampleTargetTrack || sampleTargetTrack.kind !== 'audio') {
                        const newTrack = addTrack({ name: sample.name, kind: 'audio' });
                        if (!newTrack) {
                            return;
                        }
                        targetTrackId = newTrack.id;
                    }
                    const durationBeats = sample.durationSeconds
                        ? Math.max(1, Math.ceil(sample.durationSeconds * 2))
                        : sample.duration.includes('bar')
                          ? parseInt(sample.duration) * 4
                          : 4;
                    addClip({
                        trackId: targetTrackId,
                        startBeat: beat,
                        endBeat: beat + durationBeats,
                        name: sample.name,
                        type: 'audio',
                        audioBufferId: sample.audioBufferId,
                    });
                } catch {
                    /* ignored */
                }
                return;
            }

            const pluginData = e.dataTransfer.getData('application/x-webdaw-plugin');
            if (pluginData) {
                try {
                    const plugin = JSON.parse(pluginData) as { name: string; id: string };
                    const targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                    if (targetTrackId) {
                        addDevice(targetTrackId, plugin.name);
                    }
                } catch {
                    /* ignored */
                }
                return;
            }

            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0) {
                return;
            }

            setIsImporting(true);
            let currentBeat = beat;
            try {
                for (const file of files) {
                    const isMidiFile =
                        file.type === 'audio/midi' ||
                        file.type === 'audio/x-midi' ||
                        ['mid', 'midi'].includes(file.name.toLowerCase().split('.').pop() ?? '');
                    const isAudioFile =
                        file.type.startsWith('audio/') ||
                        ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'aiff', 'aif'].includes(
                            file.name.toLowerCase().split('.').pop() ?? ''
                        );

                    if (isMidiFile) {
                        await importMidiFile(file);
                        continue;
                    }

                    if (!isAudioFile) {
                        continue;
                    }
                    try {
                        const { id: bufferId, buffer } = await decodeAudioFile(file);
                        const model = buildTimelineRenderModel();
                        const durationBeats = Math.max(4, Math.ceil((buffer.duration / 60) * model.tempo));

                        let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                        const targetTrack = targetTrackId
                            ? trackStore.value?.tracks.find((t) => t.id === targetTrackId)
                            : null;
                        if (!targetTrackId || !targetTrack || targetTrack.kind !== 'audio') {
                            const newTrack = addTrack({ name: file.name.replace(/\.[^.]+$/, ''), kind: 'audio' });
                            if (!newTrack) {
                                return;
                            }
                            targetTrackId = newTrack.id;
                        }

                        addClip({
                            trackId: targetTrackId,
                            startBeat: currentBeat,
                            endBeat: currentBeat + durationBeats,
                            name: file.name.replace(/\.[^.]+$/, ''),
                            type: 'audio',
                            audioBufferId: bufferId,
                        });

                        currentBeat += durationBeats;
                    } catch {
                        document.dispatchEvent(
                            new CustomEvent('webdaw:notify', {
                                detail: {
                                    message: `Failed to import "${file.name}" — unsupported format or corrupt file`,
                                    level: 'error',
                                },
                            })
                        );
                    }
                }
            } finally {
                setIsImporting(false);
            }
        },
        [getCanvasCoords, getBeatFromX]
    );

    const getCursor = useCallback((): string => {
        if (hoverCursor) {
            return hoverCursor;
        }
        const tool = getActiveTool();
        switch (tool) {
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
