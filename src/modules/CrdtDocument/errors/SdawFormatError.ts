import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type SdawFormatError = AppError<'SdawFormat'>;

export const createSdawFormatError = (message: string): SdawFormatError =>
    createAppError('SdawFormat', message);
