import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    configureAutomergeStoragePort: vi.fn(),
    getCrdtDoc: vi.fn(),
    hasCrdtDoc: vi.fn(),
    mutateCrdtDoc: vi.fn(),
    cloneProspectiveCrdtMutation: vi.fn(),
    getHeads: vi.fn(),
    isMutationBlockedBySnapshotTransaction: vi.fn(),
    waitForSnapshotTransaction: vi.fn(),
    getSemanticContext: vi.fn(),
}));

vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    configureAutomergeStoragePort: mocks.configureAutomergeStoragePort,
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        getHeads: mocks.getHeads,
        isMutationBlockedBySnapshotTransaction: mocks.isMutationBlockedBySnapshotTransaction,
        waitForSnapshotTransaction: mocks.waitForSnapshotTransaction,
    },
}));

vi.mock('../../stores/semanticChangeContext', () => ({
    getSemanticContext: mocks.getSemanticContext,
}));

vi.mock('../getCrdtDoc', () => ({
    getCrdtDoc: mocks.getCrdtDoc,
}));

vi.mock('../hasCrdtDoc', () => ({
    hasCrdtDoc: mocks.hasCrdtDoc,
}));

vi.mock('../cloneProspectiveCrdtMutation', () => ({
    cloneProspectiveCrdtMutation: mocks.cloneProspectiveCrdtMutation,
}));
vi.mock('../mutateCrdtDoc', () => ({
    mutateCrdtDoc: mocks.mutateCrdtDoc,
}));

import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';

describe('registerCrdtStorageRuntime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    /** Register and return the port that was passed to configureAutomergeStoragePort. */
    function getRegisteredPort() {
        registerCrdtStorageRuntime();
        const calls = mocks.configureAutomergeStoragePort.mock.calls;
        return calls[calls.length - 1]?.[0];
    }

    it('calls configureAutomergeStoragePort with a port object', () => {
        registerCrdtStorageRuntime();

        expect(mocks.configureAutomergeStoragePort).toHaveBeenCalledTimes(1);
        const port = getRegisteredPort();
        expect(port).not.toBeNull();
        expect(typeof port.getDoc).toBe('function');
        expect(typeof port.hasDoc).toBe('function');
        expect(typeof port.mutateDoc).toBe('function');
        expect(typeof port.getSemanticMessage).toBe('function');
    });

    it('getDoc delegates to getCrdtDoc', () => {
        mocks.getCrdtDoc.mockReturnValue({ key: 'val' });

        const port = getRegisteredPort();
        const result = port.getDoc('doc-1');

        expect(mocks.getCrdtDoc).toHaveBeenCalledWith('doc-1');
        expect(result).toEqual({ key: 'val' });
    });

    it('hasDoc delegates to hasCrdtDoc', () => {
        mocks.hasCrdtDoc.mockReturnValue(true);

        const port = getRegisteredPort();
        const result = port.hasDoc('doc-2');

        expect(mocks.hasCrdtDoc).toHaveBeenCalledWith('doc-2');
        expect(result).toBe(true);
    });

    it('getDocHeads delegates to automergeRepository.getHeads', () => {
        const heads = ['head-a', 'head-b'];
        mocks.getHeads.mockReturnValue(heads);

        const port = getRegisteredPort();
        const result = port.getDocHeads('doc-3');

        expect(mocks.getHeads).toHaveBeenCalledWith('doc-3');
        expect(result).toEqual(heads);
    });

    it('getSemanticMessage delegates to getSemanticContext().message', () => {
        mocks.getSemanticContext.mockReturnValue({ message: 'changed track name' });

        const port = getRegisteredPort();
        const result = port.getSemanticMessage();

        expect(mocks.getSemanticContext).toHaveBeenCalledTimes(1);
        expect(result).toBe('changed track name');
    });

    it('getSemanticMessage returns undefined when semantic context is null', () => {
        mocks.getSemanticContext.mockReturnValue(null);

        const port = getRegisteredPort();
        const result = port.getSemanticMessage();

        expect(result).toBeUndefined();
    });

    it('isMutationBlockedBySnapshotTransaction delegates to automergeRepository', () => {
        const snapshotTransaction = { id: 'snap-1' };
        mocks.isMutationBlockedBySnapshotTransaction.mockReturnValue(true);

        const port = getRegisteredPort();
        const result = port.isMutationBlockedBySnapshotTransaction('doc-4', snapshotTransaction);

        expect(mocks.isMutationBlockedBySnapshotTransaction).toHaveBeenCalledWith('doc-4', snapshotTransaction);
        expect(result).toBe(true);
    });

    it('mutateDoc delegates to mutateCrdtDoc with mapped field names', () => {
        const changeFn = vi.fn();
        const port = getRegisteredPort();

        port.mutateDoc({
            docId: 'doc-4',
            changedKeys: ['name', 'volume'],
            changeFn,
            message: 'edit',
            snapshotTransaction: { id: 'snap-1' },
        });

        expect(mocks.mutateCrdtDoc).toHaveBeenCalledWith({
            id: 'doc-4',
            changeFn,
            message: 'edit',
            snapshotTransaction: { id: 'snap-1' },
            localSlots: ['name', 'volume'],
        });
    });

    it('forwards the supported description and optional Worker request without exposing its candidate token', () => {
        const requestMaterialization = vi.fn();
        const candidate = { isCurrent: () => true, discard: vi.fn() };
        mocks.cloneProspectiveCrdtMutation.mockReturnValue({
            isCurrent: () => true,
            discard: vi.fn(),
            requestMaterialization,
            materialize: () => candidate,
        });
        const port = getRegisteredPort();
        const canonicalMutation = {
            kind: 'canonical-json-slot-v1',
            key: 'state',
            baseValue: null,
            value: { count: 1 },
        };
        const changeFn = vi.fn();
        const prepared = port.cloneDocForMutation({
            docId: 'root',
            changedKeys: ['state'],
            changeFn,
            message: 'Detect',
            canonicalMutation,
        });
        expect(mocks.cloneProspectiveCrdtMutation).toHaveBeenCalledWith({
            id: 'root',
            localSlots: ['state'],
            changeFn,
            message: 'Detect',
            snapshotTransaction: undefined,
            canonicalMutation,
        });
        expect(prepared.requestMaterialization).toBe(requestMaterialization);
        const materialized = prepared.materialize();
        expect(materialized.token).toEqual({});
        materialized.discard();
        expect(candidate.discard).toHaveBeenCalledOnce();
    });

    it('waitForSnapshotTransaction delegates to automergeRepository', async () => {
        mocks.waitForSnapshotTransaction.mockResolvedValue(undefined);

        const port = getRegisteredPort();

        await port.waitForSnapshotTransaction({ id: 'snap-2' });

        expect(mocks.waitForSnapshotTransaction).toHaveBeenCalledWith({ id: 'snap-2' });
    });
    it('forwards exact candidate validator, pre-publication gate and actual-install acknowledgement', () => {
        const port = getRegisteredPort();
        const changeFn = vi.fn();
        const validateDocument = vi.fn();
        const beforePublication = vi.fn();
        const onPublished = vi.fn();
        const snapshotTransaction = {};
        port.mutateDocValidated({
            docId: 'root',
            changeFn,
            changedKeys: ['warpStates'],
            message: 'Detect',
            snapshotTransaction,
            validateDocument,
            beforePublication,
            onPublished,
        });
        expect(mocks.mutateCrdtDoc).toHaveBeenCalledExactlyOnceWith({
            id: 'root',
            changeFn,
            localSlots: ['warpStates'],
            message: 'Detect',
            snapshotTransaction,
            prospectiveValidation: { validateDocument, beforePublication, onPublished },
        });
    });
});
