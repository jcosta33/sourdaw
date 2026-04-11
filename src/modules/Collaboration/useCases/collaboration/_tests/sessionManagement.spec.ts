import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createSession } from '../sessionManagement';

describe('sessionManagement createSession injectable', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('invokes injected CRDT / engine collaborators when starting a session (smoke)', () => {
        const setupProjectionBridge = vi.fn().mockReturnValue(() => {});
        const subscribeToCrdtChanges = vi.fn().mockReturnValue(() => {});
        const getCrdtDoc = vi.fn();
        const createCrdtDoc = vi.fn();
        const hasCrdtDoc = vi.fn().mockReturnValue(false);
        const removeCrdtDoc = vi.fn();
        const mutateCrdtDoc = vi.fn();
        const persistCrdtProject = vi.fn().mockResolvedValue(undefined);
        const getAudioContext = vi.fn();

        injectDependencies(createSession, {
            setupProjectionBridge,
            subscribeToCrdtChanges,
            getCrdtDoc,
            createCrdtDoc,
            hasCrdtDoc,
            removeCrdtDoc,
            mutateCrdtDoc,
            persistCrdtProject,
            getAudioContext,
        });

        const sessionId = createSession('Test Host');

        expect(typeof sessionId).toBe('string');
        expect(setupProjectionBridge).toHaveBeenCalledTimes(1);
        expect(removeCrdtDoc).toHaveBeenCalled();
        expect(createCrdtDoc).toHaveBeenCalled();
    });
});
