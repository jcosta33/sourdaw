import { canPrepareMidiClipGlueState } from '#/modules/MIDI/useCases';

import { createClipWriteTargetIndex } from '../../stores/resolveEligibleClipWriteTarget';
import { getTrackStoreState } from '../getTrackStoreState';

import { getClipIdCensus } from './getClipIdCensus';
import { getMidiClipGlueSources } from './getMidiClipGlueSources';
import { hasClipGlueDependencies } from './hasClipGlueDependencies';
import { isPlainMidiGlueClip } from './isPlainMidiGlueClip';

export function getGlueEligibleClipPairs(): Array<[string, string]> {
    const state = getTrackStoreState();
    if (!state) {
        return [];
    }
    const writeTargets = createClipWriteTargetIndex(state);
    if (writeTargets.status !== 'valid') {
        return [];
    }
    const activeClipIds = writeTargets.tracks.flatMap((owner) => owner.clips.map((clip) => clip.id));
    const clipIdCensus = getClipIdCensus({ clipIds: activeClipIds, state });

    const pairs: Array<[string, string]> = [];
    for (const owner of writeTargets.tracks) {
        if (owner.kind !== 'midi' || !owner.acceptsClipUpdate) {
            continue;
        }
        const track = owner.source;
        const clips = track.clips
            .filter(isPlainMidiGlueClip)
            .toSorted((left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id));
        const clipsByStartBeat = new Map<number, typeof clips>();
        for (const clip of clips) {
            const matching = clipsByStartBeat.get(clip.startBeat) ?? [];
            matching.push(clip);
            clipsByStartBeat.set(clip.startBeat, matching);
        }
        for (const first of clips) {
            for (const second of clipsByStartBeat.get(first.endBeat) ?? []) {
                const clipIds: [string, string] = [first.id, second.id];
                const hasExactActiveOwnership = clipIds.every((clipId) => {
                    const occurrences = clipIdCensus.get(clipId) ?? [];
                    return (
                        occurrences.length === 1 &&
                        occurrences[0]!.location === 'active' &&
                        occurrences[0]!.trackId === owner.id
                    );
                });
                if (!hasExactActiveOwnership) {
                    continue;
                }
                if (hasClipGlueDependencies(clipIds)) {
                    continue;
                }
                const sources = getMidiClipGlueSources({ clips: [first, second], gluedStartBeat: first.startBeat });
                if (canPrepareMidiClipGlueState({ sources })) {
                    pairs.push(clipIds);
                }
            }
        }
    }
    return pairs;
}
