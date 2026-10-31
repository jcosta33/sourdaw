import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { withoutDeferredTempoRecordingSources } from '#/utils/deferredTempoRecordingSources';
import { type HandlerValidationContext } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { takeLaneStore } from '../stores/takeLaneStore';
import { runWithTakeLaneWriteIntent } from '../stores/takeLaneWriteJournal';
import { runWithTempoAudioSourceTrackIntent } from '../stores/tempoAudioSourceWriteIntent';
import { trackStore } from '../stores/trackStore';

import { prepareAudioSourcePrefixWitness } from './clipEditing/prepareAudioSourcePrefixWitness';
import { captureDeferredTempoRecordings } from './comping/captureDeferredTempoRecordings';
import { prepareTempoAudioSourceWrite } from './comping/prepareTempoAudioSourceWrite';

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
    const witness = prepareAudioSourcePrefixWitness(input, projected);
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
                deferredRecordingSources: intent.deferredRecordingSources,
            },
            commitValidation: {
                ...witness.commitValidation,
                beforeCommit: () => {
                    const document = getCrdtDoc('root');
                    const currentDeferred = captureDeferredTempoRecordings(
                        trackStore.value?.tracks ?? [],
                        takeLaneStore.value?.lanes ?? []
                    );
                    if (
                        !valuesEqual([...currentDeferred.clipIds], prepared.deferredRecordingClipIds) ||
                        !prepared.stillOwnsDeferredRecordings() ||
                        !document ||
                        !withoutDeferredTempoRecordingSources(document, intent.deferredRecordingSources)
                    ) {
                        return 'Recording source owner changed before tempo commit';
                    }
                    return witness.commitValidation.beforeCommit?.() ?? null;
                },
                validateDocument: (prospective: Readonly<Record<string, unknown>>) => {
                    const deferred = captureDeferredTempoRecordings(
                        trackStore.value?.tracks ?? [],
                        takeLaneStore.value?.lanes ?? [],
                        prospective
                    );
                    if (
                        !valuesEqual([...deferred.clipIds], prepared.deferredRecordingClipIds) ||
                        !withoutDeferredTempoRecordingSources(prospective, intent.deferredRecordingSources)
                    ) {
                        return 'Recording source owner changed during tempo commit';
                    }
                    return witness.commitValidation.validateDocument?.(prospective) ?? null;
                },
            },
        };
    } catch (error) {
        witness.commitValidation.release();
        throw error;
    }
}
