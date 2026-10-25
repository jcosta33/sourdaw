import { type HandlerValidationContext } from '#/utils/handlerContract';

import { takeLaneStore } from '../stores/takeLaneStore';
import { trackStore } from '../stores/trackStore';
import { runWithTempoAudioSourceTrackIntent } from '../stores/tempoAudioSourceWriteIntent';
import { runWithTakeLaneWriteIntent } from '../stores/takeLaneWriteJournal';

import { prepareTempoAudioSourceWrite } from './comping/prepareTempoAudioSourceWrite';
import { prepareAudioSourcePrefixWitness } from './clipEditing/prepareAudioSourcePrefixWitness';

/** Source-only facets join the caller's existing project transaction. Private
 * intent is minted at each synchronous set, before listeners can run. */
export function applyTempoAudioSources(
    input: Parameters<typeof prepareTempoAudioSourceWrite>[0] & {
        readonly context?: Pick<HandlerValidationContext, 'actions' | 'actionIndex'>;
    }
) {
    const prepared = prepareTempoAudioSourceWrite(input);
    if (!prepared) {
        return { status: 'conflict' as const };
    }
    const { tracks, lanes, projected } = prepared;
    const needsTracks = prepared.intent.promotion.clips.length > 0;
    const needsLanes =
        prepared.intent.promotion.takes.length +
            prepared.intent.promotion.regions.length +
            prepared.intent.promotion.gaps.length >
        0;
    if ((needsTracks && !tracks) || (needsLanes && !lanes)) {
        return { status: 'conflict' as const };
    }
    const witness = prepareAudioSourcePrefixWitness(input);
    if (!witness) {
        return { status: 'conflict' as const };
    }
    const intent = { ...prepared.intent, ownerWitness: witness.ownerWitness };
    try {
        if (needsTracks && tracks) {
            runWithTempoAudioSourceTrackIntent(intent, () => trackStore.set({ ...tracks, tracks: projected.tracks }));
        }
        if (needsLanes && lanes) {
            runWithTakeLaneWriteIntent({ kind: 'tempo-audio-sources', intent }, () =>
                takeLaneStore.set({ ...lanes, lanes: projected.lanes })
            );
        }
        return {
            status: 'written' as const,
            sourcePreservation: {
                promotion: intent.promotion,
                direction: intent.direction,
                ownerWitness: witness.ownerWitness,
            },
            commitValidation: witness.commitValidation,
        };
    } catch (error) {
        witness.commitValidation.release();
        throw error;
    }
}
