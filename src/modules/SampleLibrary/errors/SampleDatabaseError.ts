import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type SampleDatabaseError = AppError<'SampleDatabase'>;

export const createSampleDatabaseError = (message: string): SampleDatabaseError =>
    createAppError('SampleDatabase', message);
