import { describe, expect, it, vi } from 'vitest';

const { mockDeleteGrooveTemplate, mockSnapshotDeletion } = vi.hoisted(() => ({
    mockDeleteGrooveTemplate: vi.fn(),
    mockSnapshotDeletion: vi.fn(),
}));

vi.mock('../../../useCases/grooveTemplates/deleteGrooveTemplate', () => ({
    deleteGrooveTemplate: mockDeleteGrooveTemplate,
}));
vi.mock('../../../useCases/grooveTemplates/snapshotGrooveTemplateDeletion', () => ({
    snapshotGrooveTemplateDeletion: mockSnapshotDeletion,
}));

import { handleDeleteGrooveTemplate } from '../handleDeleteGrooveTemplate';

const action = {
    type: 'deleteGrooveTemplate' as const,
    payload: { templateId: 'groove-1' },
};

describe('handleDeleteGrooveTemplate', () => {
    it('isNoop returns true when no snapshot exists (template already absent)', () => {
        mockSnapshotDeletion.mockReturnValue(null);
        expect(handleDeleteGrooveTemplate.isNoop?.(action)).toBe(true);
    });

    it('isNoop returns false when a snapshot exists (template can be deleted)', () => {
        mockSnapshotDeletion.mockReturnValue({ template: { id: 'groove-1' }, templateIndex: 1, assignments: [] });
        expect(handleDeleteGrooveTemplate.isNoop?.(action)).toBe(false);
    });

    it('execute returns written status when delete succeeds', () => {
        mockDeleteGrooveTemplate.mockReturnValue({ template: { id: 'groove-1' }, templateIndex: 1, assignments: [] });
        const result = handleDeleteGrooveTemplate.execute(action) as { status: string };
        expect(result.status).toBe('written');
    });

    it('execute returns no-write status when delete returns null', () => {
        mockDeleteGrooveTemplate.mockReturnValue(null);
        const result = handleDeleteGrooveTemplate.execute(action) as { status: string };
        expect(result.status).toBe('no-write');
    });

    it('describe returns inverse restore action when snapshot exists', () => {
        const snapshot = { template: { id: 'groove-1' }, templateIndex: 1, assignments: [] };
        mockSnapshotDeletion.mockReturnValue(snapshot);
        const result = handleDeleteGrooveTemplate.describe(action);
        expect(result.label).toBe('Delete groove template');
        expect(result.inverseAction).toEqual({
            type: 'restoreDeletedGrooveTemplate',
            payload: snapshot,
        });
    });

    it('describe returns null inverse when snapshot does not exist', () => {
        mockSnapshotDeletion.mockReturnValue(null);
        const result = handleDeleteGrooveTemplate.describe(action);
        expect(result.inverseAction).toBeNull();
    });
});
