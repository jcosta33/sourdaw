import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type AiGenerationError = AppError<'AiGeneration'>;

export const createAiGenerationError = (message: string, cause?: unknown): AiGenerationError =>
    createAppError('AiGeneration', message, {}, cause);
