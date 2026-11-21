import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { createRuntimeGraphRevision } from '../createRuntimeGraphRevision';

describe('createRuntimeGraphRevision', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('starts at revision zero', () => {
        expect(createRuntimeGraphRevision().current()).toBe(0);
    });

    it('advances once per changed mutation and receipts the new revision with the value', () => {
        const revision = createRuntimeGraphRevision();

        const first = revision.mutate(() => ({ value: 'strip', changed: true }));
        const second = revision.mutate(() => ({ value: 'edge', changed: true }));

        expect(first).toEqual({ value: 'strip', runtimeRevision: 1 });
        expect(second).toEqual({ value: 'edge', runtimeRevision: 2 });
        expect(revision.current()).toBe(2);
        expect(Object.isFrozen(second)).toBe(true);
    });

    it('holds the revision for an unchanged mutation and receipts the current one', () => {
        const revision = createRuntimeGraphRevision();
        revision.mutate(() => ({ value: undefined, changed: true }));

        const receipt = revision.mutate(() => ({ value: 7, changed: false }));

        expect(receipt).toEqual({ value: 7, runtimeRevision: 1 });
        expect(revision.current()).toBe(1);
    });

    it('does not advance when the mutation throws', () => {
        const revision = createRuntimeGraphRevision();

        expect(() =>
            revision.mutate(() => {
                throw new Error('graph edit failed');
            })
        ).toThrow('graph edit failed');
        expect(revision.current()).toBe(0);
    });

    it('records an applied after-the-fact mutation as one generation without warning', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const revision = createRuntimeGraphRevision();

        revision.recordMutation({ application: 'applied', reason: 'device loaded' });

        expect(revision.current()).toBe(1);
        expect(warn).not.toHaveBeenCalled();
    });

    it('records a needs-reconcile mutation as one generation and warns with its reason', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const revision = createRuntimeGraphRevision();

        revision.recordMutation({ application: 'needs-reconcile', reason: 'chain half rebuilt' });

        expect(revision.current()).toBe(1);
        expect(warn).toHaveBeenCalledExactlyOnceWith('[AudioEngine] chain half rebuilt');
    });

    it('holds each validator slot until it is replaced or cleared', () => {
        const revision = createRuntimeGraphRevision();
        const projectValidator = vi.fn(() => true);
        const topologyValidator = vi.fn(() => true);

        expect(revision.projectRevisionValidator()).toBeNull();
        expect(revision.topologyValidator()).toBeNull();

        revision.setProjectRevisionValidator(projectValidator);
        revision.setTopologyValidator(topologyValidator);
        expect(revision.projectRevisionValidator()).toBe(projectValidator);
        expect(revision.topologyValidator()).toBe(topologyValidator);

        revision.setProjectRevisionValidator(null);
        expect(revision.projectRevisionValidator()).toBeNull();
        expect(revision.topologyValidator()).toBe(topologyValidator);
        revision.setTopologyValidator(null);
        expect(revision.topologyValidator()).toBeNull();
    });
});
