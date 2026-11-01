import { type AppAction } from '#/utils/handlerContract';

import { type TempoTimeline } from '../models/TempoTimeline';
import { takeLaneStore } from '../stores/takeLaneStore';

import { projectClipReplayPrefix } from './clipEditing/projectClipReplayPrefix';
import { captureCurrentTempoAudioSources } from './comping/captureCurrentTempoAudioSources';
import { getTrackStoreState } from './getTrackStoreState';

/** Capture current live source owners against the caller's immutable old map. */
export function prepareTempoAudioSources(input: {
    readonly timeline: TempoTimeline;
    readonly priorActions?: readonly AppAction[];
}) {
    if (input.priorActions?.length) {
        const prefix = projectClipReplayPrefix(input.priorActions);
        return prefix?.tracks ? captureCurrentTempoAudioSources(prefix.tracks, prefix.takeLanes, input.timeline) : null;
    }
    return captureCurrentTempoAudioSources(
        getTrackStoreState()?.tracks ?? [],
        takeLaneStore.value?.lanes ?? [],
        input.timeline
    );
}
