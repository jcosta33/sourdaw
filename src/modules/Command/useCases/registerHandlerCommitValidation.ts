import {
    AutomergeStorageWriteConflictError,
    type runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { type HandlerCommitValidation } from '#/utils/handlerContract';

type Transaction = Pick<ReturnType<typeof runWithAutomergeStorageTransaction>, 'validateCommit' | 'validateDocument'>;
type DocumentValidation = {
    documentId: string;
    validate: HandlerCommitValidation['validateDocument'];
};

export function registerHandlerCommitValidation(
    transaction: Transaction,
    guards: readonly HandlerCommitValidation[],
    postcondition?: DocumentValidation
): void {
    const documentChecks = new Map<string, Array<HandlerCommitValidation['validateDocument']>>();
    const beforeMutationChecks = new Map<string, Array<NonNullable<HandlerCommitValidation['beforeMutation']>>>();
    for (const guard of guards) {
        transaction.validateCommit(() => {
            const reason = guard.beforeCommit();
            if (reason) {
                throw new AutomergeStorageWriteConflictError(reason);
            }
            return null;
        });
        if (guard.beforeMutation) {
            const checks = beforeMutationChecks.get(guard.documentId) ?? [];
            const check = guard.beforeMutation;
            checks.push((document) => {
                const reason = check(document);
                if (reason) {
                    throw new AutomergeStorageWriteConflictError(reason);
                }
                return null;
            });
            beforeMutationChecks.set(guard.documentId, checks);
        }
        const checks = documentChecks.get(guard.documentId) ?? [];
        checks.push((document) => {
            const reason = guard.validateDocument(document);
            if (reason) {
                throw new AutomergeStorageWriteConflictError(reason);
            }
            return null;
        });
        documentChecks.set(guard.documentId, checks);
    }
    if (postcondition) {
        const checks = documentChecks.get(postcondition.documentId) ?? [];
        checks.push(postcondition.validate);
        documentChecks.set(postcondition.documentId, checks);
    }
    for (const [documentId, checks] of documentChecks) {
        let beforeMutation: HandlerCommitValidation['beforeMutation'];
        if (beforeMutationChecks.has(documentId)) {
            beforeMutation = (document) => {
                for (const check of beforeMutationChecks.get(documentId) ?? []) {
                    const reason = check(document);
                    if (reason) {
                        return reason;
                    }
                }
                return null;
            };
        }
        transaction.validateDocument(
            documentId,
            (document) => {
                for (const check of checks) {
                    const reason = check(document);
                    if (reason) {
                        return reason;
                    }
                }
                return null;
            },
            beforeMutation
        );
    }
}
