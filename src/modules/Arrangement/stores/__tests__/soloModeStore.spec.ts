import { describe, expect, it } from 'vitest';

import { defaultSoloModeState, soloModeStore } from '../soloModeStore';

describe('soloModeStore', () => {
    it('should use single-instance solo by default', () => {
        expect(defaultSoloModeState.soloMode).toBe('sip');
        expect(soloModeStore.value).toEqual(defaultSoloModeState);
    });
});
