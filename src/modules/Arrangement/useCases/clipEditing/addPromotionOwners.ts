import { type AppAction } from '#/utils/handlerContract';

import { CLIP_SOURCE_FIELDS, TAKE_SOURCE_FIELDS } from '../../models/TempoSourceOwnerFields';

import { addSourceOwner, type OwnerFields } from './addSourceOwner';

type PromotionPlan = Extract<AppAction, { type: 'restoreTempoEdit' }>['payload']['audioSourcePromotion'];

export function addPromotionOwners(owners: Map<string, OwnerFields>, plan: PromotionPlan): void {
    for (const clip of plan.clips) {
        addSourceOwner(
            owners,
            {
                kind: 'clip',
                trackId: clip.trackId,
                collection: clip.collection,
                alternativeId: clip.alternativeId,
                clipId: clip.clipId,
            },
            CLIP_SOURCE_FIELDS
        );
    }
    for (const take of plan.takes) {
        addSourceOwner(
            owners,
            {
                kind: 'take',
                trackId: take.trackId,
                laneId: take.laneId,
                takeId: take.takeId,
            },
            TAKE_SOURCE_FIELDS
        );
    }
    for (const region of plan.regions) {
        addSourceOwner(
            owners,
            {
                kind: 'region',
                trackId: region.trackId,
                laneId: region.laneId,
                takeId: region.takeId,
                startBeat: region.startBeat,
                endBeat: region.endBeat,
            },
            ['takeId', 'startBeat', 'endBeat', 'audioSource']
        );
    }
    for (const gap of plan.gaps) {
        addSourceOwner(
            owners,
            {
                kind: 'gap',
                trackId: gap.trackId,
                laneId: gap.laneId,
                clipId: gap.clipId,
                startBeat: gap.startBeat,
                endBeat: gap.endBeat,
            },
            ['clipId', 'startBeat', 'endBeat', 'audioSource']
        );
    }
}
