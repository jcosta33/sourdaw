import { describe, expect, it } from 'vitest';

import { DOC_BRANCHES, DOC_PREFIX_ROOT } from '../crdtDocumentTypes';

describe('crdtDocumentTypes', () => {
    it('defines stable document id constants', () => {
        expect(DOC_PREFIX_ROOT).toBe('root');
        expect(DOC_BRANCHES).toBe('__branches__');
    });
});
