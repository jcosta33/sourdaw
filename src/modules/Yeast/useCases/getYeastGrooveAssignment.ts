import { type GrooveTemplateState } from '#/modules/MIDI/stores';
import { getScopedGrooveAssignment } from '#/modules/MIDI/useCases';

export const YEAST_GROOVE_OWNER_ID = 'yeast-rack';

export function getYeastGrooveAssignment(processorId: string, state?: GrooveTemplateState | null) {
    return getScopedGrooveAssignment(
        {
            consumerType: 'yeast-processor',
            ownerId: YEAST_GROOVE_OWNER_ID,
            localId: processorId,
        },
        state
    );
}
