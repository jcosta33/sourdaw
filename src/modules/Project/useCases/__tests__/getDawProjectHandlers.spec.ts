import { describe, it, expect } from 'vitest';

import { getDawProjectHandlers } from '../getDawProjectHandlers';

describe('getDawProjectHandlers', () => {
    it('maps both DAWproject actions to their handlers with the expected labels', () => {
        const handlers = getDawProjectHandlers();

        expect(Object.keys(handlers).sort()).toEqual(['exportDawProject', 'importDawProject']);

        expect(typeof handlers.exportDawProject.execute).toBe('function');
        expect(typeof handlers.importDawProject.execute).toBe('function');

        expect(handlers.exportDawProject.describe({ type: 'exportDawProject' })).toEqual({
            label: 'Export DAWproject',
        });
        expect(handlers.importDawProject.describe({ type: 'importDawProject' })).toEqual({
            label: 'Import DAWproject',
        });
    });
});
