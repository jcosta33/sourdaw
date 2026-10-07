import { createExportError, type ExportError } from './ExportError';

/** A second musician export asked for the render lock while one already holds or awaits it. */
export const createExportInProgressError = (): ExportError =>
    createExportError('An export is already in progress. Cancel the current export before starting a new one.');
