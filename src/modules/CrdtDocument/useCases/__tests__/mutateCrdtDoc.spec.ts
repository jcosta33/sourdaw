import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { cloneProspectiveCrdtMutation } from '../cloneProspectiveCrdtMutation';
import { mutateCrdtDoc } from '../mutateCrdtDoc';

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        changeDoc: vi.fn(),
        cloneProspectiveMutation: vi.fn(),
    },
}));

describe('mutateCrdtDoc', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.changeDoc).mockClear();
        vi.mocked(automergeRepository.cloneProspectiveMutation).mockClear();
    });

    it('should delegate the change function to the repository changeDoc', () => {
        const changeFn = vi.fn();

        mutateCrdtDoc({ id: 'root', changeFn });

        expect(automergeRepository.changeDoc).toHaveBeenCalledTimes(1);
        expect(automergeRepository.changeDoc).toHaveBeenCalledWith(
            'root',
            changeFn,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined
        );
    });

    it.each([
        { scope: 'a whole slot', ownedPath: undefined },
        { scope: 'a nested path', ownedPath: ['rows', 'selected'] as const },
    ])('forwards canonical settings for $scope only through private preparation', ({ ownedPath }) => {
        const changeFn = vi.fn();
        const canonicalMutation = {
            kind: 'canonical-json-slot-v1' as const,
            key: 'slot',
            baseValue: null,
            value: { rows: { selected: { count: 1 } } },
        };
        const input = {
            id: 'root',
            changeFn,
            message: 'Detect',
            localSlots: ['slot'],
            canonicalMutation,
            preparationPolicy: 'bounded-native-sequence-v1' as const,
            ownedPath,
        };

        cloneProspectiveCrdtMutation(input);
        expect(automergeRepository.changeDoc).not.toHaveBeenCalled();
        mutateCrdtDoc(input);

        expect(automergeRepository.cloneProspectiveMutation).toHaveBeenCalledExactlyOnceWith(
            'root',
            changeFn,
            'Detect',
            undefined,
            ['slot'],
            canonicalMutation,
            { preparationPolicy: 'bounded-native-sequence-v1', ownedPath }
        );
        expect(automergeRepository.changeDoc).toHaveBeenCalledExactlyOnceWith(
            'root',
            changeFn,
            'Detect',
            undefined,
            ['slot'],
            undefined,
            undefined
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
            undefined,
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
            undefined,
            undefined,
            undefined
        );
    });

    it('forwards the local slot keys a storage-adapter write reported', () => {
        const changeFn = vi.fn();

        mutateCrdtDoc({ id: 'root', changeFn, localSlots: ['tracks', 'markers'] });

        expect(automergeRepository.changeDoc).toHaveBeenCalledWith(
            'root',
            changeFn,
            undefined,
            undefined,
            ['tracks', 'markers'],
            undefined,
            undefined
        );
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
            prospectiveValidation,
            undefined
        );
    });
});
