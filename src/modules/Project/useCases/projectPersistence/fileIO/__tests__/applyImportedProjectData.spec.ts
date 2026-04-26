import { describe, it, expect } from 'vitest';

import * as subject from '../applyImportedProjectData';

describe('applyImportedProjectData', () => {
    it('should export applyImportedProjectData', () => {
        expect(subject.applyImportedProjectData).toBeDefined();
        const time = typeof subject.applyImportedProjectData;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
