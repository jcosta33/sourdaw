import { trackStore } from '#/modules/Arrangement/stores';
import { type LibrarySamplePayload, placeLibrarySample } from '#/modules/Arrangement/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { captureGestureBeat } from '#/modules/Transport/stores';
import { isClipCompatibleWithTrackKind } from '#/utils/isClipCompatibleWithTrackKind';

/**
 * The track a browser "add" lands on: the selected track when it takes audio
 * clips, else none, so the sample gets a new audio track (an instrument track
 * is never given an audio clip, as in other DAWs).
 */
function resolveSelectedAudioTrackId(): string | undefined {
    const state = trackStore.value;
    const selected = state?.tracks.find((track) => track.id === state.selectedTrackId);
    if (!selected || !isClipCompatibleWithTrackKind('audio', selected.kind)) {
        return undefined;
    }
    return selected.id;
}

/** Places a browser sample, via the one placement use case the timeline drop also uses, at the playhead. */
export async function addBrowserSample(sample: LibrarySamplePayload): Promise<void> {
    await placeLibrarySample({
        sample,
        placement: { trackId: resolveSelectedAudioTrackId(), startBeat: captureGestureBeat() },
        authority: captureProjectTransitionAuthority(),
        origin: 'browser-add',
    });
}
