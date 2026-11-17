import { getBestAgentReferenceNameRanges } from '../agentReference/getBestAgentReferenceNameRanges';

type ListedTrack = { id: string; name: string };

/**
 * Whether the words of a phrase also read as the name of a track other than those called `name`
 * ("the second Lead" beside a track "Second Lead" or "Second"): an order word is never offered where
 * it would pick a track the same words name.
 */
export function readsAsAnotherTrack(phrase: string, name: string, tracks: readonly ListedTrack[]): boolean {
    return getBestAgentReferenceNameRanges(phrase, tracks, 'with-number-forms').some((range) => {
        const owner = tracks.find((track) => track.id === range.id);
        return owner !== undefined && owner.name.toLowerCase() !== name.toLowerCase();
    });
}
