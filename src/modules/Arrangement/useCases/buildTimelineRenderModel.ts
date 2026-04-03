import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { timelineViewStore } from '../stores/timelineViewStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { preferencesStore } from '#/modules/Workspace/stores/preferencesStore';
import { type TimelineRenderModel } from '../models/TimelineRenderModel';
import { TRACK_HEIGHT_VALUES } from '#/modules/Workspace/useCases/workspaceQueries';
import { clipDragPreviewRef } from '../stores/clipDragPreviewRef';
import { activeRecordingRef } from '../stores/activeRecordingRef';

let cachedModel: TimelineRenderModel | null = null;
let lastTrackState: any = null;
let lastViewState: any = null;
let lastMidiState: any = null;
let lastWsState: any = null;
let lastPrefsState: any = null;
let lastTransportState: any = null;

export function buildTimelineRenderModel(): TimelineRenderModel {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const viewState = timelineViewStore.value;
    const midiState = midiStore.value;
    const ws = workspaceStore.value;
    const prefs = preferencesStore.value;

    const dataChanged =
        !cachedModel ||
        trackState !== lastTrackState ||
        viewState !== lastViewState ||
        midiState !== lastMidiState ||
        ws !== lastWsState ||
        prefs !== lastPrefsState ||
        transportState !== lastTransportState;

    if (dataChanged) {
        lastTrackState = trackState;
        lastViewState = viewState;
        lastMidiState = midiState;
        lastWsState = ws;
        lastPrefsState = prefs;
        lastTransportState = transportState;

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

        const tracks = visibleTracks.map((track, index) => {
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
                        midiNotes: notes.map((n) => ({ pitch: n.pitch, startBeat: n.startBeat, duration: n.duration })),
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

        cachedModel = {
            dataDirty: true,
            tracks,
            selectedTrackId: trackState?.selectedTrackId ?? null,
            selectedClipId: ws?.selectedClipId ?? null,
            selectedClipIds: ws?.selectedClipIds ?? [],
            playheadPosition: playheadPositionRef.current,
            viewportStartBeat,
            viewportEndBeat: viewportStartBeat + window.innerWidth / pixelsPerBeat,
            beatsPerPixel: 1 / pixelsPerBeat,
            pixelsPerBeat,
            trackHeight,
            scrollY: viewState?.scrollY ?? 0,
            tempo: transportState?.tempo ?? 120,
            timeSignatureNumerator: transportState?.timeSignatureNumerator ?? 4,
            timeSignatureDenominator: transportState?.timeSignatureDenominator ?? 4,
        };
    } else {
        // Fast path: only playhead has changed (or nothing at all)
        cachedModel!.dataDirty = false;
        cachedModel!.playheadPosition = playheadPositionRef.current;
    }

    // Apply live recording clip growth — expand endBeat to current playhead position.
    // This runs on every rAF tick (playheadPositionRef changes) so the clip appears
    // to grow in real-time without any store writes.
    const recClips = activeRecordingRef.current;
    if (recClips.length > 0) {
        const liveEnd = playheadPositionRef.current;
        const recIds = new Set(recClips);
        const recTracks = cachedModel!.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) =>
                recIds.has(clip.id) ? { ...clip, endBeat: Math.max(clip.startBeat, liveEnd) } : clip
            ),
        }));
        return { ...cachedModel!, tracks: recTracks, dataDirty: true };
    }

    // Apply ephemeral clip drag preview without touching the cache or any store
    const preview = clipDragPreviewRef.current;
    if (!preview || preview.positions.size === 0) {
        return cachedModel!;
    }

    // Build flat lookup of all clips across cached tracks
    type CachedClip = TimelineRenderModel['tracks'][0]['clips'][0];
    const clipById = new Map<string, CachedClip>();
    for (const track of cachedModel!.tracks) {
        for (const clip of track.clips) {
            clipById.set(clip.id, clip);
        }
    }

    const previewTracks = cachedModel!.tracks.map((track) => {
        const clips: CachedClip[] = [];
        // Add clips whose preview destination is this track
        for (const [clipId, pos] of preview.positions) {
            if (pos.trackId === track.id) {
                const base = clipById.get(clipId);
                if (base) {
                    clips.push({ ...base, startBeat: pos.startBeat, endBeat: pos.endBeat });
                }
            }
        }
        // Add clips not involved in the preview that originally live here
        for (const clip of track.clips) {
            if (!preview.positions.has(clip.id)) {
                clips.push(clip);
            }
        }
        return { ...track, clips };
    });

    return { ...cachedModel!, tracks: previewTracks, dataDirty: true };
}
