import { createProjectVersion } from './versionControl/createProjectVersion';
import { restoreVersion } from './versionControl/restoreVersion';
import { createVersionBranch } from './versionControl/branching';

type ProjectHandlerResult = {
    label: string;
    inverseAction?: unknown | null;
};

type ProjectHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => ProjectHandlerResult;
    undoable: boolean;
};

type VersionControlAction =
    | { type: 'createProjectVersion'; payload: { label: string; description?: string } }
    | { type: 'restoreProjectVersion'; payload: { versionId: string } }
    | { type: 'createVersionBranch'; payload: { name: string } };

type VersionControlActionOf<ActionType extends VersionControlAction['type']> = Extract<
    VersionControlAction,
    { type: ActionType }
>;

export const versionControlHandlers = {
    createProjectVersion: {
        execute: async (a) => {
            createProjectVersion(a.payload.label, a.payload.description ?? '');
        },
        undoable: false,
        describe: () => ({ label: 'Create Project Version' }),
    } satisfies ProjectHandler<VersionControlActionOf<'createProjectVersion'>>,
    restoreProjectVersion: {
        execute: async (a) => {
            restoreVersion(a.payload.versionId);
        },
        undoable: true,
        describe: () => ({ label: 'Restore Project Version' }),
    } satisfies ProjectHandler<VersionControlActionOf<'restoreProjectVersion'>>,
    createVersionBranch: {
        execute: async (a) => {
            createVersionBranch(a.payload.name);
        },
        undoable: false,
        describe: () => ({ label: 'Create Version Branch' }),
    } satisfies ProjectHandler<VersionControlActionOf<'createVersionBranch'>>,
};
