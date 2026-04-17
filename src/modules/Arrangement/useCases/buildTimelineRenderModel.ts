import { trackStore } from '../stores/trackStore';
import { transportStore, playheadPositionRef } from '#/modules/Transport/stores';
import { timelineViewStore } from '../stores/timelineViewStore';
import { midiStore } from '#/modules/MIDI/stores';
import { workspaceStore, preferencesStore } from '#/modules/Workspace/stores';
import { TRACK_HEIGHT_VALUES } from '#/modules/Workspace/useCases';
import {
    type TimelineRenderModel,
    type TrackRenderModel,
    type ClipRenderModel,
} from '../models/TimelineRenderModel';
import { clipDragPreviewRef } from '../stores/clipDragPreviewRef';
import { activeRecordingRef } from '../stores/activeRecordingRef';
import { timeSignatureMapStore, getTimeSignatureAtBeat } from '#/modules/Transport';
import { logger } from '#/app/registerDependencies';

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

function applyRecordingOverlay(
    cachedModel: TimelineRenderModel,
    recClips: readonly string[]
): TimelineRenderModel {
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

    return { ...cachedModel, tracks: recordingOverlayCache.tracks!, dataDirty: true };
}

// §74.1 — Coalesce stores into memoization holder.
const renderCache: {
    model: TimelineRenderModel | null;
    track: unknown;
    view: unknown;
    midi: unknown;
    ws: unknown;
    prefs: unknown;
    transport: unknown;
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

export function buildTimelineRenderModel(): TimelineRenderModel {
    const trackState = trackStore.value;
    const viewState = timelineViewStore.value;
    const transportState = transportStore.value;
    const midiState = midiStore.value;
    const ws = workspaceStore.value;
    const prefs = preferencesStore.value;
    const timeSigState = timeSignatureMapStore.value;

    const dataChanged =
        !renderCache.model ||
        trackState !== renderCache.track ||
        viewState !== renderCache.view ||
        midiState !== renderCache.midi ||
        ws !== renderCache.ws ||
        prefs !== renderCache.prefs ||
        transportState !== renderCache.transport ||
        timeSigState !== renderCache.timeSig;

    if (dataChanged) {
        renderCache.track = trackState;
        renderCache.view = viewState;
        renderCache.midi = midiState;
        renderCache.ws = ws;
        renderCache.prefs = prefs;
        renderCache.transport = transportState;
        renderCache.timeSig = timeSigState;

        const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
        const scrollX = viewState?.scrollX ?? 0;
        const viewportStartBeat = scrollX / pixelsPerBeat;

        const collapsedFolders = new Set(
            (trackState?.tracks ?? []).filter((t) => t.kind === 'folder' && t.collapsed).map((t) => t.id)
        );
        const visibleTracks = (trackState?.tracks ?? []).filter((t) => {
            if (t.kind === 'master') return false;
            if (!t.parentId) return true;
            return !collapsedFolders.has(t.parentId);
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
                    midiNotes: notes.map((n) => ({
                        id: n.id,
                        pitch: n.pitch,
                        startBeat: n.startBeat,
                        duration: n.duration,
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
            const ghosts = (trackState?.ghostClips ?? []).filter((g) => g.trackId === track.id);
            for (const ghost of ghosts) {
                mappedClips.push({
                    id: ghost.id,
                    startBeat: ghost.startBeat,
                    endBeat: ghost.endBeat,
                    name: ghost.name,
                    color: ghost.color || '#3b82f6',
                    type: ghost.type,
                    muted: ghost.muted,
                    midiNotes: (midiState?.notesByClipId[ghost.id] ?? []).map((n) => ({
                        id: n.id,
                        pitch: n.pitch,
                        startBeat: n.startBeat,
                        duration: n.duration,
                    })),
                    audioBufferId: ghost.audioBufferId,
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
                                  midiNotes: notes.map((n) => ({
                                      id: n.id,
                                      pitch: n.pitch,
                                      startBeat: n.startBeat,
                                      duration: n.duration,
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
        renderCache.model!.playheadPosition = playheadPositionRef.current;
    }

    const cachedModel = renderCache.model!;

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
