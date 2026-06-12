import { describe, it, expect } from 'vitest';

import { handleAutoOrganizeProject } from '../../handlers/aiOrganization/handleAutoOrganizeProject';
import { handleGetMentorTips } from '../../handlers/aiOrganization/handleGetMentorTips';
import { getAiOrganizationHandlers } from '../getAiOrganizationHandlers';

describe('getAiOrganizationHandlers', () => {
    it('returns a map containing AI organization handlers', () => {
        const handlers = getAiOrganizationHandlers();
        expect(handlers).toHaveProperty('autoOrganizeProject');
        expect(handlers).toHaveProperty('getMentorTips');
        expect(handlers.autoOrganizeProject).toBe(handleAutoOrganizeProject);
        expect(handlers.getMentorTips).toBe(handleGetMentorTips);
    });
});
