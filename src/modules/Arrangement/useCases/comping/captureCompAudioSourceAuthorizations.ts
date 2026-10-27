import { valuesEqual } from '#/utils/structuralEquality';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import {
    captureCompAudioSourceInputProof,
    compAudioSourceOwnerExists,
    type CompAudioSourceInputContext,
} from '../../stores/compAudioSourceInputs';
import { type CompAudioSourceAuthorization } from '../../stores/compAudioSourcePromotions';
import { type TakeLaneCompRegionPatch, type TakeLaneStoreValue } from '../../stores/takeLaneWriteJournal';

import { captureResolvedAudioSourceSnapshot } from './captureResolvedAudioSourceSnapshot';
import { resolveCompBaseGapWindow } from './resolveCompBaseGapWindow';
import { resolveCompingProgramme } from './resolveCompingProgramme';

/** Re-evaluate the real producer synchronously. Public snapshot hashes cannot
 * grant permission to convert complements outside the requested selection. */
export function captureCompAudioSourceAuthorizations(
    state: TakeLaneStoreValue,
    patch: TakeLaneCompRegionPatch,
    clips: Clip[],
    timeline: TempoTimeline,
    context: CompAudioSourceInputContext
): readonly CompAudioSourceAuthorization[] | null {
    const lane = state.lanes.find((candidate) => candidate.id === patch.laneId && candidate.trackId === patch.trackId);
    if (!lane) {
        return null;
    }
    const authorizations: CompAudioSourceAuthorization[] = [];
    for (const delta of patch.audioSourcePromotions ?? []) {
        const owner = delta.expected;
        const source = owner.audioSource ?? delta.replacement.audioSource;
        if (!source || !compAudioSourceOwnerExists(lane, owner, delta.sourceInputs, context)) {
            return null;
        }
        const take = owner.kind === 'take' ? lane.takes.find((candidate) => candidate.id === owner.takeId) : undefined;
        let clipId: string | undefined;
        if (owner.kind === 'base') {
            clipId = owner.clipId;
        } else {
            clipId = take?.clipId;
        }
        const clip = clips.find((candidate) => candidate.id === clipId && candidate.type === 'audio');
        if (!clip || take?.passAnchorSeconds !== undefined) {
            return null;
        }
        let fragment;
        if (owner.kind === 'base') {
            fragment = resolveCompBaseGapWindow(clip, { startBeat: owner.startBeat, endBeat: owner.endBeat }, timeline);
        } else {
            fragment = resolveCompingProgramme(
                patch.trackId,
                clips,
                {
                    lanes: [
                        {
                            ...lane,
                            activeCompRegions: [
                                { startBeat: owner.startBeat, endBeat: owner.endBeat, takeId: owner.takeId },
                            ],
                        },
                    ],
                },
                timeline
            ).find(
                (candidate) =>
                    candidate.id === clipId &&
                    candidate.startBeat >= owner.startBeat &&
                    candidate.endBeat <= owner.endBeat
            );
        }
        const currentSource = fragment ? captureResolvedAudioSourceSnapshot(fragment, timeline) : null;
        const sourceInputs = captureCompAudioSourceInputProof(lane, owner, context);
        if (!sourceInputs) {
            return null;
        }
        let operation: CompAudioSourceAuthorization['operation'];
        if (!valuesEqual(currentSource, source)) {
            operation = 'preserve';
        } else if (delta.replacement.audioSource === undefined) {
            operation = 'demote';
        } else {
            operation = 'promote';
        }
        authorizations.push({
            owner: structuredClone(owner),
            source: structuredClone(source),
            sourceInputs,
            operation,
        });
    }
    return authorizations;
}
