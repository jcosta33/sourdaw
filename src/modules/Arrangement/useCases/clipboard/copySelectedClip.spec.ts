import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { copySelectedClip } from './copySelectedClip';

describe('copySelectedClip', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns early when workspace is unavailable', () => {
        const getWorkspaceState = vi.fn().mockReturnValue(null);
        injectDependencies(copySelectedClip, { getWorkspaceState });

        expect(() => {
            copySelectedClip();
        }).not.toThrow();
    });
});
