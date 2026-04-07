import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type FaustError = AppError<'Faust'>;

export const createFaustError = (message: string): FaustError =>
    createAppError('Faust', message);
