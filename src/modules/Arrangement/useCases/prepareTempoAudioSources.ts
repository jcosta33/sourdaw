import { type TempoTimeline } from '../models/TempoTimeline';
import { takeLaneStore } from '../stores/takeLaneStore';

import { captureTempoAudioSources } from './comping/captureTempoAudioSources';
import { getTrackStoreState } from './getTrackStoreState';

/** Capture current live source owners against the caller's immutable old map. */
export function prepareTempoAudioSources(input: { readonly timeline: TempoTimeline }) {
    return captureTempoAudioSources(
        getTrackStoreState()?.tracks ?? [],
        takeLaneStore.value?.lanes ?? [],
        input.timeline
    );
}
