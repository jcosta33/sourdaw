import { logger } from '#/infra/logger/appLogger';
import { midiStore } from '#/modules/MIDI/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { TRACK_HEIGHT_VALUES } from '#/modules/Preferences/useCases';
import { transportStore, playheadPositionRef, timeSignatureMapStore } from '#/modules/Transport/stores';
import { getTimeSignatureAtBeat } from '#/modules/Transport/useCases';

import { type TimelineRenderModel, type TrackRenderModel, type ClipRenderModel } from '../models/TimelineRenderModel';
import { activeRecordingRef } from '../stores/activeRecordingRef';
import { clipDragPreviewRef } from '../stores/clipDragPreviewRef';
import { clipSelectionStore } from '../stores/clipSelectionStore';
import { inlineMidiNotePreviewRef } from '../stores/inlineMidiNotePreviewRef';
import { timelineViewStore } from '../stores/timelineViewStore';
import { trackStore } from '../stores/trackStore';

function defaultViewportWidth(): number {
    return typeof window !== 'undefined' ? window.innerWidth : 1920;
}

// §143.1 — During recording, buildTimelineRenderModel is called on every
// rAF but only the recording clips' `endBeat` actually changes. Previously
// the whole track array was rebuilt per frame. Cache a pre-cloned overlay
// keyed on (cachedModel identity, recClips identity) so each rAF only
// mutates the endBeat field of the affected clip refs (which this module
// owns exclusively — they are never handed back to the shared cached
// model).
type OverlayClipHandle = {
    clip: { endBeat: number; startBeat: number };
    minEnd: number;
};
const recordingOverlayCache: {
    sourceModel: TimelineRenderModel | null;
    recClips: readonly string[] | null;
    tracks: TimelineRenderModel['tracks'] | null;
    handles: OverlayClipHandle[];
} = {
    sourceModel: null,
    recClips: null,
    tracks: null,
    handles: [],
};

// One-shot latch so drift between `transportStore.isRecording` and
// `activeRecordingRef` is reported once per episode instead of every
// animation frame. Reset below when the ref drains.
let recordingInvariantReported = false;

function applyRecordingOverlay(cachedModel: TimelineRenderModel, recClips: readonly string[]): TimelineRenderModel {
    const liveEnd = playheadPositionRef.current;

    if (
        recordingOverlayCache.sourceModel !== cachedModel ||
        recordingOverlayCache.recClips !== recClips ||
        recordingOverlayCache.tracks === null
    ) {
        const recIds = new Set(recClips);
        const handles: OverlayClipHandle[] = [];
        const tracks = cachedModel.tracks.map((track) => {
            let hasRecClip = false;
            for (const clip of track.clips) {
                if (recIds.has(clip.id)) {
                    hasRecClip = true;
                    break;
                }
            }
            if (!hasRecClip) {
                return track;
            }
            const clonedClips = track.clips.map((clip) => {
                if (!recIds.has(clip.id)) {
                    return clip;
                }
                const cloned = { ...clip, endBeat: Math.max(clip.startBeat, liveEnd) };
                handles.push({ clip: cloned, minEnd: clip.startBeat });
                return cloned;
            });
            return { ...track, clips: clonedClips };
        });

        recordingOverlayCache.sourceModel = cachedModel;
        recordingOverlayCache.recClips = recClips;
        recordingOverlayCache.tracks = tracks;
        recordingOverlayCache.handles = handles;
    } else {
        // Fast path: reuse the pre-cloned overlay and just nudge the
        // endBeat of the recording clips we already cloned. Safe because
        // those clip objects are owned by this cache — they were never
        // returned to the shared cachedModel.
        for (const handle of recordingOverlayCache.handles) {
            handle.clip.endBeat = Math.max(handle.minEnd, liveEnd);
        }
    }

    return { ...cachedModel, tracks: recordingOverlayCache.tracks, dataDirty: true };
}

// §74.1 — Coalesce stores into memoization holder.
const renderCache: {
    model: TimelineRenderModel | null;
    track: unknown;
    view: unknown;
    midi: unknown;
    ws: unknown;
    prefs: unknown;
    transport: number | null;
    timeSig: unknown;
} = {
    model: null,
    track: null,
    view: null,
    midi: null,
    ws: null,
    prefs: null,
    transport: null,
    timeSig: null,
};

// The cached render model consumes one render-affecting transport field
// (tempo) — the playhead is read live from playheadPositionRef and the time
// signature comes from getTimeSignatureAtBeat. Keying cache invalidation on the
// whole transport object rebuilt the entire track/clip tree whenever any
// unrelated transport field changed identity. Compare only the render-affecting
// field instead. (The store is *not* rewritten per playhead tick: only
// startPlayback, pausePlayback, stopPlayback and executePlayheadSeek write
// `playheadPosition`, and the scheduler advances the ref alone.)
function renderAffectingTransport(transport: { tempo: number } | null | undefined): number | null {
    return transport?.tempo ?? null;
}

function applyInlineMidiNotePreview(cachedModel: TimelineRenderModel): TimelineRenderModel {
    const notePreview = inlineMidiNotePreviewRef.current;
    if (!notePreview) {
        return cachedModel;
    }

    let changed = false;
    const tracks = cachedModel.tracks.map((track) => {
        let trackChanged = false;
        const clips = track.clips.map((clip) => {
            if (clip.id !== notePreview.clipId) {
                return clip;
            }

            let noteChanged = false;
            const midiNotes = clip.midiNotes.map((note) => {
                if (note.id !== notePreview.noteId) {
                    return note;
                }
                noteChanged = true;
                return { ...note, pitch: notePreview.pitch, startBeat: notePreview.startBeat };
            });

            if (!noteChanged) {
                return clip;
            }

            changed = true;
            trackChanged = true;
            return { ...clip, midiNotes };
        });

        if (!trackChanged) {
            return track;
        }

        return { ...track, clips };
    });

    if (!changed) {
        return cachedModel;
    }

    return { ...cachedModel, tracks, dataDirty: true };
}

export function buildTimelineRenderModel(): TimelineRenderModel {
    const trackState = trackStore.value;
    const viewState = timelineViewStore.value;
    const transportState = transportStore.value;
    const midiState = midiStore.value;
    const ws = clipSelectionStore.value;
    const prefs = preferencesStore.value;
    const timeSigState = timeSignatureMapStore.value;
    const transportTempo = renderAffectingTransport(transportState);

    const dataChanged =
        !renderCache.model ||
        trackState !== renderCache.track ||
        viewState !== renderCache.view ||
        midiState !== renderCache.midi ||
        ws !== renderCache.ws ||
        prefs !== renderCache.prefs ||
        transportTempo !== renderCache.transport ||
        timeSigState !== renderCache.timeSig;

    if (dataChanged) {
        renderCache.track = trackState;
        renderCache.view = viewState;
        renderCache.midi = midiState;
        renderCache.ws = ws;
        renderCache.prefs = prefs;
        renderCache.transport = transportTempo;
        renderCache.timeSig = timeSigState;

        const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
        const scrollX = viewState?.scrollX ?? 0;
        const viewportStartBeat = scrollX / pixelsPerBeat;

        const collapsedFolders = new Set(
            (trackState?.tracks ?? []).filter((time) => time.kind === 'folder' && time.collapsed).map((time) => time.id)
        );
        const visibleTracks = (trackState?.tracks ?? []).filter((time) => {
            if (time.kind === 'master') {
                return false;
            }
            if (!time.parentId) {
                return true;
            }
            return !collapsedFolders.has(time.parentId);
        });

        const mappedTracks: TrackRenderModel[] = visibleTracks.map((track, index) => {
            const baseHeight = track.kind === 'folder' ? 26 : track.height;

            const mappedClips: ClipRenderModel[] = track.clips.map((clip) => {
                const notes = midiState?.notesByClipId[clip.id] ?? [];
                return {
                    id: clip.id,
                    startBeat: clip.startBeat,
                    endBeat: clip.endBeat,
                    name: clip.name,
                    color: clip.color || track.color,
                    type: clip.type,
                    muted: clip.muted,
                    midiNotes: notes.map((node) => ({
                        id: node.id,
                        pitch: node.pitch,
                        startBeat: node.startBeat,
                        duration: node.duration,
                    })),
                    audioBufferId: clip.audioBufferId,
                    loopEnabled: clip.loopEnabled,
                    loopLength: clip.loopLength,
                    audioOffsetBeats: clip.audioOffsetBeats,
                    midiOffsetBeats: clip.midiOffsetBeats,
                    stretchRatio: clip.stretchRatio,
                    fadeInBeats: clip.fadeInBeats,
                    fadeOutBeats: clip.fadeOutBeats,
                    generating: clip.generating,
                    isGhost: clip.isGhost,
                    isLinkedInstance: clip.isLinkedInstance || !!clip.parentClipId,
                    isInlineEditing: clip.isInlineEditing,
                };
            });

            // E1: Add ghost clips for this track
            const ghosts = (trackState?.ghostClips ?? []).filter((gain) => gain.trackId === track.id);
            for (const ghost of ghosts) {
                mappedClips.push({
                    id: ghost.id,
                    startBeat: ghost.startBeat,
                    endBeat: ghost.endBeat,
                    name: ghost.name,
                    color: ghost.color || '#3b82f6',
                    type: ghost.type,
                    muted: ghost.muted,
                    midiNotes: (midiState?.notesByClipId[ghost.id] ?? []).map((node) => ({
                        id: node.id,
                        pitch: node.pitch,
                        startBeat: node.startBeat,
                        duration: node.duration,
                    })),
                    audioBufferId: ghost.audioBufferId,
                    loopEnabled: ghost.loopEnabled,
                    loopLength: ghost.loopLength,
                    audioOffsetBeats: ghost.audioOffsetBeats,
                    midiOffsetBeats: ghost.midiOffsetBeats,
                    stretchRatio: ghost.stretchRatio,
                    fadeInBeats: ghost.fadeInBeats,
                    fadeOutBeats: ghost.fadeOutBeats,
                    isGhost: true,
                });
            }

            return {
                id: track.id,
                name: track.name,
                index,
                kind: track.kind,
                color: track.color,
                muted: track.muted,
                soloed: track.soloed,
                height: baseHeight,
                automationMode: track.automationMode,
                clips: mappedClips,
                variationLanes: track.showVariationLanes
                    ? track.alternatives.map((alt) => ({
                          id: alt.id,
                          name: alt.name,
                          clips: alt.clips.map((clip) => {
                              const notes = midiState?.notesByClipId[clip.id] ?? [];
                              return {
                                  id: clip.id,
                                  startBeat: clip.startBeat,
                                  endBeat: clip.endBeat,
                                  name: clip.name,
                                  color: clip.color || track.color,
                                  type: clip.type,
                                  muted: clip.muted,
                                  midiNotes: notes.map((node) => ({
                                      id: node.id,
                                      pitch: node.pitch,
                                      startBeat: node.startBeat,
                                      duration: node.duration,
                                  })),
                                  audioBufferId: clip.audioBufferId,
                                  loopEnabled: clip.loopEnabled,
                                  loopLength: clip.loopLength,
                                  audioOffsetBeats: clip.audioOffsetBeats,
                                  midiOffsetBeats: clip.midiOffsetBeats,
                                  stretchRatio: clip.stretchRatio,
                                  fadeInBeats: clip.fadeInBeats,
                                  fadeOutBeats: clip.fadeOutBeats,
                                  generating: clip.generating,
                                  isGhost: clip.isGhost,
                                  isLinkedInstance: clip.isLinkedInstance || !!clip.parentClipId,
                                  isInlineEditing: clip.isInlineEditing,
                              };
                          }),
                      }))
                    : undefined,
            };
        });

        const trackHeight = TRACK_HEIGHT_VALUES[prefs?.trackHeight ?? 'normal'];
        const playhead = playheadPositionRef.current;
        const { numerator, denominator } = getTimeSignatureAtBeat(playhead);

        renderCache.model = {
            dataDirty: true,
            tracks: mappedTracks,
            selectedTrackId: trackState?.selectedTrackId ?? null,
            selectedClipId: ws?.selectedClipId ?? null,
            selectedClipIds: ws?.selectedClipIds ?? [],
            playheadPosition: playhead,
            viewportStartBeat,
            viewportEndBeat: viewportStartBeat + defaultViewportWidth() / pixelsPerBeat,
            beatsPerPixel: 1 / pixelsPerBeat,
            pixelsPerBeat,
            trackHeight,
            scrollY: viewState?.scrollY ?? 0,
            tempo: transportState?.tempo ?? 120,
            timeSignatureNumerator: numerator,
            timeSignatureDenominator: denominator,
        };
    } else {
        renderCache.model!.dataDirty = false;
        const playhead = playheadPositionRef.current;
        renderCache.model!.playheadPosition = playhead;
        // Keep the playhead-dependent time signature fresh on cache hits too,
        // so crossing a time-signature change during playback still updates the
        // renderer's bar spacing without rebuilding the whole track/clip tree.
        const { numerator, denominator } = getTimeSignatureAtBeat(playhead);
        renderCache.model!.timeSignatureNumerator = numerator;
        renderCache.model!.timeSignatureDenominator = denominator;
    }

    let cachedModel = renderCache.model!;

    // Recording overlay — mutate only the recording clip's endBeat, not the whole tree.
    const recClips = activeRecordingRef.current;
    if (recClips.length > 0) {
        // Drift invariant: Transport says we are not recording but the
        // recording ref still holds clip IDs, meaning a stop path left clips
        // un-finalised. Surface once so a broken finalisation is visible
        // without spamming every rAF.
        if (transportState && transportState.isRecording === false && !recordingInvariantReported) {
            recordingInvariantReported = true;
            logger.warn(
                `[recording] drift detected — transportStore.isRecording=false but activeRecordingRef has ${recClips.length} clip(s): ${recClips.join(', ')}`
            );
        }
        return applyRecordingOverlay(cachedModel, recClips);
    }

    recordingInvariantReported = false;

    cachedModel = applyInlineMidiNotePreview(cachedModel);

    const preview = clipDragPreviewRef.current;
    if (!preview || preview.positions.size === 0) {
        return cachedModel;
    }

    // Build a clipById Map for O(1) lookup during drag preview.
    const clipById = new Map<string, ClipRenderModel>();
    for (const track of cachedModel.tracks) {
        for (const clip of track.clips) {
            clipById.set(clip.id, clip);
        }
    }

    const previewTracks = cachedModel.tracks.map((track) => {
        const clips: ClipRenderModel[] = [];
        for (const [clipId, pos] of preview.positions.entries()) {
            if (pos.trackId === track.id) {
                const base = clipById.get(clipId);
                if (base) {
                    clips.push({
                        ...base,
                        startBeat: pos.startBeat,
                        endBeat: pos.endBeat,
                        audioOffsetBeats: pos.audioOffsetBeats ?? base.audioOffsetBeats,
                        midiOffsetBeats: pos.midiOffsetBeats ?? base.midiOffsetBeats,
                    });
                }
            }
        }
        for (const clip of track.clips) {
            if (!preview.positions.has(clip.id)) {
                clips.push(clip);
            }
        }
        return { ...track, clips };
    });

    return { ...cachedModel, tracks: previewTracks, dataDirty: true };
}
