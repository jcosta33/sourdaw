import { createAppError, type AppError } from '#/infra/errors/createAppError';

/** An agent measurement could not hold the render lock: another render has it, or a musician's export took it. */
export type RenderBusyError = AppError<'RenderBusy'>;

export const createRenderBusyError = (message: string, cause?: unknown): RenderBusyError =>
    createAppError('RenderBusy', message, {}, cause);
