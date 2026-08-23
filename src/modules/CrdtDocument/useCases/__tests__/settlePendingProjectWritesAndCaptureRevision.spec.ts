import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort, createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectRevision } from '../captureProjectRevision';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';
import { settlePendingProjectWritesAndCaptureRevision } from '../settlePendingProjectWritesAndCaptureRevision';

describe('settlePendingProjectWritesAndCaptureRevision', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        automergeRepository.reset();
        automergeRepository.createProject('settled revision test');
        registerCrdtStorageRuntime();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
        automergeRepository.reset();
    });

    it('includes pending local truth and stays stable until a later project mutation', () => {
        const storage = createAutomergeStorage<{ value: number }>('root', 'settledRevision');
        storage.hydrate?.();
        const beforePendingWrite = captureProjectRevision();
        storage.set({ value: 1 });

        const settledRevision = settlePendingProjectWritesAndCaptureRevision();

        expect(settledRevision).not.toBe(beforePendingWrite);
        expect(captureProjectRevision()).toBe(settledRevision);
        expect(settlePendingProjectWritesAndCaptureRevision()).toBe(settledRevision);

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.concurrentChange = true;
        });

        expect(captureProjectRevision()).not.toBe(settledRevision);
    });
});
