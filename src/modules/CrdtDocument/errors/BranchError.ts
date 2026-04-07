import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type BranchError = AppError<'Branch'>;

export const createBranchError = (message: string): BranchError =>
    createAppError('Branch', message);
