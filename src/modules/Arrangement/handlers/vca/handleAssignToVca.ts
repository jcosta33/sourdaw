import { createHandler } from '#/utils/createHandler';

import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { getAllTracks } from '../../useCases/getAllTracks';
import { assignToVca } from '../../useCases/vca/assignToVca';
import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';

import { toVcaGainExecutionResult } from './toVcaGainExecutionResult';

export const handleAssignToVca = createHandler<'assignToVca'>({
    execute: (alpha) => {
        const written = assignToVca(alpha.payload.trackId, alpha.payload.vcaGroupId);
        if (!written) {
            return { status: 'no-write' };
        }
        return toVcaGainExecutionResult({
            groupIds: [alpha.payload.vcaGroupId],
            trackIds: [alpha.payload.trackId],
            status: 'written',
        });
    },
    describe: (alpha) => {
        const inversePayload = captureLegacyVcaState(alpha);
        const redoPayload = captureLegacyVcaState({ type: 'restoreLegacyVcaState', payload: inversePayload });
        return {
            label: 'Assign to VCA',
            inverseAction: { type: 'restoreLegacyVcaState', payload: inversePayload },
            redoAction: { type: 'restoreLegacyVcaState', payload: redoPayload },
        };
    },
    isNoop: (alpha) => {
        const track = getAllTracks().find((candidate) => candidate.id === alpha.payload.trackId);
        if (!track || track.vcaGroupId !== alpha.payload.vcaGroupId) {
            return false;
        }
        return getVcaGroupsState().every((group) => {
            const membershipCount = group.trackIds.filter((trackId) => trackId === track.id).length;
            return group.id === alpha.payload.vcaGroupId ? membershipCount === 1 : membershipCount === 0;
        });
    },
    undoable: true,
});
