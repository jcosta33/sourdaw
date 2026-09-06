import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createProjectVersion } from '../../useCases/versionControl/createProjectVersion';

export const handleCreateProjectVersion = createHandler<'createProjectVersion'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        if (!createProjectVersion(alpha.payload.label, alpha.payload.description ?? '')) {
            notifyUser('Project versions are unavailable until the project finishes loading', 'error');
            return { status: 'no-write' as const };
        }
        return { status: 'written' as const };
    },
    undoable: false,
    describe: () => ({ label: 'Create Project Version' }),
});
