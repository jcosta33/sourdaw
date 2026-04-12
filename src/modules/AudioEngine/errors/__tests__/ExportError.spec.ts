import { describe, expect, it } from 'vitest';

import { isAppError } from '#/infra/errors/isAppError';

import { createExportError } from '../ExportError';

describe('createExportError', () => {
    it('builds a tagged Export AppError', () => {
        const err = createExportError('disk full');
        expect(err._tag).toBe('Export');
        expect(err.message).toBe('disk full');
        expect(isAppError(err)).toBe(true);
    });

    it('attaches an optional cause', () => {
        const inner = new Error('encoder');
        const err = createExportError('render failed', inner);
        expect(err.cause).toBe(inner);
    });
});
