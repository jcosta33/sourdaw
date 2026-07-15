import { createAppError, type AppError } from '#/infra/errors/createAppError';

type CrdtPersistenceMembershipConflictData = {
    readonly localDocumentIds: readonly string[];
    readonly durableDocumentIds: readonly string[];
};

export type CrdtPersistenceMembershipConflictError = AppError<
    'CrdtPersistenceMembershipConflict',
    CrdtPersistenceMembershipConflictData
>;

type CreateCrdtPersistenceMembershipConflictErrorInput = CrdtPersistenceMembershipConflictData;

export const createCrdtPersistenceMembershipConflictError = ({
    localDocumentIds,
    durableDocumentIds,
}: CreateCrdtPersistenceMembershipConflictErrorInput): CrdtPersistenceMembershipConflictError =>
    createAppError(
        'CrdtPersistenceMembershipConflict',
        '[CrdtPersistence] Document membership changed in another realm; reload is required before saving',
        {
            localDocumentIds: [...localDocumentIds],
            durableDocumentIds: [...durableDocumentIds],
        }
    );
