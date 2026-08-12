import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

import { handleAddTrack } from './handleAddTrack';

type CreateBusAction = {
    payload: {
        busId?: string;
        color?: string;
        initialAlternativeId?: string;
        name: string;
    };
};

function ensureBusId(action: CreateBusAction): string {
    if (action.payload.busId) {
        return action.payload.busId;
    }
    const busId = `bus-ai-${crypto.randomUUID()}`;
    action.payload.busId = busId;
    return busId;
}

function toAddTrackAction(action: CreateBusAction): Parameters<typeof handleAddTrack.execute>[0] {
    const busId = ensureBusId(action);
    return {
        type: 'addTrack',
        payload: {
            id: busId,
            name: action.payload.name,
            kind: 'bus',
            ...(action.payload.color !== undefined ? { color: action.payload.color } : {}),
            ...(action.payload.initialAlternativeId !== undefined
                ? { initialAlternativeId: action.payload.initialAlternativeId }
                : {}),
        },
    };
}

export const handleCreateBus = createHandler<'createBus'>({
    execute: async (action) => {
        const result = await handleAddTrack.execute(toAddTrackAction(action));
        if (result?.status !== 'written') {
            return result;
        }
        const busId = action.payload.busId;
        const createdBus = getTrackStoreState()?.tracks.find((track) => track.id === busId);
        if (createdBus) {
            action.payload.color = createdBus.color;
            action.payload.initialAlternativeId = createdBus.activeAlternativeId;
        }
        return result;
    },
    describe: (action) => {
        const description = handleAddTrack.describe(toAddTrackAction(action));
        return {
            ...description,
            label: `Create bus "${action.payload.name}"`,
        };
    },
    isNoop: (action) => handleAddTrack.isNoop?.(toAddTrackAction(action)) ?? false,
    requiresAbortCompensation: false,
    undoable: true,
});
