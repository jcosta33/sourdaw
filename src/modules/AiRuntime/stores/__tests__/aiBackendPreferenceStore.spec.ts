import { describe, expect, it } from 'vitest';

import { aiBackendPreferenceStore } from '../aiBackendPreferenceStore';

describe('aiBackendPreferenceStore', () => {
    it('defaults new sessions to the explicit browser-local backend', () => {
        expect(aiBackendPreferenceStore.value).toBe('webllm');
    });
});
