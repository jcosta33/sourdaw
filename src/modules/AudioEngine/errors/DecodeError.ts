import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type DecodeError = AppError<'Decode'>;

export const createDecodeError = (message: string): DecodeError =>
    createAppError('Decode', message);
