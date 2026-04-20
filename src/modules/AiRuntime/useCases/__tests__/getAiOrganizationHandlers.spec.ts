import { describe, it, expect } from 'vitest';

import { handleAutoOrganizeProject } from '../../handlers/aiOrganization/handleAutoOrganizeProject';
import { getAiOrganizationHandlers } from '../getAiOrganizationHandlers';

describe('getAiOrganizationHandlers', () => {
    it('returns a map containing autoOrganizeProject handler', () => {
        const handlers = getAiOrganizationHandlers();
        expect(handlers).toHaveProperty('autoOrganizeProject');
        expect(handlers.autoOrganizeProject).toBe(handleAutoOrganizeProject);
    });
});
