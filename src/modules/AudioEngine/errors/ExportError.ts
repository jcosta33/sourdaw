import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type ExportError = AppError<'Export'>;

export const createExportError = (message: string, cause?: unknown): ExportError =>
    createAppError('Export', message, {}, cause);
