import { describe, expect, it } from 'vitest';

import { handleCreateProjectVersion } from '../../handlers/versionControl/handleCreateProjectVersion';
import { handleCreateVersionBranch } from '../../handlers/versionControl/handleCreateVersionBranch';
import { handleRestoreProjectVersion } from '../../handlers/versionControl/handleRestoreProjectVersion';
import { getVersionControlHandlers } from '../getVersionControlHandlers';

describe('getVersionControlHandlers', () => {
    it('maps each version-control action type to its owning handler', () => {
        const handlers = getVersionControlHandlers();

        expect(handlers.createProjectVersion).toBe(handleCreateProjectVersion);
        expect(handlers.restoreProjectVersion).toBe(handleRestoreProjectVersion);
        expect(handlers.createVersionBranch).toBe(handleCreateVersionBranch);
        expect(Object.keys(handlers).sort()).toEqual(
            ['createProjectVersion', 'createVersionBranch', 'restoreProjectVersion'].sort()
        );
    });
});
