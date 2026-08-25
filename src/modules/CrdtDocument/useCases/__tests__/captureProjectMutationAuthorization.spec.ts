import { beforeEach, describe, expect, it } from 'vitest';

import { runWithAutomergeStorageTransaction } from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectMutationAuthorization } from '../captureProjectMutationAuthorization';

beforeEach(() => {
    automergeRepository.reset();
    automergeRepository.createProject('project');
});

describe('captureProjectMutationAuthorization', () => {
    it('keeps mutations from the bound storage transaction owner authorized', () => {
        const isAuthorized = captureProjectMutationAuthorization();
        const authorizations: boolean[] = [];

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            authorizations.push(isAuthorized());

            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.firstOwnedMutation = true;
            });
            authorizations.push(isAuthorized());

            automergeRepository.createChildDoc('owned-child');
            authorizations.push(isAuthorized());
        });
        transaction.commit();

        expect(transaction.status).toBe('returned');
        expect(authorizations).toEqual([true, true, true]);
        expect(isAuthorized()).toBe(true);
    });

    it('revokes authorization after a different storage transaction owner mutates the project', () => {
        const isAuthorized = captureProjectMutationAuthorization();
        let authorizationAfterOwnedMutation = false;
        const boundTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            isAuthorized();
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.ownedMutation = true;
            });
            authorizationAfterOwnedMutation = isAuthorized();
        });
        boundTransaction.commit();

        let authorizationAfterForeignMutation = true;
        const foreignTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.foreignMutation = true;
            });
            authorizationAfterForeignMutation = isAuthorized();
        });
        foreignTransaction.commit();

        expect(boundTransaction.status).toBe('returned');
        expect(foreignTransaction.status).toBe('returned');
        expect(authorizationAfterOwnedMutation).toBe(true);
        expect(authorizationAfterForeignMutation).toBe(false);
    });
});
