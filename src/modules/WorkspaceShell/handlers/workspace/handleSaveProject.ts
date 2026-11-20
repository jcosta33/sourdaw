import { prepareProjectSaveSnapshot, saveProject } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSaveProject = createHandler<'saveProject'>({
    execute: ({ payload }, context) => {
        if (payload?.intent === 'prepareSnapshot') {
            return prepareProjectSaveSnapshot(payload, context?.signal);
        }
        if (
            payload !== undefined &&
            (Object.getPrototypeOf(payload) !== Object.prototype || Reflect.ownKeys(payload).length > 0)
        ) {
            throw new TypeError('Invalid Save project payload');
        }
        // Fire-and-forget: saveProject notifies the user itself on failure.
        void saveProject({ requestFolderSelection: true });
        return undefined;
    },
    describe: () => ({ label: 'Save project' }),
    undoable: false,
});
