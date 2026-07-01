import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../repositories/applyParams', () => ({
    applyParams: vi.fn(),
}));

import { applyParams as applyParamsImpl } from '../../../repositories/applyParams';
import { type OfflineDeviceNode } from '../../../repositories/deviceNodeFactory';
import { applyParams } from '../applyParams';

describe('applyParams', () => {
    it('should delegate to the AudioEngine repository implementation', () => {
        const node: OfflineDeviceNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [],
        };
        const params = { gain: 0.5 };

        applyParams(node, 'builtin-gain', params);

        expect(vi.mocked(applyParamsImpl)).toHaveBeenCalledWith(node, 'builtin-gain', params);
    });
});
