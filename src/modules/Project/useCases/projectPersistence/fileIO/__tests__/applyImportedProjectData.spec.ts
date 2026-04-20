import { describe, it, expect } from 'vitest';

import * as subject from '../applyImportedProjectData';

describe('applyImportedProjectData', () => {
    it('should export applyImportedProjectData', () => {
        expect(subject.applyImportedProjectData).toBeDefined();
        const t = typeof subject.applyImportedProjectData;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
