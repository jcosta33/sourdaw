import { describe, expect, it, vi } from 'vitest';

const morph = { modelA: 'mellow-grand', modelB: 'singing-grand', morphPosition: 0.4, layerBalance: 0.2, enabled: true };
const mocks = vi.hoisted(() => ({
    hydrate: vi.fn(),
    params: vi.fn(),
    store: { value: null },
}));

vi.mock('../hydrateGrandBouleMorphStateFromProject', () => ({ hydrateGrandBouleMorphStateFromProject: mocks.hydrate }));
vi.mock('../../models/projectGrandBouleMorphState', () => ({ projectGrandBouleMorphState: mocks.params }));
vi.mock('../../stores/grandBouleStore', () => ({ createGrandBouleStore: () => mocks.store }));

import { prepareOfflineGrandBoule } from '../prepareOfflineGrandBoule';

describe('prepareOfflineGrandBoule', () => {
    it('applies saved voicing controls to the offline worklet without a panel', () => {
        const postMessage = vi.fn();
        mocks.hydrate.mockReturnValue(morph);
        mocks.params.mockReturnValue([
            { name: 'soundboard_brightness', value: 0.32 },
            { name: 'tone_color', value: -0.58 },
        ]);

        prepareOfflineGrandBoule({ deviceId: 'grand-1', port: { postMessage } as unknown as MessagePort });

        expect(mocks.params).toHaveBeenCalledWith(morph);
        expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'param', name: 'soundboard_brightness', value: 0.32 });
        expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'param', name: 'tone_color', value: -0.58 });
    });
});
