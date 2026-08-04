import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/grooveTemplates/renameGrooveTemplate', () => ({
    renameGrooveTemplate: vi.fn(),
}));

vi.mock('../../../useCases/grooveTemplates/resolveGrooveTemplateRename', () => ({
    resolveGrooveTemplateRename: vi.fn(),
}));

import { renameGrooveTemplate } from '../../../useCases/grooveTemplates/renameGrooveTemplate';
import { resolveGrooveTemplateRename } from '../../../useCases/grooveTemplates/resolveGrooveTemplateRename';
import { handleRenameGrooveTemplate } from '../handleRenameGrooveTemplate';

const mockedRename = vi.mocked(renameGrooveTemplate);
const mockedResolve = vi.mocked(resolveGrooveTemplateRename);

const action = {
    type: 'renameGrooveTemplate' as const,
    payload: { templateId: 'g1', name: 'New Name' },
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleRenameGrooveTemplate — execute', () => {
    it('calls renameGrooveTemplate with payload', () => {
        handleRenameGrooveTemplate.execute(action);
        expect(mockedRename).toHaveBeenCalledWith(action.payload);
    });
});

describe('handleRenameGrooveTemplate — isNoop', () => {
    it('returns true when resolve returns null', () => {
        mockedResolve.mockReturnValue(null);
        expect(handleRenameGrooveTemplate.isNoop!(action)).toBe(true);
    });

    it('returns true when current name equals next name', () => {
        mockedResolve.mockReturnValue({ current: { id: 'g1', name: 'New Name' }, nextName: 'New Name' } as never);
        expect(handleRenameGrooveTemplate.isNoop!(action)).toBe(true);
    });

    it('returns false when names differ', () => {
        mockedResolve.mockReturnValue({ current: { id: 'g1', name: 'Old' }, nextName: 'New Name' } as never);
        expect(handleRenameGrooveTemplate.isNoop!(action)).toBe(false);
    });
});

describe('handleRenameGrooveTemplate — describe', () => {
    it('returns label with new name and inverse restoreGrooveTemplateName', () => {
        mockedResolve.mockReturnValue({ current: { id: 'g1', name: 'Old' }, nextName: 'New Name' } as never);
        const result = handleRenameGrooveTemplate.describe(action);
        expect(result.label).toBe('Rename groove template to "New Name"');
        expect(result.inverseAction?.type).toBe('restoreGrooveTemplateName');
        const payload = (
            result.inverseAction as { payload: { templateId: string; name: string; expectedName: string } }
        ).payload;
        expect(payload.templateId).toBe('g1');
        expect(payload.name).toBe('Old');
        expect(payload.expectedName).toBe('New Name');
    });

    it('returns null inverse when resolve returns null', () => {
        mockedResolve.mockReturnValue(null);
        const result = handleRenameGrooveTemplate.describe(action);
        expect(result.inverseAction).toBeNull();
    });
});
