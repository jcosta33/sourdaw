import { inject } from '#/infra/di/inject';
import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { createProjectVersion } from '#/modules/Project/useCases/versionControl/createProjectVersion';
import { restoreVersion } from '#/modules/Project/useCases/versionControl/restoreVersion';
import { createVersionBranch } from '#/modules/Project/useCases/versionControl/branching';

type CreateProjectVersionAction = { payload: { label: string; description?: string } };
type RestoreProjectVersionAction = { payload: { versionId: string } };
type CreateVersionBranchAction = { payload: { name: string } };

export const executeCreateProjectVersion = inject({ createProjectVersion })(
    ({ createProjectVersion }) =>
        async function executeCreateProjectVersion(a: CreateProjectVersionAction): Promise<void> {
            createProjectVersion(a.payload.label, a.payload.description ?? '');
        }
);

export const executeRestoreProjectVersion = inject({ restoreVersion })(
    ({ restoreVersion }) =>
        async function executeRestoreProjectVersion(a: RestoreProjectVersionAction): Promise<void> {
            restoreVersion(a.payload.versionId);
        }
);

export const executeCreateVersionBranch = inject({ createVersionBranch })(
    ({ createVersionBranch }) =>
        async function executeCreateVersionBranch(a: CreateVersionBranchAction): Promise<void> {
            createVersionBranch(a.payload.name);
        }
);

export const versionControlHandlers: Record<string, ActionHandler<any>> = {
    createProjectVersion: {
        execute: executeCreateProjectVersion,
        undoable: false,
        describe: () => ({ label: 'Create Project Version' }),
    },
    restoreProjectVersion: {
        execute: executeRestoreProjectVersion,
        undoable: true,
        describe: () => ({ label: 'Restore Project Version' }),
    },
    createVersionBranch: {
        execute: executeCreateVersionBranch,
        undoable: false,
        describe: () => ({ label: 'Create Version Branch' }),
    },
};
