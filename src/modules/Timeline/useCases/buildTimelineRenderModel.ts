import { trackStore } from "#/modules/Track/stores/trackStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { timelineViewStore } from "../stores/timelineViewStore";
import type { TimelineRenderModel } from "../models/TimelineRenderModel";

export const buildTimelineRenderModel = (): TimelineRenderModel => {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    const viewState = timelineViewStore.value;

    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;
    const viewportStartBeat = scrollX / pixelsPerBeat;

    const tracks = (trackState?.tracks ?? []).map((track, index) => ({
        id: track.id,
        name: track.name,
        index,
        kind: track.kind,
        muted: track.muted,
        soloed: track.soloed,
        clips: track.clips.map((clip) => ({
            id: clip.id,
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            name: clip.name,
            color: track.color,
        })),
    }));

    return {
        tracks,
        playheadPosition: transportState?.playheadPosition ?? 0,
        viewportStartBeat,
        viewportEndBeat: viewportStartBeat + 256,
        beatsPerPixel: 1 / pixelsPerBeat,
        pixelsPerBeat,
        trackHeight: 64,
        tempo: transportState?.tempo ?? 120,
        timeSignatureNumerator: transportState?.timeSignatureNumerator ?? 4,
        timeSignatureDenominator: transportState?.timeSignatureDenominator ?? 4,
    };
};
