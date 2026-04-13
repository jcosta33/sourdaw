import { trackStore } from '../stores/trackStore';
import { transportStore, playheadPositionRef } from '#/modules/Transport/stores';
import { timelineViewStore } from '../stores/timelineViewStore';
import { midiStore } from '#/modules/MIDI/stores';
import { workspaceStore, preferencesStore } from '#/modules/Workspace/stores';
import { TRACK_HEIGHT_VALUES } from '#/modules/Workspace/useCases';
import { type TimelineRenderModel } from '../models/TimelineRenderModel';
import { clipDragPreviewRef } from '../stores/clipDragPreviewRef';
import { activeRecordingRef } from '../stores/activeRecordingRef';

function defaultViewportWidth(): number {
    return typeof window !== 'undefined' ? window.innerWidth : 1920;
}

// §74.1 — Coalesce 7 module-level mutables into a single memoization
// holder. This is a render-model cache: every field is an identity
// snapshot of the corresponding store at the moment \`cachedModel\` was
// built, so the next call can short-circuit when every store value is
// still the same reference.
const renderCache: {
    model: TimelineRenderModel | null;
    track: unknown;
    view: unknown;
    midi: unknown;
    ws: unknown;
    prefs: unknown;
    transport: unknown;
} = {
    model: null,
    track: null,
    view: null,
    midi: null,
    ws: null,
    prefs: null,
    transport: null,
};

export function buildTimelineRenderModel(): TimelineRenderModel {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const viewState = timelineViewStore.value;
    const midiState = midiStore.value;
    const ws = workspaceStore.value;
    const prefs = preferencesStore.value;

    const dataChanged =
        !renderCache.model ||
        trackState !== renderCache.track ||
        viewState !== renderCache.view ||
        midiState !== renderCache.midi ||
        ws !== renderCache.ws ||
        prefs !== renderCache.prefs ||
        transportState !== renderCache.transport;

    if (dataChanged) {
        renderCache.track = trackState;
        renderCache.view = viewState;
        renderCache.midi = midiState;
        renderCache.ws = ws;
        renderCache.prefs = prefs;
        renderCache.transport = transportState;

        const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
        const scrollX = viewState?.scrollX ?? 0;
        const viewportStartBeat = scrollX / pixelsPerBeat;

        const collapsedFolders = new Set(
            (trackState?.tracks ?? []).filter((t) => t.kind === 'folder' && t.collapsed).map((t) => t.id)
        );
        const visibleTracks = (trackState?.tracks ?? []).filter((t) => {
            if (t.kind === 'master') {
                return false;
            }
            if (!t.parentId) {
                return true;
            }
            return !collapsedFolders.has(t.parentId);
        });

        const mappedTracks = visibleTracks.map((track, index) => {
            const baseHeight = track.kind === 'folder' ? 26 : track.height;

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
                clips: track.clips.map((clip) => {
                    const notes = clip.type === 'midi' ? (midiState?.notesByClipId[clip.id] ?? []) : [];
                    return {
                        id: clip.id,
                        startBeat: clip.startBeat,
                        endBeat: clip.endBeat,
                        name: clip.name,
                        color: clip.color || track.color,
                        type: clip.type,
                        muted: clip.muted,
                        midiNotes: notes.map((n) => ({
                            pitch: n.pitch,
                            startBeat: n.startBeat,
                            duration: n.duration,
                        })),
                        audioBufferId: clip.audioBufferId,
                        loopEnabled: clip.loopEnabled,
                        loopLength: clip.loopLength,
                        fadeInBeats: clip.fadeInBeats,
                        fadeOutBeats: clip.fadeOutBeats,
                        generating: clip.generating,
                        isGhost: clip.isGhost,
                        isLinkedInstance: !!clip.parentClipId,
                    };
                }),
            };
        });

        const trackHeight = TRACK_HEIGHT_VALUES[prefs?.trackHeight ?? 'normal'];

        renderCache.model = {
            dataDirty: true,
            tracks: mappedTracks,
            selectedTrackId: trackState?.selectedTrackId ?? null,
            selectedClipId: ws?.selectedClipId ?? null,
            selectedClipIds: ws?.selectedClipIds ?? [],
            playheadPosition: playheadPositionRef.current,
            viewportStartBeat,
            viewportEndBeat: viewportStartBeat + defaultViewportWidth() / pixelsPerBeat,
            beatsPerPixel: 1 / pixelsPerBeat,
            pixelsPerBeat,
            trackHeight,
            scrollY: viewState?.scrollY ?? 0,
            tempo: transportState?.tempo ?? 120,
            timeSignatureNumerator: transportState?.timeSignatureNumerator ?? 4,
            timeSignatureDenominator: transportState?.timeSignatureDenominator ?? 4,
        };
    } else {
        renderCache.model!.dataDirty = false;
        renderCache.model!.playheadPosition = playheadPositionRef.current;
    }

    const cachedModel = renderCache.model!;

    const recClips = activeRecordingRef.current;
    if (recClips.length > 0) {
        const liveEnd = playheadPositionRef.current;
        const recIds = new Set(recClips);
        // Only rebuild tracks that actually contain a recording clip
        const recTracks = cachedModel.tracks.map((track) => {
            const hasRecClip = track.clips.some((clip) => recIds.has(clip.id));
            if (!hasRecClip) {
                return track;
            }
            return {
                ...track,
                clips: track.clips.map((clip) =>
                    recIds.has(clip.id) ? { ...clip, endBeat: Math.max(clip.startBeat, liveEnd) } : clip
                ),
            };
        });
        return { ...cachedModel, tracks: recTracks, dataDirty: true };
    }

    const preview = clipDragPreviewRef.current;
    if (!preview || preview.positions.size === 0) {
        return cachedModel;
    }

    type CachedClip = TimelineRenderModel['tracks'][0]['clips'][0];
    const clipById = new Map<string, CachedClip>();
    for (const track of cachedModel.tracks) {
        for (const clip of track.clips) {
            clipById.set(clip.id, clip);
        }
    }

    const previewTracks = cachedModel.tracks.map((track) => {
        const clips: CachedClip[] = [];
        for (const [clipId, pos] of preview.positions) {
            if (pos.trackId === track.id) {
                const base = clipById.get(clipId);
                if (base) {
                    clips.push({ ...base, startBeat: pos.startBeat, endBeat: pos.endBeat });
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
