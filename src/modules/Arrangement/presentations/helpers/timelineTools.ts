/**
 * Tool-specific mousedown handlers for the timeline canvas.
 *
 * Each function returns `true` if the event was fully handled (caller should
 * return early) or `false` to continue with the general select/drag logic.
 */
import { type RefObject } from 'react';

import { automationStore } from '#/modules/Automation/stores';
import { addAutomationPoint, addAutomationLane } from '#/modules/Automation/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { addMidiNote, removeMidiNote } from '#/modules/MIDI/useCases';

import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { addClip } from '../../useCases/clip/addClip';
import { removeClip } from '../../useCases/clip/removeClip';
import { splitClip } from '../../useCases/clipEditing/splitClip';
import { hitTestAutomationSubLane } from '../../useCases/timelineInteractions/hitTestAutomationSubLane';
import { hitTestClip } from '../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { hitTestTrack } from '../../useCases/timelineInteractions/hitTestClip/hitTestTrack';
import { snapToGrid } from '../../useCases/timelineInteractions/snapToGrid';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';

import { getContentY, resolveTrackAtY, valueAtTrackY } from './timelineMouse';

type AutoDragRef = RefObject<{ laneId: string; trackId: string; points: AutomationPoint[] } | null>;
type DrawDragRef = RefObject<{ trackId: string; startBeat: number; clipType: 'audio' | 'midi' } | null>;

// ── Cut tool ─────────────────────────────────────────────────────────────────

export const handleCutTool = (x: number, y: number, beat: number): boolean => {
    const hit = hitTestClip(x, y);
    if (!hit) {
        return true; // consumed, no clip hit
    }
    const origClip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === hit.clipId);
    if (origClip) {
        const savedClip = { ...origClip };
        splitClip(hit.clipId, beat);
        const newClips =
            trackStore.value?.tracks
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
    return true;
};

// ── Draw tool ─────────────────────────────────────────────────────────────────

export const handleDrawTool = (x: number, y: number, beat: number, drawDragRef: DrawDragRef): boolean => {
    const hit = hitTestClip(x, y);
    const trackId = hit?.trackId ?? hitTestTrack(y);

    if (hit?.noteId && hit.clipId) {
        // Hitting a note with draw tool: delete it (logic pro style)
        const noteId = hit.noteId;
        const clipId = hit.clipId;
        removeMidiNote(clipId, noteId);
        return true;
    }

    if (hit?.clipId && !hit.noteId) {
        const trackState = trackStore.value;
        const clip = trackState?.tracks.flatMap((t) => t.clips).find((c) => c.id === hit.clipId);
        if (clip?.isInlineEditing && clip.type === 'midi') {
            // Draw a new note inside the inline clip
            const pitch = hit.pitch ?? 60;
            const startBeat = snapToGrid(beat);
            addMidiNote(hit.clipId, pitch, startBeat, 0.25, 100);
            return true;
        }
    }

    if (trackId) {
        const track = trackStore.value?.tracks.find((t) => t.id === trackId);
        const clipType = track?.kind === 'midi' ? 'midi' : 'audio';
        drawDragRef.current = { trackId, startBeat: Math.floor(beat), clipType };
        selectTrack(trackId);
    }
    return true;
};

// ── Automation tool ───────────────────────────────────────────────────────────

export const handleAutomationTool = (
    x: number,
    y: number,
    beat: number,
    scrollY: number,
    autoDragRef: AutoDragRef
): boolean => {
    // Sub-lane hit (paint directly onto drawn sub-lane)
    const subLaneHit = hitTestAutomationSubLane(x, y);
    if (subLaneHit) {
        const point: AutomationPoint = { beat: subLaneHit.beat, value: subLaneHit.value, curve: 'linear', tension: 0 };
        addAutomationPoint(subLaneHit.laneId, point);
        autoDragRef.current = { laneId: subLaneHit.laneId, trackId: subLaneHit.trackId, points: [point] };
        selectTrack(subLaneHit.trackId);
        return true;
    }

    const trackId = hitTestTrack(y);
    if (!trackId) {
        return true;
    }

    const contentY = getContentY(y, scrollY);
    const trackHit = resolveTrackAtY(contentY);
    const value = trackHit ? valueAtTrackY(contentY, trackHit.offset, trackHit.height) : 0.5;

    // Ensure a gain lane exists on this track
    let lane = automationStore.value?.lanes.find((l) => l.trackId === trackId && l.parameterId === 'gain');
    if (!lane) {
        addAutomationLane(trackId, 'gain', 'Gain');
        lane = automationStore.value?.lanes.find((l) => l.trackId === trackId && l.parameterId === 'gain');
    }
    if (lane) {
        const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
        addAutomationPoint(lane.id, point);
        autoDragRef.current = { laneId: lane.id, trackId, points: [point] };
    }
    selectTrack(trackId);
    return true;
};

// ── Auto-sub-lane paint (called before dispatching to tools when automation is visible) ──

export const tryPaintSubLane = (x: number, y: number, autoDragRef: AutoDragRef): boolean => {
    const subLaneHit = hitTestAutomationSubLane(x, y);
    if (!subLaneHit) {
        return false;
    }
    const point: AutomationPoint = { beat: subLaneHit.beat, value: subLaneHit.value, curve: 'linear', tension: 0 };
    addAutomationPoint(subLaneHit.laneId, point);
    autoDragRef.current = { laneId: subLaneHit.laneId, trackId: subLaneHit.trackId, points: [point] };
    selectTrack(subLaneHit.trackId);
    return true;
};

// ── Auto-drag move (called in mousemove when autoDragRef is active) ───────────

export const paintAutoDragPoint = (x: number, y: number, scrollY: number, autoDragRef: AutoDragRef): void => {
    const ref = autoDragRef.current;
    if (!ref) {
        return;
    }
    const view = timelineViewStore.value;
    if (!view) {
        return;
    }
    const beat = x / view.pixelsPerBeat + view.scrollX / view.pixelsPerBeat;
    const contentY = getContentY(y, scrollY);
    const trackHit = resolveTrackAtY(contentY);
    const value = trackHit ? valueAtTrackY(contentY, trackHit.offset, trackHit.height) : 0.5;
    const lastPoint = ref.points[ref.points.length - 1];
    if (!lastPoint || Math.abs(beat - lastPoint.beat) >= 0.1) {
        const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
        ref.points.push(point);
        addAutomationPoint(ref.laneId, point);
    }
};
