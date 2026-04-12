import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { createSession } from '../sessionManagement';
import {
    setupProjectionBridge,
    subscribeToCrdtChanges,
    getCrdtDoc,
    createCrdtDoc,
    hasCrdtDoc,
    removeCrdtDoc,
    mutateCrdtDoc,
    persistCrdtProject,
} from '#/modules/CrdtDocument/useCases';
import { getAudioContext } from '#/modules/AudioEngine/useCases';

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    setupProjectionBridge: vi.fn(),
    subscribeToCrdtChanges: vi.fn(),
    getCrdtDoc: vi.fn(),
    createCrdtDoc: vi.fn(),
    hasCrdtDoc: vi.fn(),
    removeCrdtDoc: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: vi.fn(),
}));

describe('sessionManagement createSession injectable', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('invokes injected CRDT / engine collaborators when starting a session (smoke)', () => {
        vi.mocked(setupProjectionBridge).mockReturnValue(() => {});
        vi.mocked(subscribeToCrdtChanges).mockReturnValue(() => {});
        vi.mocked(hasCrdtDoc).mockReturnValue(false);
        vi.mocked(persistCrdtProject).mockResolvedValue(undefined);

        const sessionId = createSession('Test Host');

        expect(typeof sessionId).toBe('string');
        expect(setupProjectionBridge).toHaveBeenCalledTimes(1);
        expect(removeCrdtDoc).toHaveBeenCalled();
        expect(createCrdtDoc).toHaveBeenCalled();
    });
});
