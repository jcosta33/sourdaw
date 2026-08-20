import { beforeEach, describe, expect, it } from 'vitest';

import { raveStore } from '../../../stores/rave';
import { isRaveModelPresent } from '../isRaveModelPresent';

describe('isRaveModelPresent', () => {
    beforeEach(() => {
        raveStore.set({
            models: [
                {
                    id: 'rave-strings',
                    name: 'Strings',
                    category: 'strings',
                    latentDim: 16,
                    sampleRate: 48_000,
                    sizeMb: 64,
                    loaded: false,
                    modelPath: 'models/rave/strings.onnx',
                },
            ],
            activeModelId: null,
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
    });

    it('ignores stale registry state while RAVE artifacts are withheld', () => {
        expect(isRaveModelPresent('rave-strings')).toBe(false);
    });
});
