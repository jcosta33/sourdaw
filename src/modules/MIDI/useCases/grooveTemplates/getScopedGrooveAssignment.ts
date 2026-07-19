import { canonicalizeGrooveConsumerId, type GrooveConsumerType } from '../../models/GrooveTemplateState';

import { getGrooveAssignment } from './getGrooveAssignment';
import { getScopedGrooveConsumerId } from './getScopedGrooveConsumerId';

type GetScopedGrooveAssignmentInput = {
    consumerType: GrooveConsumerType;
    ownerId: string;
    localId: string;
};

export function getScopedGrooveAssignment({ consumerType, ownerId, localId }: GetScopedGrooveAssignmentInput) {
    const consumerId = getScopedGrooveConsumerId({ ownerId, localId });
    const scopedAssignment = getGrooveAssignment({ consumerType, consumerId });
    if (scopedAssignment) {
        return scopedAssignment;
    }
    const legacyConsumerId = canonicalizeGrooveConsumerId(localId);
    return legacyConsumerId ? getGrooveAssignment({ consumerType, consumerId: legacyConsumerId }) : undefined;
}
