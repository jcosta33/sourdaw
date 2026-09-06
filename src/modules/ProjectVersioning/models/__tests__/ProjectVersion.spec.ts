import { describe, expect, it, vi } from 'vitest';

import { createBranch, createDefaultState, createVersion } from '../ProjectVersion';

describe('createVersion', () => {
    it('builds a version with snapshot, parent, and tags', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
        const snapshot = { ownerProjectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa', data: '{}', size: 2 };
        const value = createVersion('Label', 'desc', snapshot, 'parent-1', ['t1']);

        expect(value.label).toBe('Label');
        expect(value.description).toBe('desc');
        expect(value.snapshot).toBe(snapshot);
        expect(value.parentId).toBe('parent-1');
        expect(value.tags).toEqual(['t1']);
        expect(value.createdAt).toBe('2024-06-01T12:00:00.000Z');
        expect(value.id).toMatch(/^ver-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        vi.useRealTimers();
    });

    it('defaults tags to an empty array', () => {
        const value = createVersion(
            'L',
            'd',
            { ownerProjectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa', data: '', size: 0 },
            null
        );
        expect(value.tags).toEqual([]);
    });
});

describe('createBranch', () => {
    it('creates a branch with head version id', () => {
        const b = createBranch('feature', 'ver-9');
        expect(b.name).toBe('feature');
        expect(b.headVersionId).toBe('ver-9');
        expect(b.id).toMatch(/^branch-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(b.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('createDefaultState', () => {
    it('starts with a main branch and no current version', () => {
        const state = createDefaultState();
        expect(state.versions).toEqual([]);
        expect(state.currentVersionId).toBeNull();
        expect(state.autoSaveInterval).toBe(5);
        expect(state.branches).toHaveLength(1);
        expect(state.branches[0]!.name).toBe('main');
        expect(state.currentBranchId).toBe(state.branches[0]!.id);
    });
});
