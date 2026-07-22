import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCreateProjectFromTemplate } from '../handleCreateProjectFromTemplate';

const mocks = vi.hoisted(() => ({ applyProjectTemplate: vi.fn() }));

vi.mock('../../../useCases/projectTemplates/templateDefinitions/applyProjectTemplate', () => ({
    applyProjectTemplate: mocks.applyProjectTemplate,
}));

describe('handleCreateProjectFromTemplate', () => {
    beforeEach(() => {
        mocks.applyProjectTemplate.mockReset();
    });

    it('reports the synchronous template mutation chain as one action write', async () => {
        mocks.applyProjectTemplate.mockResolvedValue(true);

        const result = await handleCreateProjectFromTemplate.execute({
            type: 'createProjectFromTemplate',
            payload: { templateId: 'demo-nebula-drift' },
        });

        expect(mocks.applyProjectTemplate).toHaveBeenCalledWith('demo-nebula-drift');
        expect(result).toEqual({ status: 'written' });
    });

    it('does not commit an unknown template action', async () => {
        mocks.applyProjectTemplate.mockResolvedValue(false);

        const result = await handleCreateProjectFromTemplate.execute({
            type: 'createProjectFromTemplate',
            payload: { templateId: 'missing' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });
});
