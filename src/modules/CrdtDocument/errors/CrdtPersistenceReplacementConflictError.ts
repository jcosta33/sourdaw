import { createAppError, type AppError } from '#/infra/errors/createAppError';

/**
 * The authority figures the swap compared, carried as plain data.
 *
 * Errors describe what happened; they do not depend on the repository layer
 * that produced these figures, so the shape is stated here.
 */
type PersistenceAuthorityFigure = {
    readonly epoch: string;
    readonly revision: number;
    readonly rootLineage: string;
};

type CrdtPersistenceReplacementConflictData = {
    readonly expected: PersistenceAuthorityFigure;
    readonly actual: PersistenceAuthorityFigure;
};

/**
 * A project replacement lost the compare-and-swap on the authority it claimed.
 *
 * An ordinary conflict is merged: two realms editing one project both belong in
 * the result. A replacement is the opposite — the incoming project is not a
 * concurrent edit of the outgoing one, so merging would fold the project the
 * user just left into the one they just created.
 */
export type CrdtPersistenceReplacementConflictError = AppError<
    'CrdtPersistenceReplacementConflict',
    CrdtPersistenceReplacementConflictData
>;

type CreateCrdtPersistenceReplacementConflictErrorInput = CrdtPersistenceReplacementConflictData;

export const createCrdtPersistenceReplacementConflictError = ({
    expected,
    actual,
}: CreateCrdtPersistenceReplacementConflictErrorInput): CrdtPersistenceReplacementConflictError =>
    createAppError(
        'CrdtPersistenceReplacementConflict',
        '[CrdtPersistence] The project being replaced changed in another realm; the replacement was not written',
        { expected, actual }
    );
