import { createAppError, type AppError } from '#/infra/errors/createAppError';

type CrdtPersistenceRootLineageConflictData = {
    readonly localRootLineage: string;
    readonly durableRootLineage: string;
};

export type CrdtPersistenceRootLineageConflictError = AppError<
    'CrdtPersistenceRootLineageConflict',
    CrdtPersistenceRootLineageConflictData
>;

type CreateCrdtPersistenceRootLineageConflictErrorInput = CrdtPersistenceRootLineageConflictData;

export const createCrdtPersistenceRootLineageConflictError = ({
    localRootLineage,
    durableRootLineage,
}: CreateCrdtPersistenceRootLineageConflictErrorInput): CrdtPersistenceRootLineageConflictError =>
    createAppError(
        'CrdtPersistenceRootLineageConflict',
        '[CrdtPersistence] Active root lineage changed in another realm; reload is required before saving',
        { localRootLineage, durableRootLineage }
    );
