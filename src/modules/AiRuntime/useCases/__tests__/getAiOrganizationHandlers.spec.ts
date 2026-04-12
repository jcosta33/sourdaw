import { describe, it, expect } from 'vitest';
import { getAiOrganizationHandlers } from '../getAiOrganizationHandlers';
import { handleAutoOrganizeProject } from '../../handlers/aiOrganization/handleAutoOrganizeProject';

describe('getAiOrganizationHandlers', () => {
    it('returns a map containing autoOrganizeProject handler', () => {
        const handlers = getAiOrganizationHandlers();
        expect(handlers).toHaveProperty('autoOrganizeProject');
        expect(handlers.autoOrganizeProject).toBe(handleAutoOrganizeProject);
    });
});
