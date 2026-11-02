import { afterEach, describe, expect, it } from 'vitest';

import { defaultSoloModeState, soloModeStore } from '../../../stores/soloModeStore';
import { setSoloMode } from '../setSoloMode';

describe('setSoloMode', () => {
    afterEach(() => {
        soloModeStore.set(defaultSoloModeState);
    });

    it('does not update when solo mode state is missing', () => {
        soloModeStore.set(null);

        setSoloMode('afl');

        expect(soloModeStore.value).toBeNull();
    });

    it('writes the solo mode when solo mode state exists', () => {
        soloModeStore.set(defaultSoloModeState);

        setSoloMode('afl');

        expect(soloModeStore.value).toEqual({ soloMode: 'afl' });
    });
});
