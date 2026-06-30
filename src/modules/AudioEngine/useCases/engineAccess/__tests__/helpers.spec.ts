import { describe, it, expect } from 'vitest';

import { disableLink } from '../disableLink';
import { enableLink } from '../enableLink';
import { getLinkStatus } from '../getLinkStatus';

describe('link use cases', () => {
    it('should export callable Link controls', () => {
        expect(typeof disableLink).toBe('function');
        expect(typeof enableLink).toBe('function');
        expect(typeof getLinkStatus).toBe('function');
    });
});
