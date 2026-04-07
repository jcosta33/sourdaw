import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type CollaborationError = AppError<'Collaboration'>;

export const createCollaborationError = (message: string, cause?: unknown): CollaborationError =>
    createAppError('Collaboration', message, {}, cause);
