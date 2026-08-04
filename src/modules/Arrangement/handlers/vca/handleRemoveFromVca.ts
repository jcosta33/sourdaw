import { createHandler } from '#/utils/createHandler';

import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { getAllTracks } from '../../useCases/getAllTracks';
import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { removeFromVca } from '../../useCases/vca/removeFromVca';

import { toVcaGainExecutionResult } from './toVcaGainExecutionResult';

export const handleRemoveFromVca = createHandler<'removeFromVca'>({
    execute: (alpha) => {
        const written = removeFromVca(alpha.payload.trackId);
        if (!written) {
            return { status: 'no-write' };
        }
        return toVcaGainExecutionResult({
            groupIds: [],
            trackIds: [alpha.payload.trackId],
            status: 'written',
        });
    },
    describe: (alpha) => {
        const inversePayload = captureLegacyVcaState(alpha);
        const redoPayload = captureLegacyVcaState({ type: 'restoreLegacyVcaState', payload: inversePayload });
        return {
            label: 'Remove from VCA',
            inverseAction: { type: 'restoreLegacyVcaState', payload: inversePayload },
            redoAction: { type: 'restoreLegacyVcaState', payload: redoPayload },
        };
    },
    isNoop: (alpha) => {
        const track = getAllTracks().find((candidate) => candidate.id === alpha.payload.trackId);
        return (
            track !== undefined &&
            (track.vcaGroupId ?? null) === null &&
            getVcaGroupsState().every((group) => !group.trackIds.includes(track.id))
        );
    },
    undoable: true,
});
