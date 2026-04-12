import { describe, expect, it, vi } from 'vitest';

import { createBranch, createDefaultState, createVersion } from '../ProjectVersion';

describe('createVersion', () => {
    it('builds a version with snapshot, parent, and tags', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
        const snapshot = { data: '{}', size: 2 };
        const v = createVersion('Label', 'desc', snapshot, 'parent-1', ['t1']);

        expect(v.label).toBe('Label');
        expect(v.description).toBe('desc');
        expect(v.snapshot).toBe(snapshot);
        expect(v.parentId).toBe('parent-1');
        expect(v.tags).toEqual(['t1']);
        expect(v.createdAt).toBe('2024-06-01T12:00:00.000Z');
        expect(v.id).toMatch(/^ver-\d+$/);
        vi.useRealTimers();
    });

    it('defaults tags to an empty array', () => {
        const v = createVersion('L', 'd', { data: '', size: 0 }, null);
        expect(v.tags).toEqual([]);
    });
});

describe('createBranch', () => {
    it('creates a branch with head version id', () => {
        const b = createBranch('feature', 'ver-9');
        expect(b.name).toBe('feature');
        expect(b.headVersionId).toBe('ver-9');
        expect(b.id).toMatch(/^branch-\d+$/);
        expect(b.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('createDefaultState', () => {
    it('starts with a main branch and no current version', () => {
        const s = createDefaultState();
        expect(s.versions).toEqual([]);
        expect(s.currentVersionId).toBeNull();
        expect(s.autoSaveInterval).toBe(5);
        expect(s.branches).toHaveLength(1);
        expect(s.branches[0]!.name).toBe('main');
        expect(s.currentBranchId).toBe(s.branches[0]!.id);
    });
});
