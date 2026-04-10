import { inject } from '#/infra/di/inject';
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

function defaultViewportWidth(): number {
    return typeof window !== 'undefined' ? window.innerWidth : 1920;
}

const buildTimelineRenderModelDependencies = {
    trackStore,
    transportStore,
    playheadPositionRef,
    timelineViewStore,
    midiStore,
    workspaceStore,
    preferencesStore,
    clipDragPreviewRef,
    activeRecordingRef,
    TRACK_HEIGHT_VALUES,
    getViewportWidth: defaultViewportWidth,
} as const;

let cachedModel: TimelineRenderModel | null = null;
let lastTrackState: unknown = null;
let lastViewState: unknown = null;
let lastMidiState: unknown = null;
let lastWsState: unknown = null;
let lastPrefsState: unknown = null;
let lastTransportState: unknown = null;

export const buildTimelineRenderModel = inject(buildTimelineRenderModelDependencies)(
    ({
        trackStore: tracks,
        transportStore: transport,
        playheadPositionRef: playheadRef,
        timelineViewStore: viewStore,
        midiStore: midi,
        workspaceStore: wsStore,
        preferencesStore: prefsStore,
        clipDragPreviewRef: previewRef,
        activeRecordingRef: recordingRef,
        TRACK_HEIGHT_VALUES: heightByPreference,
        getViewportWidth,
    }) =>
        function buildTimelineRenderModel(): TimelineRenderModel {
            const trackState = tracks.value;
            const transportState = transport.value;
            const viewState = viewStore.value;
            const midiState = midi.value;
            const ws = wsStore.value;
            const prefs = prefsStore.value;

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

                const trackHeight = heightByPreference[prefs?.trackHeight ?? 'normal'];

                cachedModel = {
                    dataDirty: true,
                    tracks: mappedTracks,
                    selectedTrackId: trackState?.selectedTrackId ?? null,
                    selectedClipId: ws?.selectedClipId ?? null,
                    selectedClipIds: ws?.selectedClipIds ?? [],
                    playheadPosition: playheadRef.current,
                    viewportStartBeat,
                    viewportEndBeat: viewportStartBeat + getViewportWidth() / pixelsPerBeat,
                    beatsPerPixel: 1 / pixelsPerBeat,
                    pixelsPerBeat,
                    trackHeight,
                    scrollY: viewState?.scrollY ?? 0,
                    tempo: transportState?.tempo ?? 120,
                    timeSignatureNumerator: transportState?.timeSignatureNumerator ?? 4,
                    timeSignatureDenominator: transportState?.timeSignatureDenominator ?? 4,
                };
            } else {
                cachedModel!.dataDirty = false;
                cachedModel!.playheadPosition = playheadRef.current;
            }

            const recClips = recordingRef.current;
            if (recClips.length > 0) {
                const liveEnd = playheadRef.current;
                const recIds = new Set(recClips);
                const recTracks = cachedModel!.tracks.map((track) => ({
                    ...track,
                    clips: track.clips.map((clip) =>
                        recIds.has(clip.id) ? { ...clip, endBeat: Math.max(clip.startBeat, liveEnd) } : clip
                    ),
                }));
                return { ...cachedModel!, tracks: recTracks, dataDirty: true };
            }

            const preview = previewRef.current;
            if (!preview || preview.positions.size === 0) {
                return cachedModel!;
            }

            type CachedClip = TimelineRenderModel['tracks'][0]['clips'][0];
            const clipById = new Map<string, CachedClip>();
            for (const track of cachedModel!.tracks) {
                for (const clip of track.clips) {
                    clipById.set(clip.id, clip);
                }
            }

            const previewTracks = cachedModel!.tracks.map((track) => {
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

            return { ...cachedModel!, tracks: previewTracks, dataDirty: true };
        }
);
