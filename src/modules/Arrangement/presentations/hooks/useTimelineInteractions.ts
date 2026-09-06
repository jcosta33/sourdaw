import { type MouseEvent, type DragEvent, useEffect, useRef, useState } from 'react';

import { collaborationStore } from '#/modules/Collaboration/stores';
import { broadcastPresence } from '#/modules/Collaboration/useCases';
import { executeUserAppAction, generateGroupId } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { setWorkspaceMode } from '#/modules/WorkspaceShell/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { clipDragPreviewRef, previewDirtyFlag, type ClipPreviewPosition } from '../../stores/clipDragPreviewRef';
import { clipSelectionStore } from '../../stores/clipSelectionStore';
import { inlineMidiNotePreviewRef } from '../../stores/inlineMidiNotePreviewRef';
import { timelineViewStore, zoomTimeline } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { acceptGhostClip } from '../../useCases/clip/acceptGhostClip';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';
import { toggleInlineEditing } from '../../useCases/clipEditing/toggleInlineEditing';
import { clearClipSelection } from '../../useCases/clipSelection/clearClipSelection';
import { selectClip } from '../../useCases/clipSelection/selectClip';
import { selectClipWithFocus } from '../../useCases/clipSelection/selectClipWithFocus';
import { setClipSelection } from '../../useCases/clipSelection/setClipSelection';
import { setMarqueeSelection } from '../../useCases/clipSelection/setMarqueeSelection';
import { toggleClipInSelection } from '../../useCases/clipSelection/toggleClipInSelection';
import { beginClipDrag, type DragState } from '../../useCases/timelineInteractions/beginClipDrag';
import { clipDropRejectionReason } from '../../useCases/timelineInteractions/clipDropRejectionReason';
import { commitInlineAutomationPaint } from '../../useCases/timelineInteractions/commitInlineAutomationPaint';
import { commitInlineMidiNoteMove } from '../../useCases/timelineInteractions/commitInlineMidiNoteMove';
import { getTrackAtY as getTrackAtYHelper } from '../../useCases/timelineInteractions/getTrackAtY';
import { hitTestClip } from '../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { hitTestTrack } from '../../useCases/timelineInteractions/hitTestClip/hitTestTrack';
import { hitTestClipEdge } from '../../useCases/timelineInteractions/hitTestClipEdge';
import { isClipDropCompatible } from '../../useCases/timelineInteractions/isClipDropCompatible';
import { registerTimelineGestureCanceler } from '../../useCases/timelineInteractions/registerTimelineGestureCanceler';
import { setPlayheadFromClick } from '../../useCases/timelineInteractions/setPlayheadFromClick';
import { snapToGrid } from '../../useCases/timelineInteractions/snapToGrid';
import { snapToGridOrClips } from '../../useCases/timelineInteractions/snapToGridOrClips';
import { snapToZeroCrossing } from '../../useCases/timelineInteractions/snapToZeroCrossing';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { canvasXToBeat, getContentY } from '../helpers/timelineMouse';
import {
    handleCutTool,
    handleDrawTool,
    handleAutomationTool,
    tryPaintSubLane,
    paintAutoDragPoint,
} from '../helpers/timelineTools';

import { useTimelineFileDrop } from './useTimelineFileDrop';
import { useTimelineGestures } from './useTimelineGestures';

type ClipMenuState = { kind: 'clip'; x: number; y: number; clipId: string; trackId: string; splitBeat: number };
type EmptyMenuState = { kind: 'empty'; x: number; y: number; trackId: string | null; beat: number };
export type ContextMenuState = ClipMenuState | EmptyMenuState | null;

// Pixels-of-pinch-spread → pixels-per-beat conversion for two-finger pinch zoom.
// Kept in the same range as the Ctrl+wheel pinch step (see useTimelineGestures,
// -deltaY * 0.02) so touch and trackpad pinch feel consistent (findings #81/#17).
const PINCH_ZOOM_FACTOR = 0.02;

// A single-clip drag commits through the registered moveClip action (#3641):
// the handler performs the write and mints the undo entry, so admission
// refusals surface and session replay reaches the entry. Group gestures — the
// same mousedown test that seeded the preview — keep the callback commit even
// when locked or stale members leave exactly one previewed clip; multi-clip,
// ripple, draw, and duplicate-at-destination gestures dispatch their own
// registered actions (slice three). The write geometry is the callback loop's
// skip rule verbatim: a release in place commits nothing.
const commitSingleClipMove = (
    preview: { positions: Map<string, ClipPreviewPosition>; originals: Map<string, ClipPreviewPosition> },
    rippleEnabled: boolean,
    isGroupGesture: boolean
): boolean => {
    if (isGroupGesture) {
        return false;
    }
    const entries = [...preview.positions];
    const single = entries[0];
    if (entries.length !== 1 || !single) {
        return false;
    }
    const [clipId, pos] = single;
    const orig = preview.originals.get(clipId);
    if (!orig || (rippleEnabled && orig.trackId === pos.trackId)) {
        return false;
    }
    if (orig.trackId !== pos.trackId || !Object.is(orig.startBeat, pos.startBeat)) {
        void executeUserAppAction({
            type: 'moveClip',
            payload: { clipId, trackId: pos.trackId, startBeat: pos.startBeat },
        });
    }
    return true;
};

export const useTimelineInteractions = (canvasRef: React.RefObject<HTMLCanvasElement | null>) => {
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
    const pointersRef = useRef<Map<number, PointerEvent>>(new Map());
    const autoDragRef = useRef<{
        laneId?: string;
        trackId: string;
        parameterId: string;
        parameterName: string;
        points: AutomationPoint[];
    } | null>(null);
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
    // Clip id that should become the sole selection on pointer-up if the press
    // never turned into a drag (pointer-down on a multi-selection member keeps
    // the selection so the group can be dragged; a plain click collapses it).
    const pendingCollapseClipIdRef = useRef<string | null>(null);
    // Per-drag clip metadata captured at drag start: clip types (for track-kind
    // drop compatibility) and locked membership (locked clips never preview).
    const dragContextRef = useRef<{ types: Map<string, 'audio' | 'midi'>; locked: Set<string> } | null>(null);
    // Drop rejection computed during the last preview pass: the reason surfaced
    // at drop time and the clips excluded from the commit.
    const dropRejectedRef = useRef<{ reason: string | null; clipIds: Set<string> }>({
        reason: null,
        clipIds: new Set<string>(),
    });
    // Cached canvas bounding rect. getBoundingClientRect() forces a synchronous
    // layout flush, so calling it on every 60+Hz pointer event is expensive
    // (finding #57). We cache it and invalidate on resize / scroll instead.
    const canvasRectRef = useRef<DOMRect | null>(null);

    useTimelineGestures(canvasRef);

    // Keep the cached rect fresh: invalidate when the canvas resizes or anything
    // scrolls (capture phase catches ancestor scroll containers too).
    useEffect(() => {
        const canvas = canvasRef.current;
        const invalidate = (): void => {
            canvasRectRef.current = null;
        };
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidate) : null;
        if (canvas && observer) {
            observer.observe(canvas);
        }
        window.addEventListener('scroll', invalidate, { capture: true, passive: true });
        window.addEventListener('resize', invalidate, { passive: true });
        return () => {
            observer?.disconnect();
            window.removeEventListener('scroll', invalidate, { capture: true });
            window.removeEventListener('resize', invalidate);
        };
    }, [canvasRef]);

    const getCanvasRect = (): DOMRect | null => {
        if (!canvasRectRef.current) {
            canvasRectRef.current = canvasRef.current?.getBoundingClientRect() ?? null;
        }
        return canvasRectRef.current;
    };

    const getCanvasCoords = (event: MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
        const rect = getCanvasRect();
        if (!rect) {
            return { x: 0, y: 0 };
        }
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // ── Gesture cancellation (Escape / window blur / pointer leaving canvas) ──

    // dragState is mirrored into a ref at every setDragState call site (event
    // handlers, never render) so the registered canceler — a stable closure —
    // never sees stale state and never trips the no-refs-during-render rule.
    const dragStateRef = useRef<DragState | null>(null);

    const cancelActiveGesture = (): boolean => {
        const hadGesture =
            dragStateRef.current !== null ||
            slipDragRef.current !== null ||
            drawDragRef.current !== null ||
            autoDragRef.current !== null ||
            noteDragRef.current !== null ||
            rubberBandRef.current !== null;
        if (!hadGesture) {
            return false;
        }
        // Every gesture previews through refs; project truth is only written
        // at commit (mouse-up). Cancelling therefore just discards the
        // preview — no history entry, original state already intact.
        slipDragRef.current = null;
        drawDragRef.current = null;
        autoDragRef.current = null;
        noteDragRef.current = null;
        rubberBandRef.current = null;
        inlineMidiNotePreviewRef.current = null;
        clipDragPreviewRef.current = null;
        previewDirtyFlag.value = true;
        pendingCollapseClipIdRef.current = null;
        dragContextRef.current = null;
        dropRejectedRef.current = { reason: null, clipIds: new Set<string>() };
        setRubberBand(null);
        dragStateRef.current = null;
        setDragState(null);
        if (canvasRef.current) {
            canvasRef.current.style.cursor = '';
        }
        return true;
    };

    const cancelGestureRef = useRef<() => boolean>(() => false);
    useEffect(() => {
        cancelGestureRef.current = cancelActiveGesture;
    });

    useEffect(() => {
        const cancel = (): boolean => cancelGestureRef.current();
        const unregister = registerTimelineGestureCanceler(cancel);
        const handleBlur = (): void => {
            cancel();
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                cancel();
            }
        };
        window.addEventListener('blur', handleBlur);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            unregister();
            window.removeEventListener('blur', handleBlur);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    // Pointer leaving the canvas mid-gesture cancels the clip, note, slip,
    // and automation drags rather than committing at the last position
    // (audit: arrangement focus-loss cancellation). A rubber-band lasso is
    // the exception: the canvas fills its container edge-to-edge, so
    // dragging the lasso past that edge is the ordinary way to select
    // everything from a point onward — leaving still commits it, exactly
    // like releasing the mouse button would.
    const handleMouseLeave = (): void => {
        if (rubberBandRef.current) {
            commitRubberBandSelection();
            rubberBandRef.current = null;
            setRubberBand(null);
            return;
        }
        cancelGestureRef.current();
    };

    const getBeatFromX = (x: number): number => canvasXToBeat(x);

    const { handleFileDrop, isDragOver, setIsDragOver, isImporting } = useTimelineFileDrop({
        getCanvasCoords: (event: DragEvent<HTMLDivElement>): { x: number; y: number } => {
            const rect = getCanvasRect();
            if (!rect) {
                return { x: 0, y: 0 };
            }
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        },
        getBeatFromX,
    });

    const getActiveTool = () => workspaceStore.value?.activeTool ?? 'select';
    const getScrollY = () => timelineViewStore.value?.scrollY ?? 0;

    // ── Mouse Down ────────────────────────────────────────────────────────────

    const handleMouseDown = (event: MouseEvent<HTMLCanvasElement>) => {
        // The ref only ever describes the press currently in flight. Clear
        // it unconditionally before anything below can re-arm it — a press
        // whose drag never started (e.g. beginClipDrag rejects a hit that
        // hitTestClip returned but trackStore no longer holds) otherwise
        // leaves it armed for a later, unrelated press to consume.
        pendingCollapseClipIdRef.current = null;

        if (event.button !== 0) {
            return;
        }
        const { x, y } = getCanvasCoords(event);
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
            // Only paint when the automation lane is actually visible — otherwise
            // the tool writes points onto a hidden lane (finding #88). This mirrors
            // the sub-lane paint guard above.
            if (workspaceStore.value?.automationVisibility !== 'hidden') {
                handleAutomationTool(x, y, beat, getScrollY(), autoDragRef);
            }
            return;
        }

        // ── Ctrl/Cmd+Shift+drag: slip edit clip content (A10) ──
        if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
            const slipHit = hitTestClip(x, y);
            if (slipHit) {
                const state = trackStore.value;
                const track = state?.tracks.find((time) => time.id === slipHit.trackId);
                const clip = track?.clips.find((context) => context.id === slipHit.clipId);
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
                const note = notes.find((node) => node.id === clipHit.noteId);
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
            const clipForHit = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === clipHit.clipId);
            if (clipForHit?.isGhost) {
                acceptGhostClip(clipHit.clipId);
                return;
            }
            selectTrack(clipHit.trackId);
            if (event.shiftKey || event.metaKey) {
                toggleClipInSelection(clipHit.clipId);
            } else {
                // Pointer-down on a member of a multi-selection must NOT
                // collapse the selection — the press may become a drag (or an
                // Alt+drag duplicate) of the whole group. Focus the clip now;
                // if the pointer comes back up without a drag, collapse to it
                // on mouse-up instead.
                const selectedIds = clipSelectionStore.value?.selectedClipIds ?? [];
                if (selectedIds.length > 1 && selectedIds.includes(clipHit.clipId)) {
                    selectClip(clipHit.clipId);
                    pendingCollapseClipIdRef.current = clipHit.clipId;
                } else {
                    selectClipWithFocus(clipHit.clipId);
                }
            }
        }

        const edgeHit = hitTestClipEdge(x, y);
        let dragMode: 'move' | 'duplicate' | 'stretch' | 'trim-start' = tool === 'stretch' ? 'stretch' : 'move';
        if (edgeHit && edgeHit.edge !== 'body' && tool === 'select') {
            dragMode = edgeHit.edge === 'left' ? 'trim-start' : 'stretch';
        }
        // Alt+drag on a clip: duplicate instead of move (R-B1)
        if (event.altKey && clipHit && dragMode === 'move') {
            dragMode = 'duplicate';
        }
        // Only a plain body press is a click-selection candidate; a trim,
        // stretch, or duplicate gesture released in place keeps the selection.
        if (dragMode !== 'move') {
            pendingCollapseClipIdRef.current = null;
        }

        const drag = beginClipDrag(x, y, dragMode);
        if (drag) {
            // Capture original positions for all selected clips so mousemove can
            // write preview positions without touching any store.
            const selectedIds = clipSelectionStore.value?.selectedClipIds ?? [];
            const allIds = selectedIds.length > 1 && selectedIds.includes(drag.clipId) ? selectedIds : [drag.clipId];
            const state = trackStore.value;
            if (state) {
                const originals = new Map<string, ClipPreviewPosition>();
                const types = new Map<string, 'audio' | 'midi'>();
                const locked = new Set<string>();
                for (const time of state.tracks) {
                    for (const clip of time.clips) {
                        if (allIds.includes(clip.id)) {
                            originals.set(clip.id, {
                                trackId: time.id,
                                startBeat: clip.startBeat,
                                endBeat: clip.endBeat,
                            });
                            types.set(clip.id, clip.type);
                            if (clip.locked) {
                                locked.add(clip.id);
                            }
                        }
                    }
                }
                // Locked clips never enter the preview: they stay put for the
                // whole gesture rather than being silently skipped at commit.
                const positions = new Map([...originals].filter(([id]) => !locked.has(id)));
                clipDragPreviewRef.current = { positions, originals };
                dragContextRef.current = { types, locked };
                dropRejectedRef.current = { reason: null, clipIds: new Set<string>() };
                previewDirtyFlag.value = true;
            }
            dragStateRef.current = drag;
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

    const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
        const { x, y } = getCanvasCoords(event);

        if (noteDragRef.current) {
            const drag = noteDragRef.current;
            const deltaBeat = getBeatFromX(x) - drag.dragStartBeat;
            const deltaPitch = Math.round((drag.dragStartY - y) / drag.noteHeight);

            const newStartBeat = snapToGrid(drag.originalStartBeat + deltaBeat);
            const newPitch = Math.max(0, Math.min(127, drag.originalPitch + deltaPitch));

            inlineMidiNotePreviewRef.current = {
                clipId: drag.clipId,
                noteId: drag.noteId,
                pitch: newPitch,
                startBeat: newStartBeat,
            };
            previewDirtyFlag.value = true;
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
                // §fix-9 — Cursor-only delta: omit playheadBeat so it doesn't
                // overwrite the value the playhead heartbeat keeps current.
                broadcastPresence({
                    cursorBeat,
                    cursorTrackId: trackHit?.id ?? null,
                });
            }
        }

        // Hover cursor (no active drag). The loop-region drag lives in
        // BeatRulerBar, not here.
        if (!dragState && !autoDragRef.current && !drawDragRef.current && !rubberBandRef.current) {
            if (getActiveTool() === 'select') {
                const edgeHit = hitTestClipEdge(x, y);
                setHoverCursor(edgeHit && edgeHit.edge !== 'body' ? 'ew-resize' : null);
            } else {
                setHoverCursor(null);
            }
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
                    const track = state?.tracks.find((time) => time.clips.some((context) => context.id === clipId));
                    const clip = track?.clips.find((context) => context.id === clipId);
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
                previewDirtyFlag.value = true;
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
                    previewDirtyFlag.value = true;
                }
            }
            return;
        }
        if (dragState.mode === 'stretch') {
            let newEnd = Math.max(dragState.startBeat + 0.25, snapToGrid(rawBeat));

            if (preferencesStore.value?.snapToZeroCrossing) {
                const state = trackStore.value;
                const clip = state?.tracks
                    .flatMap((time) => time.clips)
                    .find((context) => context.id === dragState.clipId);
                if (clip && clip.type === 'audio') {
                    newEnd = snapToZeroCrossing(clip, newEnd);
                }
            }

            const preview = clipDragPreviewRef.current;
            if (preview) {
                const orig = preview.originals.get(dragState.clipId);
                if (orig) {
                    preview.positions.set(dragState.clipId, { ...orig, endBeat: newEnd });
                    previewDirtyFlag.value = true;
                }
            }
            return;
        }

        const contentY = getContentY(y, getScrollY());
        const model = buildTimelineRenderModel();
        const tracks = model.tracks;
        const trackHit = getTrackAtYHelper(tracks, Math.max(0, contentY));
        const targetTrack = trackHit ? tracks[trackHit.index] : null;
        const snapTrackId = targetTrack?.id ?? dragState.sourceTrackId;
        const snappedBeat = Math.max(
            0,
            snapToGridOrClips(rawBeat - dragState.offsetBeat, snapTrackId, dragState.clipId)
        );

        if (targetTrack) {
            // The row under the pointer; this block only runs when the pointer
            // is over a track row, so the index always resolves.
            const targetIndex = tracks.findIndex((track) => track.id === targetTrack.id);
            const selectedIds = clipSelectionStore.value?.selectedClipIds ?? [];
            const preview = clipDragPreviewRef.current;
            if (preview) {
                const context = dragContextRef.current;
                const locked = context?.locked ?? new Set<string>();
                const types = context?.types ?? new Map<string, 'audio' | 'midi'>();
                const rejected = new Set<string>();
                let rejectReason: string | null = null;

                const primaryOrig = preview.originals.get(dragState.clipId);
                const anchorIndex = primaryOrig ? tracks.findIndex((track) => track.id === primaryOrig.trackId) : -1;
                // Per-clip track offsets: every dragged clip keeps its distance
                // from the drag anchor's track; an offset that would leave the
                // track list clamps to the nearest edge track.
                const destinationFor = (orig: ClipPreviewPosition): (typeof tracks)[number] => {
                    const origIndex = tracks.findIndex((track) => track.id === orig.trackId);
                    if (origIndex < 0 || anchorIndex < 0 || targetIndex < 0) {
                        return targetTrack;
                    }
                    const offset = targetIndex - anchorIndex;
                    const clamped = Math.max(0, Math.min(tracks.length - 1, origIndex + offset));
                    return tracks[clamped]!;
                };

                const previewClip = (id: string, startBeat: number): void => {
                    const orig = preview.originals.get(id);
                    if (!orig) {
                        return;
                    }
                    if (locked.has(id)) {
                        // Locked clips stay put for the whole gesture.
                        rejected.add(id);
                        rejectReason = rejectReason ?? 'Locked clips stay in place';
                        return;
                    }
                    const destination = destinationFor(orig);
                    const clipType = types.get(id);
                    if (clipType && !isClipDropCompatible(clipType, destination.kind)) {
                        // Rejected destination: hold the clip at its origin so
                        // the preview never shows it landing somewhere it can't.
                        preview.positions.set(id, { ...orig });
                        rejected.add(id);
                        rejectReason = rejectReason ?? clipDropRejectionReason(destination.kind);
                        return;
                    }
                    const duration = orig.endBeat - orig.startBeat;
                    preview.positions.set(id, {
                        trackId: destination.id,
                        startBeat,
                        endBeat: startBeat + duration,
                    });
                };

                if (selectedIds.length > 1 && selectedIds.includes(dragState.clipId) && primaryOrig) {
                    const beatDelta = snappedBeat - primaryOrig.startBeat;
                    for (const id of selectedIds) {
                        const orig = preview.originals.get(id);
                        if (orig) {
                            previewClip(id, Math.max(0, orig.startBeat + beatDelta));
                        }
                    }
                } else if (primaryOrig) {
                    previewClip(dragState.clipId, snappedBeat);
                }

                dropRejectedRef.current = { reason: rejectReason, clipIds: rejected };
                if (canvasRef.current) {
                    canvasRef.current.style.cursor = rejected.has(dragState.clipId) ? 'not-allowed' : 'grabbing';
                }
                previewDirtyFlag.value = true;
            }
        } else {
            // No track under the pointer (e.g. below the last row): any
            // rejection reason recorded over an earlier row no longer
            // describes the drop the user is about to make, so it must not
            // survive to surface at mouse-up.
            dropRejectedRef.current = { reason: null, clipIds: new Set<string>() };
        }
    };

    // Shared by handleMouseUp (release) and handleMouseLeave (pointer exits
    // the canvas mid-lasso): both commit the same rubber-band selection from
    // the same tracked bounds, they just fire on different DOM events.
    const commitRubberBandSelection = (): void => {
        if (!rubberBand) {
            return;
        }
        const view = timelineViewStore.value;
        const model = buildTimelineRenderModel();
        if (!view) {
            return;
        }
        const left = Math.min(rubberBand.startX, rubberBand.endX);
        const right = Math.max(rubberBand.startX, rubberBand.endX);
        const sY = view.scrollY;
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
    };

    // ── Mouse Up ──────────────────────────────────────────────────────────────

    const handleMouseUp = (event: MouseEvent<HTMLCanvasElement>) => {
        if (noteDragRef.current) {
            const drag = noteDragRef.current;
            const preview = inlineMidiNotePreviewRef.current;
            noteDragRef.current = null;
            inlineMidiNotePreviewRef.current = null;
            previewDirtyFlag.value = true;
            if (preview && preview.clipId === drag.clipId && preview.noteId === drag.noteId) {
                commitInlineMidiNoteMove({
                    clipId: preview.clipId,
                    noteId: preview.noteId,
                    pitch: preview.pitch,
                    startBeat: preview.startBeat,
                });
            }
            return;
        }
        if (slipDragRef.current) {
            const { clipId, clipType, startX, originalOffset } = slipDragRef.current;
            slipDragRef.current = null;
            clipDragPreviewRef.current = null;
            previewDirtyFlag.value = true;
            const { x } = getCanvasCoords(event);
            const view = timelineViewStore.value;
            if (view) {
                const deltaBeats = (x - startX) / view.pixelsPerBeat;
                if (Math.abs(deltaBeats) > 0.001) {
                    // Dispatched through the registered action (#3641), not
                    // pushUndoEntry: the handler performs the write and records
                    // the same 'Slip clip content' history entry, so admission
                    // refusals surface instead of vanishing.
                    void executeUserAppAction({
                        type: 'slipClipContent',
                        payload: { clipId, clipType, offset: originalOffset + deltaBeats },
                    });
                }
            }
            return;
        }

        if (autoDragRef.current) {
            commitInlineAutomationPaint(autoDragRef.current);
            autoDragRef.current = null;
            return;
        }

        if (drawDragRef.current) {
            const { x } = getCanvasCoords(event);
            const endBeat = Math.ceil(getBeatFromX(x));
            const { startBeat, trackId: drawTrackId, clipType: drawClipType } = drawDragRef.current;
            const state1 = Math.min(startBeat, endBeat);
            const length = Math.max(1, Math.max(startBeat, endBeat) - state1);

            // Dispatched through the registered action (#3641), not pushUndoEntry:
            // the handler plans the ripple insert before adding the clip, writes
            // both, and records the same 'Draw clip' / 'Draw clip (ripple)'
            // history entry, so admission refusals surface instead of vanishing.
            // A disabled or no-shift ripple degrades to a plain draw inside the
            // handler, and a refused add mints no entry.
            void executeUserAppAction({
                type: 'drawClip',
                payload: {
                    trackId: drawTrackId,
                    startBeat: state1,
                    endBeat: state1 + length,
                    name: `Clip ${state1}`,
                    type: drawClipType,
                    ripple: workspaceStore.value?.rippleEditing ?? false,
                },
            });
            drawDragRef.current = null;
            return;
        }

        if (rubberBandRef.current && rubberBand) {
            commitRubberBandSelection();
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
            const { clipId: dragClipId, mode: dragMode } = dragState;

            // Commit preview positions to the store in one batch, then clear the ref.
            const preview = clipDragPreviewRef.current;
            clipDragPreviewRef.current = null;
            previewDirtyFlag.value = true;

            const primaryPos = preview?.positions.get(dragClipId);
            const primaryOrig = preview?.originals.get(dragClipId);

            // A plain press on a multi-selection member that never became a
            // drag collapses the selection to that clip on release (the press
            // itself preserved the selection so the group could be dragged).
            // "Never became a drag" is judged across EVERY previewed clip, not
            // just the primary: a locked or drop-rejected primary never leaves
            // its origin, but its followers may have real previewed moves —
            // collapsing then would silently discard their commit and skip the
            // rejection feedback.
            const pendingCollapse = pendingCollapseClipIdRef.current;
            pendingCollapseClipIdRef.current = null;

            // Surface a rejected drop (locked clip, incompatible track kind) at
            // drop time; rejected clips were held at their origin in the preview
            // and are excluded from the commit below.
            const dropRejected = dropRejectedRef.current;
            dropRejectedRef.current = { reason: null, clipIds: new Set<string>() };
            dragContextRef.current = null;

            const anyPreviewMoved =
                !!preview &&
                [...preview.positions.entries()].some(([clipId, pos]) => {
                    const orig = preview.originals.get(clipId);
                    return (
                        !!orig &&
                        (pos.trackId !== orig.trackId ||
                            !Object.is(pos.startBeat, orig.startBeat) ||
                            !Object.is(pos.endBeat, orig.endBeat))
                    );
                });

            if (pendingCollapse && !anyPreviewMoved && !dropRejected.reason) {
                selectClipWithFocus(pendingCollapse);
                dragStateRef.current = null;
                setDragState(null);
                if (canvasRef.current) {
                    canvasRef.current.style.cursor = '';
                }
                return;
            }
            if (dropRejected.reason) {
                notifyUser(dropRejected.reason, 'warning');
            }

            if (preview && preview.positions.size > 0) {
                if (dragMode === 'duplicate' && anyPreviewMoved) {
                    // Alt+drag duplicate: originals stay, copies land at drop
                    // positions (R-B1) on the dragged-to track, as previewed.
                    // Gated on actual movement: a motionless Alt+click must not
                    // stack invisible copies on the originals.
                    //
                    // Per-clip dispatch through the registered action (#3641);
                    // copy ids are still pre-allocated so undo removes exactly
                    // the created clips, and one fresh group id per gesture
                    // makes the whole gesture a single undo step.
                    const candidates = [...preview.positions].filter(([clipId]) => !dropRejected.clipIds.has(clipId));
                    const { groupId, groupLabel } = generateGroupId(
                        `Duplicate ${candidates.length} clip${candidates.length === 1 ? '' : 's'}`
                    );
                    for (const [clipId, pos] of candidates) {
                        void executeUserAppAction(
                            {
                                type: 'duplicateClipAt',
                                payload: {
                                    clipId,
                                    destinationTrackId: pos.trackId,
                                    startBeat: pos.startBeat,
                                    targetClipId: prepareDuplicateClipTargetId(),
                                },
                            },
                            { groupId, groupLabel }
                        );
                    }
                } else if (dragMode === 'move') {
                    const rippleEnabled = workspaceStore.value?.rippleEditing ?? false;
                    // Same mousedown group test that seeded the preview: a drag
                    // that began on a multi-selection member is a group gesture
                    // even when locked or stale members leave one previewed clip.
                    const selectedClipIds = clipSelectionStore.value?.selectedClipIds ?? [];
                    const isGroupGesture = selectedClipIds.length > 1 && selectedClipIds.includes(dragClipId);
                    // A single previewed clip already committed through the
                    // registered action (or provably no-op'd) — return through
                    // the same reset tail the collapse branch uses.
                    if (commitSingleClipMove(preview, rippleEnabled, isGroupGesture)) {
                        dragStateRef.current = null;
                        setDragState(null);
                        if (canvasRef.current) {
                            canvasRef.current.style.cursor = '';
                        }
                        return;
                    }
                    // The whole group gesture commits through ONE registered
                    // moveClips dispatch (#3641), not pushUndoEntry: the handler
                    // applies this loop's skip rules verbatim, computes each
                    // ripple plan between sequential writes, and records one
                    // history entry — 'Move clip (ripple)' or 'Move N clips'.
                    // History follows only clips whose write actually landed; a
                    // rejected or no-op move mints no entry.
                    const moves = [...preview.positions].flatMap(([clipId, pos]) =>
                        preview.originals.has(clipId)
                            ? [{ clipId, trackId: pos.trackId, startBeat: pos.startBeat }]
                            : []
                    );
                    if (moves.length > 0) {
                        void executeUserAppAction({
                            type: 'moveClips',
                            payload: { moves, ripple: rippleEnabled },
                        });
                    }
                } else if (dragMode === 'trim-start' && primaryPos) {
                    // Dispatched through the registered action (not pushUndoEntry)
                    // so admission refusals surface and capability-gated step-over
                    // can reach the entry (#3641). The handler's no-write result
                    // mints no entry; the geometry guard skips a release in place.
                    if (primaryOrig && primaryPos.startBeat !== primaryOrig.startBeat) {
                        void executeUserAppAction({
                            type: 'trimClipStart',
                            payload: { clipId: dragClipId, newStartBeat: primaryPos.startBeat },
                        });
                    }
                } else if (dragMode === 'stretch' && primaryPos) {
                    // Same registered-action dispatch as trim start (#3641).
                    if (primaryOrig && primaryPos.endBeat !== primaryOrig.endBeat) {
                        void executeUserAppAction({
                            type: 'trimClipEnd',
                            payload: { clipId: dragClipId, newEndBeat: primaryPos.endBeat },
                        });
                    }
                }
            }

            dragStateRef.current = null;
            setDragState(null);
            if (canvasRef.current) {
                canvasRef.current.style.cursor = '';
            }
        }
    };

    // ── Double Click ──────────────────────────────────────────────────────────

    const handleDoubleClick = (event: MouseEvent<HTMLCanvasElement>) => {
        const { x, y } = getCanvasCoords(event);
        const hit = hitTestClip(x, y);
        if (hit) {
            const track = trackStore.value?.tracks.find((time) => time.id === hit.trackId);
            const clip = track?.clips.find((context) => context.id === hit.clipId);

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

    const handleContextMenu = (event: MouseEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        const { x, y } = getCanvasCoords(event);
        const hit = hitTestClip(x, y);
        if (hit) {
            selectTrack(hit.trackId);
            selectClip(hit.clipId);
            setContextMenu({
                kind: 'clip',
                x: event.clientX,
                y: event.clientY,
                clipId: hit.clipId,
                trackId: hit.trackId,
                splitBeat: getBeatFromX(x),
            });
        } else {
            setContextMenu({
                kind: 'empty',
                x: event.clientX,
                y: event.clientY,
                trackId: hitTestTrack(y),
                beat: Math.floor(getBeatFromX(x)),
            });
        }
    };

    // ── Pointer (pinch-zoom) ──────────────────────────────────────────────────

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        // Cap the tracked pointers at 2. A 3rd contact (e.g. finger + pencil +
        // finger) would otherwise be recorded and leak stale deltas into later
        // pinch frames (finding #60).
        if (pointersRef.current.size >= 2 && !pointersRef.current.has(event.pointerId)) {
            return;
        }
        pointersRef.current.set(event.pointerId, event.nativeEvent);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (pointersRef.current.size === 2) {
            const prev = pointersRef.current.get(event.pointerId);
            // Only update pointers we already track; ignore a 3rd contact so it
            // can't pollute the pinch distance (finding #60).
            if (!prev) {
                return;
            }
            pointersRef.current.set(event.pointerId, event.nativeEvent);
            const [p1, p2] = [...pointersRef.current.values()];
            if (!p1 || !p2) {
                return;
            }
            const prevOther = [...pointersRef.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
            if (!prevOther) {
                return;
            }
            const prevDist = Math.hypot(prev.clientX - prevOther.clientX, prev.clientY - prevOther.clientY);
            const currDist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
            const delta = currDist - prevDist;
            if (Math.abs(delta) > 1) {
                // Proportional zoom step to match Ctrl+wheel / trackpad gesture feel
                // (findings #81/#17), instead of a fixed ±2 ppb jump.
                zoomTimeline(delta * PINCH_ZOOM_FACTOR);
            }
        } else if (pointersRef.current.size < 2 || pointersRef.current.has(event.pointerId)) {
            // Track up to 2 pointers; ignore any beyond the first two (finding #60).
            pointersRef.current.set(event.pointerId, event.nativeEvent);
        }
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        pointersRef.current.delete(event.pointerId);
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
            case 'marquee':
            case 'select':
            default:
                return 'default';
        }
    };

    return {
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleMouseLeave,
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
