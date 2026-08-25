import { describe, expect, it } from 'vitest';

import { MODEL_RELEASE_ADMISSION } from '../modelReleaseAdmission';

describe('model release admission', () => {
    it('admits WebLLM in the shipped release', () => {
        expect(MODEL_RELEASE_ADMISSION.webLlm).toBe(true);
    });
});
