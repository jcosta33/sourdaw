import { describe, expect, it } from 'vitest';

import { getTemplates } from '../getTemplates';

describe('getTemplates', () => {
    it('excludes native-only templates in the browser', () => {
        const ids = getTemplates().map((time) => time.id);
        expect(ids).not.toContain('demo-native-showcase');
    });

    it('always includes the empty project template', () => {
        const ids = getTemplates().map((time) => time.id);
        expect(ids).toContain('empty');
    });

    it('includes the genre and demo templates', () => {
        const ids = getTemplates().map((t) => t.id);
        expect(ids).toContain('pop-song');
        expect(ids).toContain('demo-nebula-drift');
    });
});
