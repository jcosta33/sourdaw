import { getUniversalTrackControlIntentPhrases } from './getUniversalTrackControlIntentPhrases';
import { hasReferenceOutsideMatchedIntent } from './hasReferenceOutsideMatchedIntent';
import { hasTrackControlRestriction } from './hasTrackControlRestriction';

type TrackControlRestrictionContext = {
    tracks: readonly { id: string; name: string }[];
};

export function hasRestrictedTrackControlScope(prompt: string, context: TrackControlRestrictionContext): boolean {
    const intentPhrases = getUniversalTrackControlIntentPhrases(prompt);
    if (intentPhrases.length === 0) {
        return false;
    }
    if (hasTrackControlRestriction(prompt)) {
        return true;
    }
    const trackReferences = context.tracks.flatMap((track) => [track.id, track.name]);
    return intentPhrases.some((intentPhrase) =>
        trackReferences.some((reference) => hasReferenceOutsideMatchedIntent(prompt, intentPhrase, reference))
    );
}
