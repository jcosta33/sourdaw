import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import {
    createProjectVersion,
    restoreVersion,
    createVersionBranch,
} from '#/modules/Project/useCases/versionControlUseCases';

export const versionControlHandlers: Record<string, ActionHandler<any>> = {
    createProjectVersion: {
        execute: async (a: { payload: { label: string; description?: string } }) => {
            createProjectVersion(a.payload.label, a.payload.description ?? '');
        },
        undoable: false,
        describe: () => ({ label: 'Create Project Version' }),
    },
    restoreProjectVersion: {
        execute: async (a: { payload: { versionId: string } }) => {
            restoreVersion(a.payload.versionId);
        },
        undoable: true,
        describe: () => ({ label: 'Restore Project Version' }),
    },
    createVersionBranch: {
        execute: async (a: { payload: { name: string } }) => {
            createVersionBranch(a.payload.name);
        },
        undoable: false,
        describe: () => ({ label: 'Create Version Branch' }),
    },
};
