import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type AiRuntimeError = AppError<'AiRuntime'>;

export const createAiRuntimeError = (message: string, cause?: unknown): AiRuntimeError =>
    createAppError('AiRuntime', message, {}, cause);
