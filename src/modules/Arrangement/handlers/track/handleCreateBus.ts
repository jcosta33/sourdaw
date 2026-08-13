import { createHandler } from '#/utils/createHandler';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

import { handleAddTrack } from './handleAddTrack';

type CreateBusAction = {
    payload: {
        busId?: string;
        color?: string;
        initialGain?: number;
        initialAlternativeId?: string;
        name: string;
        expectedAbsentTrackNames?: readonly string[];
        expectedTrackOutputs?: readonly { trackId: string; outputId: string }[];
    };
};

const pendingCreatedBusGuards = new WeakMap<CreateBusAction, GeneratedMidiStateGuard>();

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
            ...(action.payload.initialGain !== undefined ? { gain: action.payload.initialGain } : {}),
            ...(action.payload.initialAlternativeId !== undefined
                ? { initialAlternativeId: action.payload.initialAlternativeId }
                : {}),
        },
    };
}

function normalizeTrackName(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function matchesExpectedScope(action: CreateBusAction): boolean {
    const tracks = getTrackStoreState()?.tracks ?? [];
    const absentNames = new Set((action.payload.expectedAbsentTrackNames ?? []).map(normalizeTrackName));
    if (
        absentNames.size > 0 &&
        tracks.some((track) => typeof track.name === 'string' && absentNames.has(normalizeTrackName(track.name)))
    ) {
        return false;
    }
    return (action.payload.expectedTrackOutputs ?? []).every((expected) => {
        const track = tracks.find((candidate) => candidate.id === expected.trackId);
        return track?.outputId === expected.outputId;
    });
}

export const handleCreateBus = createHandler<'createBus'>({
    previewExecution: 'unsupported-async',
    validate: (action, context) =>
        matchesExpectedScope(action) && Boolean(handleAddTrack.validate?.(toAddTrackAction(action), context)),
    execute: async (action) => {
        if (!matchesExpectedScope(action)) {
            pendingCreatedBusGuards.delete(action);
            return { status: 'conflict' };
        }
        const result = await handleAddTrack.execute(toAddTrackAction(action));
        if (result?.status !== 'written') {
            pendingCreatedBusGuards.delete(action);
            return result;
        }
        const busId = action.payload.busId;
        const createdBus = getTrackStoreState()?.tracks.find((track) => track.id === busId);
        if (!createdBus) {
            pendingCreatedBusGuards.delete(action);
            return { status: 'conflict' };
        }
        action.payload.color = createdBus.color;
        action.payload.initialAlternativeId = createdBus.activeAlternativeId;
        const guard = pendingCreatedBusGuards.get(action);
        if (guard) {
            guard.entityJson = JSON.stringify(createdBus);
        }
        pendingCreatedBusGuards.delete(action);
        return result;
    },
    describe: (action) => {
        const description = handleAddTrack.describe(toAddTrackAction(action));
        const generatedMidiStateGuard = {
            entityJson: '',
            midiByClipIdJson: JSON.stringify({}),
        };
        pendingCreatedBusGuards.set(action, generatedMidiStateGuard);
        const inverseAction = description.inverseAction;
        return {
            ...description,
            label: `Create bus "${action.payload.name}"`,
            inverseAction:
                inverseAction?.type === 'discardCreatedTrack'
                    ? {
                          ...inverseAction,
                          payload: { ...inverseAction.payload, generatedMidiStateGuard },
                      }
                    : inverseAction,
        };
    },
    isNoop: (action) => handleAddTrack.isNoop?.(toAddTrackAction(action)) ?? false,
    requiresAbortCompensation: false,
    undoable: true,
});
