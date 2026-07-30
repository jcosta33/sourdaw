import { createHandler } from '#/utils/createHandler';

import { handleAddTrack } from './handleAddTrack';

type CreateBusAction = { payload: { busId?: string; name: string } };

function ensureBusId(action: CreateBusAction): string {
    if (action.payload.busId) {
        return action.payload.busId;
    }
    const busId = `bus-ai-${crypto.randomUUID()}`;
    action.payload.busId = busId;
    return busId;
}

function toAddTrackAction(action: CreateBusAction): Parameters<typeof handleAddTrack.execute>[0] {
    return {
        type: 'addTrack',
        payload: {
            id: ensureBusId(action),
            name: action.payload.name,
            kind: 'bus',
        },
    };
}

export const handleCreateBus = createHandler<'createBus'>({
    execute: (action) => handleAddTrack.execute(toAddTrackAction(action)),
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
