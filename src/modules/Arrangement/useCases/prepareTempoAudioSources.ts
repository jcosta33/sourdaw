import { type TempoTimeline } from '../models/TempoTimeline';
import { type AppAction } from '#/utils/handlerContract';
import { takeLaneStore } from '../stores/takeLaneStore';

import { captureTempoAudioSources } from './comping/captureTempoAudioSources';
import { getTrackStoreState } from './getTrackStoreState';
import { projectClipReplayPrefix } from './clipEditing/projectClipReplayPrefix';

/** Capture current live source owners against the caller's immutable old map. */
export function prepareTempoAudioSources(input: {
    readonly timeline: TempoTimeline;
    readonly priorActions?: readonly AppAction[];
}) {
    if (input.priorActions?.length) {
        const prefix = projectClipReplayPrefix(input.priorActions);
        return prefix?.tracks ? captureTempoAudioSources(prefix.tracks, prefix.takeLanes, input.timeline) : null;
    }
    return captureTempoAudioSources(
        getTrackStoreState()?.tracks ?? [],
        takeLaneStore.value?.lanes ?? [],
        input.timeline
    );
}
