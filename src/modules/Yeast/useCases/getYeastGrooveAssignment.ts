import { getScopedGrooveAssignment } from '#/modules/MIDI/useCases';

export const YEAST_GROOVE_OWNER_ID = 'yeast-rack';

export function getYeastGrooveAssignment(processorId: string) {
    return getScopedGrooveAssignment({
        consumerType: 'yeast-processor',
        ownerId: YEAST_GROOVE_OWNER_ID,
        localId: processorId,
    });
}
