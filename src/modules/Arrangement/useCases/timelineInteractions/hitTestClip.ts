import { inject } from '#/infra/di/inject';
import { timelineViewStore } from '../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';
import { getTrackAtY } from './getTrackAtY';

const RULER_HEIGHT = 0;

export const hitTestClipDependencies = {
    timelineViewStore,
    buildTimelineRenderModel,
    getTrackAtY,
} as const;

export const hitTestClip = inject(hitTestClipDependencies)(
    ({ timelineViewStore: viewStore, buildTimelineRenderModel: buildModel, getTrackAtY: trackAtY }) =>
        function hitTestClip(canvasX: number, canvasY: number): { clipId: string; trackId: string } | null {
            const viewState = viewStore.value;
            const model = buildModel();
            if (!viewState || !model) {
                return null;
            }

            const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0));
            const hit = trackAtY(model.tracks, contentY);
            if (!hit) {
                return null;
            }

            const track = model.tracks[hit.index];
            if (!track) {
                return null;
            }

            const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
            const beat = canvasX / viewState.pixelsPerBeat + viewportStartBeat;

            for (const clip of track.clips) {
                if (beat >= clip.startBeat && beat <= clip.endBeat) {
                    return { clipId: clip.id, trackId: track.id };
                }
            }

            return null;
        }
);

export const hitTestTrack = inject(hitTestClipDependencies)(
    ({ timelineViewStore: viewStore, buildTimelineRenderModel: buildModel, getTrackAtY: trackAtY }) =>
        function hitTestTrack(canvasY: number): string | null {
            const viewState = viewStore.value;
            const model = buildModel();
            if (!model) {
                return null;
            }

            const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState?.scrollY ?? 0));
            const hit = trackAtY(model.tracks, contentY);
            return hit?.id ?? null;
        }
);
