import { trackStore } from '#/modules/Track/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { timelineViewStore } from '../stores/timelineViewStore';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { preferencesStore } from '#/modules/Workspace/stores/preferencesStore';
import { type TimelineRenderModel } from '../models/TimelineRenderModel';
import { AUTOMATION_SUB_LANE_HEIGHT } from '../models/automationConstants';
import { TRACK_HEIGHT_VALUES } from '#/modules/Workspace/models/Preferences';

export function buildTimelineRenderModel(): TimelineRenderModel {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const viewState = timelineViewStore.value;
    const midiState = midiStore.value;
    const ws = workspaceStore.value;

    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;
    const viewportStartBeat = scrollX / pixelsPerBeat;

    const autoVisible = ws?.automationVisibility !== 'hidden';
    const autoSubLanes = ws?.automationSubLanes ?? {};

    const tracks = (trackState?.tracks ?? []).map((track, index) => {
        const subLaneCount = autoVisible ? (autoSubLanes[track.id]?.length ?? 0) : 0;
        const effectiveHeight = track.height + subLaneCount * AUTOMATION_SUB_LANE_HEIGHT;

        return {
            id: track.id,
            name: track.name,
            index,
            kind: track.kind,
            color: track.color,
            muted: track.muted,
            soloed: track.soloed,
            height: effectiveHeight,
            automationSubLaneCount: subLaneCount,
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
                };
            }),
        };
    });

    const prefs = preferencesStore.value;
    const trackHeight = TRACK_HEIGHT_VALUES[prefs?.trackHeight ?? 'normal'];

    return {
        tracks,
        selectedTrackId: trackState?.selectedTrackId ?? null,
        selectedClipId: ws?.selectedClipId ?? null,
        selectedClipIds: ws?.selectedClipIds ?? [],
        playheadPosition: transportState?.playheadPosition ?? 0,
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
}
