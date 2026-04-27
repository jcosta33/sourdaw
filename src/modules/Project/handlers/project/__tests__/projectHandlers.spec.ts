import { describe, expect, it } from 'vitest';

import { getWorkspaceHandlers } from '#/modules/Workspace/useCases';

describe('Project persistence handler migration', () => {
    it('should keep project persistence actions registered by Workspace while Project boundary splitting is pending', () => {
        const handlers = getWorkspaceHandlers();

        expect(handlers.exportProject.execute).toBeDefined();
        expect(handlers.newProject.execute).toBeDefined();
        expect(handlers.saveProject.execute).toBeDefined();
    });
});
