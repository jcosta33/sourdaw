import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { cloneProspectiveCrdtMutation, mutateCrdtDoc } from '../mutateCrdtDoc';

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        changeDoc: vi.fn(),
        cloneProspectiveMutation: vi.fn(),
    },
}));

describe('mutateCrdtDoc', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.changeDoc).mockClear();
    });

    it('should delegate the change function to the repository changeDoc', () => {
        const changeFn = vi.fn();

        mutateCrdtDoc({ id: 'root', changeFn });

        expect(automergeRepository.changeDoc).toHaveBeenCalledTimes(1);
        expect(automergeRepository.changeDoc).toHaveBeenCalledWith('root', changeFn, undefined, undefined, undefined);
    });

    it('forwards the supported canonical description only through private preparation', () => {
        const changeFn = vi.fn();
        const canonicalMutation = {
            kind: 'canonical-json-slot-v1' as const,
            key: 'slot',
            baseValue: null,
            value: { count: 1 },
        };
        cloneProspectiveCrdtMutation({
            id: 'root',
            changeFn,
            message: 'Detect',
            localSlots: ['slot'],
            canonicalMutation,
        });
        expect(automergeRepository.cloneProspectiveMutation).toHaveBeenCalledWith(
            'root',
            changeFn,
            'Detect',
            undefined,
            ['slot'],
            canonicalMutation
        );
    });

    it('forwards the optional change message to the repository', () => {
        const changeFn = vi.fn();

        mutateCrdtDoc({ id: 'root', changeFn, message: 'edited clip name' });

        expect(automergeRepository.changeDoc).toHaveBeenCalledWith(
            'root',
            changeFn,
            'edited clip name',
            undefined,
            undefined
        );
    });

    it('forwards the exact snapshot transaction handle', () => {
        const changeFn = vi.fn();
        const snapshotTransaction = {};

        mutateCrdtDoc({ id: 'root', changeFn, snapshotTransaction });

        expect(automergeRepository.changeDoc).toHaveBeenCalledWith(
            'root',
            changeFn,
            undefined,
            snapshotTransaction,
            undefined
        );
    });

    it('forwards the local slot keys a storage-adapter write reported', () => {
        const changeFn = vi.fn();

        mutateCrdtDoc({ id: 'root', changeFn, localSlots: ['tracks', 'markers'] });

        expect(automergeRepository.changeDoc).toHaveBeenCalledWith('root', changeFn, undefined, undefined, [
            'tracks',
            'markers',
        ]);
    });
    it('forwards exact prospective validation and publication acknowledgement on the validated branch', () => {
        const changeFn = vi.fn();
        const prospectiveValidation = { validateDocument: vi.fn(), beforePublication: vi.fn(), onPublished: vi.fn() };
        const snapshotTransaction = {};
        mutateCrdtDoc({
            id: 'root',
            changeFn,
            message: 'validated',
            snapshotTransaction,
            localSlots: ['warpStates'],
            prospectiveValidation,
        });
        expect(automergeRepository.changeDoc).toHaveBeenCalledExactlyOnceWith(
            'root',
            changeFn,
            'validated',
            snapshotTransaction,
            ['warpStates'],
            prospectiveValidation
        );
    });
});
