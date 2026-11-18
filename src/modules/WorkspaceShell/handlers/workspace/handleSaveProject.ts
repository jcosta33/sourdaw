import { prepareProjectSaveSnapshot, saveProject } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';
import { isRecord } from '#/utils/structuralEquality';

type SaveIntent = { kind: 'save' } | { kind: 'prepareSnapshot'; expectedOutgoingProjectIdentity?: string };

function readSaveIntent(payload: unknown): SaveIntent {
    if (payload === undefined) {
        return { kind: 'save' };
    }
    if (!isRecord(payload) || Object.getPrototypeOf(payload) !== Object.prototype) {
        throw new TypeError('Invalid Save project payload');
    }
    const keys = Reflect.ownKeys(payload);
    if (keys.length === 0) {
        return { kind: 'save' };
    }
    if (
        !keys.includes('intent') ||
        payload.intent !== 'prepareSnapshot' ||
        keys.some((key) => key !== 'intent' && key !== 'expectedOutgoingProjectIdentity')
    ) {
        throw new TypeError('Invalid Save project intent');
    }
    if (!keys.includes('expectedOutgoingProjectIdentity')) {
        return { kind: 'prepareSnapshot' };
    }
    const identity = payload.expectedOutgoingProjectIdentity;
    if (typeof identity !== 'string' || identity.length === 0) {
        throw new TypeError('Invalid outgoing project identity for Save');
    }
    return { kind: 'prepareSnapshot', expectedOutgoingProjectIdentity: identity };
}

export const handleSaveProject = createHandler<'saveProject'>({
    execute: ({ payload }, context) => {
        const intent = readSaveIntent(payload);
        if (intent.kind === 'prepareSnapshot') {
            return prepareProjectSaveSnapshot(context?.signal, intent.expectedOutgoingProjectIdentity);
        }
        // Fire-and-forget: saveProject notifies the user itself on failure.
        void saveProject({ requestFolderSelection: true });
        return undefined;
    },
    describe: () => ({ label: 'Save project' }),
    undoable: false,
});
