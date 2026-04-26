import { describe, it, expect } from 'vitest';
import { toSlug, deriveNames, nextDuplicateSlug } from '../slug.ts';

describe('slug utility', () => {
    describe('toSlug', () => {
        it('should lowercase strings', () => {
            expect(toSlug('HELLO')).toBe('hello');
        });

        it('should replace non-alphanumeric characters with dashes', () => {
            expect(toSlug('Hello World! 123')).toBe('hello-world-123');
        });

        it('should trim leading and trailing dashes', () => {
            expect(toSlug('-hello-world-')).toBe('hello-world');
        });

        it('should collapse multiple dashes into a single dash', () => {
            expect(toSlug('hello---world')).toBe('hello-world');
        });
    });

    describe('deriveNames', () => {
        it('should derive branch, task path, and worktree path correctly', () => {
            const config = {
                worktreeDirPattern: '../{repoName}--{slug}',
            };
            const result = deriveNames('my-feature', 'my-repo', config);

            expect(result.branch).toBe('agent/my-feature');
            expect(result.taskFile).toBe('.agents/tasks/my-feature.md');
            expect(result.worktreePath).toBe('../my-repo--my-feature');
        });
    });

    describe('nextDuplicateSlug', () => {
        it('should append -2 to a base slug that already exists', () => {
            const existing = new Set(['feature']);
            expect(nextDuplicateSlug('feature', existing)).toBe('feature-2');
        });

        it('should increment the suffix if the appended one already exists', () => {
            const existing = new Set(['feature', 'feature-2', 'feature-3']);
            expect(nextDuplicateSlug('feature', existing)).toBe('feature-4');
        });
    });
});
