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

    describe('guarded by the template an extraction created', () => {
        const extracted = {
            id: 'groove-1',
            name: 'Lead groove',
            schemaVersion: 1 as const,
            subdivision: '1/16' as const,
            slots: [{ index: 0, timingOffset: 0.08, dynamicsOffset: 0 }],
            provenance: { type: 'midi-clip' as const, sourceId: 'clip-1', analyzerVersion: 1 },
        };
        const guarded = {
            type: 'deleteGrooveTemplate' as const,
            payload: { templateId: 'groove-1', expectedTemplate: extracted },
        };

        it('deletes the template while it is unchanged and unassigned', () => {
            mockSnapshotDeletion.mockReturnValue({ template: extracted, templateIndex: 0, assignments: [] });
            mockDeleteGrooveTemplate.mockReset();
            mockDeleteGrooveTemplate.mockReturnValue({ template: extracted, templateIndex: 0, assignments: [] });

            expect(handleDeleteGrooveTemplate.isNoop?.(guarded)).toBe(false);
            expect((handleDeleteGrooveTemplate.execute(guarded) as { status: string }).status).toBe('written');
            expect(mockDeleteGrooveTemplate).toHaveBeenCalledWith('groove-1');
        });

        it('treats a template already gone as an extraction already undone, never a conflict', () => {
            mockSnapshotDeletion.mockReturnValue(null);
            mockDeleteGrooveTemplate.mockReset();
            mockDeleteGrooveTemplate.mockReturnValue(null);

            expect(handleDeleteGrooveTemplate.isNoop?.(guarded)).toBe(true);
            expect(handleDeleteGrooveTemplate.execute(guarded)).toEqual({ status: 'no-write' });
        });

        it.each([
            [
                'renamed since',
                { template: { ...extracted, name: 'Renamed' }, templateIndex: 0, assignments: [] },
                /changed after it was extracted/,
            ],
            [
                'assigned since',
                {
                    template: extracted,
                    templateIndex: 0,
                    assignments: [{ consumerType: 'clip', consumerId: 'clip-2', templateId: 'groove-1', amount: 1 }],
                },
                /assigned to 1 consumer/,
            ],
        ])('refuses as a conflict and deletes nothing when the template is %s', (_case, snapshot, reason) => {
            mockSnapshotDeletion.mockReturnValue(snapshot);
            mockDeleteGrooveTemplate.mockReset();

            expect(handleDeleteGrooveTemplate.isNoop?.(guarded)).toBe(false);
            expect(handleDeleteGrooveTemplate.execute(guarded)).toEqual({
                status: 'conflict',
                reason: expect.stringMatching(reason),
            });
            expect(mockDeleteGrooveTemplate).not.toHaveBeenCalled();
        });
    });

    it('describe returns null inverse when snapshot does not exist', () => {
        mockSnapshotDeletion.mockReturnValue(null);
        const result = handleDeleteGrooveTemplate.describe(action);
        expect(result.inverseAction).toBeNull();
    });
});
