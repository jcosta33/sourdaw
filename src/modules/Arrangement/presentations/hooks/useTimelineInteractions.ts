import { type MouseEvent, type DragEvent, useRef, useState } from 'react';
import { broadcastPresence } from '#/modules/Collaboration/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { timelineViewStore, zoomTimeline } from '../../stores/timelineViewStore';
import { useTimelineGestures } from './useTimelineGestures';
import { useTimelineFileDrop } from './useTimelineFileDrop';
import { setPlayheadFromClick } from '../../useCases/timelineInteractions/setPlayheadFromClick';
import { beginClipDrag, type DragState } from '../../useCases/timelineInteractions/beginClipDrag';
import { clipDragPreviewRef, type ClipPreviewPosition } from '../../stores/clipDragPreviewRef';
import { hitTestClip } from '../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { hitTestTrack } from '../../useCases/timelineInteractions/hitTestClip/hitTestTrack';
import { hitTestClipEdge } from '../../useCases/timelineInteractions/hitTestClipEdge';
import { snapToGrid } from '../../useCases/timelineInteractions/snapToGrid';
import { snapToGridOrClips } from '../../useCases/timelineInteractions/snapToGridOrClips';
import { snapToZeroCrossing } from '../../useCases/timelineInteractions/snapToZeroCrossing';
import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { workspaceStore, preferencesStore } from '#/modules/Workspace/stores';
import {
    toggleClipInSelection,
    selectClipWithFocus,
    clearClipSelection,
    setClipSelection,
    selectClip,
    setWorkspaceMode,
    setMarqueeSelection,
} from '#/modules/Workspace/useCases';
import { trackStore } from '../../stores/trackStore';
import { midiStore } from '#/modules/MIDI/stores';
import { toggleLoop, getTransportState, setLoopRegion } from '#/modules/Transport/useCases';
import { removeAutomationPoint, batchAddAutomationPoints } from '#/modules/Automation/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { addClip } from '../../useCases/clip/addClip';
import { removeClip } from '../../useCases/clip/removeClip';
import { moveClip } from '../../useCases/clip/moveClip';
import { moveMidiNote } from '#/modules/MIDI/useCases';
import { duplicateClipCore } from '../../useCases/clip/duplicateClipCore';
import { getWorkspaceState } from '#/modules/Workspace/useCases';
import { planRippleInsert } from '../../useCases/rippleInsert/planRippleInsert';
import { rippleInsertClip, undoRippleInsertClip } from '../../useCases/rippleInsert/rippleInsertClip';
import { planRippleMove } from '../../useCases/rippleMove/planRippleMove';
import { rippleMoveClip } from '../../useCases/rippleMove/rippleMoveClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackState } from '../../useCases/setTrackState';
import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';
import { slipClipContent } from '../../useCases/clipEditing/slipClipContent';
import { toggleInlineEditing } from '../../useCases/clipEditing/toggleInlineEditing';
import { acceptGhostClip } from '../../useCases/clip/acceptGhostClip';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { getTrackAtY as getTrackAtYHelper } from '../../useCases/timelineInteractions/getTrackAtY';
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
    const slipDragRef = useRef<{
        clipId: string;
        clipType: 'audio' | 'midi';
        startX: number;
        originalOffset: number;
    } | null>(null);
    const noteDragRef = useRef<{
        clipId: string;
        noteId: string;
        originalStartBeat: number;
        originalPitch: number;
        dragStartBeat: number;
        dragStartY: number;
        noteHeight: number;
        trackId: string;
    } | null>(null);
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

        // ── Ctrl/Cmd+Shift+drag: slip edit clip content (A10) ──
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
            const slipHit = hitTestClip(x, y);
            if (slipHit) {
                const state = trackStore.value;
                const track = state?.tracks.find((t) => t.id === slipHit.trackId);
                const clip = track?.clips.find((c) => c.id === slipHit.clipId);
                if (clip) {
                    slipDragRef.current = {
                        clipId: clip.id,
                        clipType: clip.type,
                        startX: x,
                        originalOffset:
                            clip.type === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0),
                    };
                    return;
                }
            }
        }

        // ── Select tool: clip hit → select + maybe begin drag ──
        const clipHit = hitTestClip(x, y);
        if (clipHit) {
            // R-A11: If hitting a note in an inline clip, start note drag instead of clip drag
            if (clipHit.noteId) {
                const notes = midiStore.value?.notesByClipId[clipHit.clipId] ?? [];
                const note = notes.find((n) => n.id === clipHit.noteId);
                if (note) {
                    noteDragRef.current = {
                        clipId: clipHit.clipId,
                        noteId: clipHit.noteId,
                        originalStartBeat: note.startBeat,
                        originalPitch: note.pitch,
                        dragStartBeat: beat,
                        dragStartY: y,
                        noteHeight: clipHit.noteHeight ?? 20,
                        trackId: clipHit.trackId,
                    };
                    return;
                }
            }

            // Ghost clip click: accept it immediately (R-E1.2)
            const state = trackStore.value;
            const clipForHit = state?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipHit.clipId);
            if (clipForHit?.isGhost) {
                acceptGhostClip(clipHit.clipId);
                return;
            }
            selectTrack(clipHit.trackId);
            if (e.shiftKey || e.metaKey) {
                toggleClipInSelection(clipHit.clipId);
            } else {
                selectClipWithFocus(clipHit.clipId);
            }
        }

        const edgeHit = hitTestClipEdge(x, y);
        let dragMode: 'move' | 'duplicate' | 'stretch' | 'trim-start' = tool === 'stretch' ? 'stretch' : 'move';
        if (edgeHit && edgeHit.edge !== 'body' && tool === 'select') {
            dragMode = edgeHit.edge === 'left' ? 'trim-start' : 'stretch';
        }
        // Alt+drag on a clip: duplicate instead of move (R-B1)
        if (e.altKey && clipHit && dragMode === 'move') {
            dragMode = 'duplicate';
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

        if (noteDragRef.current) {
            const drag = noteDragRef.current;
            const deltaBeat = getBeatFromX(x) - drag.dragStartBeat;
            const deltaPitch = Math.round((drag.dragStartY - y) / drag.noteHeight);
            
            const newStartBeat = snapToGrid(drag.originalStartBeat + deltaBeat);
            const newPitch = Math.max(0, Math.min(127, drag.originalPitch + deltaPitch));
            
            moveMidiNote(drag.clipId, drag.noteId, newPitch, newStartBeat);
            return;
        }

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

        if (slipDragRef.current) {
            const { clipId, clipType, startX, originalOffset } = slipDragRef.current;
            const view = timelineViewStore.value;
            if (view) {
                const deltaBeats = (x - startX) / view.pixelsPerBeat;
                const newOffset = originalOffset + deltaBeats;
                
                // Update ephemeral preview
                if (!clipDragPreviewRef.current) {
                    const state = trackStore.value;
                    const track = state?.tracks.find(t => t.clips.some(c => c.id === clipId));
                    const clip = track?.clips.find(c => c.id === clipId);
                    if (track && clip) {
                        const pos = {
                            trackId: track.id,
                            startBeat: clip.startBeat,
                            endBeat: clip.endBeat,
                            audioOffsetBeats: clip.audioOffsetBeats,
                            midiOffsetBeats: clip.midiOffsetBeats,
                        };
                        clipDragPreviewRef.current = {
                            positions: new Map([[clipId, { ...pos }]]),
                            originals: new Map([[clipId, { ...pos }]]),
                        };
                    }
                }
                
                const preview = clipDragPreviewRef.current;
                if (preview) {
                    const current = preview.positions.get(clipId);
                    if (current) {
                        preview.positions.set(clipId, {
                            ...current,
                            audioOffsetBeats: clipType === 'audio' ? newOffset : current.audioOffsetBeats,
                            midiOffsetBeats: clipType === 'midi' ? newOffset : current.midiOffsetBeats,
                        });
                    }
                }
            }
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
            let newEnd = Math.max(dragState.startBeat + 0.25, snapToGrid(rawBeat));

            if (preferencesStore.value?.snapToZeroCrossing) {
                const state = trackStore.value;
                const clip = state?.tracks.flatMap(t => t.clips).find(c => c.id === dragState.clipId);
                if (clip && clip.type === 'audio') {
                    newEnd = snapToZeroCrossing(clip, newEnd);
                }
            }

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
        noteDragRef.current = null;
        if (slipDragRef.current) {
            const { clipId, clipType, startX, originalOffset } = slipDragRef.current;
            slipDragRef.current = null;
            clipDragPreviewRef.current = null;
            const { x } = getCanvasCoords(e);
            const view = timelineViewStore.value;
            if (view) {
                const deltaBeats = (x - startX) / view.pixelsPerBeat;
                if (Math.abs(deltaBeats) > 0.001) {
                    const newOffset = originalOffset + deltaBeats;
                    slipClipContent(clipId, clipType, newOffset);
                    pushUndoEntry(
                        'Slip clip content',
                        () => slipClipContent(clipId, clipType, originalOffset),
                        () => slipClipContent(clipId, clipType, newOffset)
                    );
                }
            }
            return;
        }

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

            const rippleEnabled = getWorkspaceState()?.rippleEditing ?? false;
            if (rippleEnabled) {
                // Ripple insert: compute plan BEFORE adding the clip so it doesn't include the new clip
                const ripplePlan = planRippleInsert({ trackId: drawTrackId, insertBeat: s, insertDuration: length });
                const clip = addClip({
                    trackId: drawTrackId,
                    startBeat: s,
                    endBeat: s + length,
                    name: `Clip ${s}`,
                    type: drawClipType,
                });
                if (clip) {
                    if (ripplePlan && ripplePlan.shiftedClips.length > 0) {
                        rippleInsertClip({ trackId: drawTrackId, insertDuration: length, plan: ripplePlan });
                        const clipId = clip.id;
                        const savedPlan = ripplePlan;
                        pushUndoEntry(
                            'Draw clip (ripple)',
                            () => {
                                removeClip(clipId);
                                undoRippleInsertClip({ trackId: drawTrackId, plan: savedPlan });
                            },
                            () => {
                                const redrawn = addClip({
                                    trackId: drawTrackId,
                                    startBeat: s,
                                    endBeat: s + length,
                                    name: `Clip ${s}`,
                                    type: drawClipType,
                                });
                                if (redrawn) {
                                    rippleInsertClip({ trackId: drawTrackId, insertDuration: length, plan: savedPlan });
                                }
                            }
                        );
                    } else {
                        const clipId = clip.id;
                        pushUndoEntry(
                            'Draw clip',
                            () => removeClip(clipId),
                            () => addClip({ trackId: drawTrackId, startBeat: s, endBeat: s + length, name: `Clip ${s}`, type: drawClipType })
                        );
                    }
                }
            } else {
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
                const hitTrackIds: string[] = [];
                let trackYOffset = 0;
                for (const track of model.tracks) {
                    const h = track.height;
                    if (!(trackYOffset + h < top || trackYOffset > bottom)) {
                        hitTrackIds.push(track.id);
                        for (const clip of track.clips) {
                            if (clip.endBeat > leftBeat && clip.startBeat < rightBeat) {
                                hitIds.push(clip.id);
                            }
                        }
                    }
                    trackYOffset += h;
                }
                
                if (getActiveTool() === 'marquee') {
                    setMarqueeSelection({ startBeat: leftBeat, endBeat: rightBeat, trackIds: hitTrackIds });
                } else {
                    setClipSelection(hitIds);
                    setMarqueeSelection(null);
                }
            }
            rubberBandRef.current = null;
            setRubberBand(null);
            return;
        }
        rubberBandRef.current = null;
        setRubberBand(null);

        // Clicking without dragging using the marquee tool or select tool should clear the marquee selection
        if (!dragState && getActiveTool() === 'marquee') {
            setMarqueeSelection(null);
        }

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

                if (dragMode === 'duplicate') {
                    // Alt+drag duplicate: originals stay, create copies at drop positions (R-B1)
                    const copiedIds: string[] = [];
                    for (const [clipId, pos] of preview.positions) {
                        duplicateClipCore(clipId, () => pos.startBeat);
                        // Track created clip for undo — duplicateClipCore adds to the track
                        const state = trackStore.value;
                        if (state) {
                            for (const t of state.tracks) {
                                if (t.id === pos.trackId) {
                                    const created = t.clips.at(-1);
                                    if (created && created.id !== clipId) {
                                        copiedIds.push(created.id);
                                    }
                                }
                            }
                        }
                    }
                    if (copiedIds.length > 0) {
                        pushUndoEntry(
                            `Duplicate ${copiedIds.length} clip${copiedIds.length > 1 ? 's' : ''}`,
                            () => {
                                for (const id of copiedIds) {
                                    removeClip(id);
                                }
                            },
                            () => {
                                // Redo: re-run duplication at saved positions
                                for (const [clipId, pos] of preview.positions) {
                                    duplicateClipCore(clipId, () => pos.startBeat);
                                }
                            }
                        );
                    }
                } else if (dragMode === 'move') {
                    const rippleEnabled = getWorkspaceState()?.rippleEditing ?? false;
                    let usedRipple = false;
                    let ripplePlan: ReturnType<typeof planRippleMove> = null;

                    for (const [clipId, pos] of preview.positions) {
                        const orig = preview.originals.get(clipId);
                        if (rippleEnabled && orig && orig.trackId === pos.trackId) {
                            const state = trackStore.value;
                            if (state) {
                                const track = state.tracks.find((t) => t.id === pos.trackId);
                                const clip = track?.clips.find((c) => c.id === clipId);
                                if (clip) {
                                    const duration = clip.endBeat - clip.startBeat;
                                    ripplePlan = planRippleMove({
                                        trackId: pos.trackId,
                                        clipId,
                                        oldStartBeat: orig.startBeat,
                                        newStartBeat: pos.startBeat,
                                        clipDuration: duration,
                                    });
                                    if (ripplePlan) {
                                        rippleMoveClip({
                                            trackId: pos.trackId,
                                            clipId,
                                            newStartBeat: pos.startBeat,
                                            clipDuration: duration,
                                            plan: ripplePlan,
                                        });
                                        usedRipple = true;
                                        continue;
                                    }
                                }
                            }
                        }
                        moveClip(clipId, pos.trackId, pos.startBeat, orig?.startBeat);
                    }

                    if (primaryPos && primaryOrig) {
                        const { trackId: newTrackId, startBeat: newStart } = primaryPos;
                        if (newStart !== primaryOrig.startBeat || newTrackId !== primaryOrig.trackId) {
                            if (usedRipple && ripplePlan) {
                                // Ripple move undo: restore clip and all shifted clips
                                const savedPlan = ripplePlan;
                                const savedDuration = origEnd - origStart;
                                pushUndoEntry(
                                    'Move clip (ripple)',
                                    () => {
                                        // Restore moved clip to original position
                                        moveClip(dragClipId, origTrackId, origStart);
                                        // Restore ripple-shifted clips to original positions
                                        const state2 = getTrackStoreState();
                                        if (state2) {
                                            const allShifted = [
                                                ...savedPlan.gapClosedClips,
                                                ...savedPlan.destinationOpenedClips,
                                            ];
                                            const shiftMap = new Map(allShifted.map((s) => [s.clipId, s]));
                                            const updatedTracks = state2.tracks.map((t) => {
                                                if (t.id !== origTrackId) return t;
                                                return {
                                                    ...t,
                                                    clips: t.clips.map((c) => {
                                                        const orig2 = shiftMap.get(c.id);
                                                        if (!orig2) return c;
                                                        return { ...c, startBeat: orig2.origStartBeat, endBeat: orig2.origEndBeat };
                                                    }),
                                                };
                                            });
                                            setTrackState({ ...state2, tracks: updatedTracks });
                                        }
                                    },
                                    () => {
                                        const state2 = trackStore.value;
                                        if (state2) {
                                            const track2 = state2.tracks.find((t) => t.id === newTrackId);
                                            const clip2 = track2?.clips.find((c) => c.id === dragClipId);
                                            const dur = clip2 ? clip2.endBeat - clip2.startBeat : savedDuration;
                                            const redoPlan = planRippleMove({
                                                trackId: newTrackId,
                                                clipId: dragClipId,
                                                oldStartBeat: origStart,
                                                newStartBeat: newStart,
                                                clipDuration: dur,
                                            });
                                            if (redoPlan) {
                                                rippleMoveClip({ trackId: newTrackId, clipId: dragClipId, newStartBeat: newStart, clipDuration: dur, plan: redoPlan });
                                            } else {
                                                moveClip(dragClipId, newTrackId, newStart);
                                            }
                                        }
                                    }
                                );
                            } else {
                                pushUndoEntry(
                                    'Move clip',
                                    () => moveClip(dragClipId, origTrackId, origStart),
                                    () => moveClip(dragClipId, newTrackId, newStart)
                                );
                            }
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
            const track = trackStore.value?.tracks.find((t) => t.id === hit.trackId);
            const clip = track?.clips.find((c) => c.id === hit.clipId);

            if (clip?.type === 'midi') {
                // R-A11: Toggle inline editing on double click
                toggleInlineEditing(hit.clipId);
            } else {
                // Fallback for audio: open full editor
                selectTrack(hit.trackId);
                selectClip(hit.clipId);
                setWorkspaceMode('clip');
            }
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
