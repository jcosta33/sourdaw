import { describe, expect, it } from 'vitest';

import { getTemplates } from '../getTemplates';

describe('getTemplates', () => {
    it('always includes the empty project template', () => {
        const ids = getTemplates().map((t) => t.id);
        expect(ids).toContain('empty');
    });

    it('includes the genre and demo templates', () => {
        const ids = getTemplates().map((t) => t.id);
        expect(ids).toContain('pop-song');
        expect(ids).toContain('demo-complete');
        expect(ids).toContain('demo-nebula-drift');
    });
});
