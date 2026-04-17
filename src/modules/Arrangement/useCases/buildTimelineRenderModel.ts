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

function defaultViewportWidth(): number {
    return typeof window !== 'undefined' ? window.innerWidth : 1920;
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

// §74.2 — Recording overlay cache: avoid rebuilding all tracks at 60Hz.
// Stores a shallow-cloned tracks array where only the recording clip's endBeat
// is mutated in-place on subsequent frames.
const recordingOverlayCache: {
    tracks: TrackRenderModel[] | null;
    recClipIds: readonly string[] | null;
    recTrackIdx: number;
    recClipIdx: number;
} = {
    tracks: null,
    recClipIds: null,
    recTrackIdx: -1,
    recClipIdx: -1,
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
        const liveEnd = playheadPositionRef.current;
        const cacheStale =
            dataChanged ||
            recordingOverlayCache.recClipIds !== recClips ||
            recordingOverlayCache.tracks === null;

        if (cacheStale) {
            // Build the overlay once: shallow-clone only the affected track + clip.
            const tracks = cachedModel.tracks.slice();
            let foundTrackIdx = -1;
            let foundClipIdx = -1;
            for (let ti = 0; ti < tracks.length; ti++) {
                const track = tracks[ti]!;
                for (let ci = 0; ci < track.clips.length; ci++) {
                    const clip = track.clips[ci]!;
                    if (recClips.includes(clip.id)) {
                        const clonedClips = track.clips.slice();
                        clonedClips[ci] = { ...clip, endBeat: Math.max(clip.startBeat, liveEnd) };
                        tracks[ti] = { ...track, clips: clonedClips };
                        foundTrackIdx = ti;
                        foundClipIdx = ci;
                        break;
                    }
                }
                if (foundTrackIdx !== -1) break;
            }
            recordingOverlayCache.tracks = tracks;
            recordingOverlayCache.recClipIds = recClips;
            recordingOverlayCache.recTrackIdx = foundTrackIdx;
            recordingOverlayCache.recClipIdx = foundClipIdx;
        } else {
            // Fast path: just mutate the endBeat of the already-cloned clip object.
            const ti = recordingOverlayCache.recTrackIdx;
            const ci = recordingOverlayCache.recClipIdx;
            const recTrack = ti >= 0 ? recordingOverlayCache.tracks![ti] : undefined;
            const recClip = recTrack && ci >= 0 ? recTrack.clips[ci] : undefined;
            if (recClip) {
                recClip.endBeat = Math.max(recClip.startBeat, liveEnd);
            }
        }
        return { ...cachedModel, tracks: recordingOverlayCache.tracks!, dataDirty: true };
    }

    // Invalidate recording cache when not recording.
    if (recordingOverlayCache.tracks !== null) {
        recordingOverlayCache.tracks = null;
        recordingOverlayCache.recClipIds = null;
        recordingOverlayCache.recTrackIdx = -1;
        recordingOverlayCache.recClipIdx = -1;
    }

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
