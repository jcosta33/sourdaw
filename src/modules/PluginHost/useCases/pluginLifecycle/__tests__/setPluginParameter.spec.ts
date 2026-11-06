import { describe, expect, it, vi } from 'vitest';

import { setPluginParameter as setPluginParameterRepository } from '../../../repositories/pluginBridge/setPluginParameter';
import { setPluginParameter } from '../setPluginParameter';

vi.mock('../../../repositories/pluginBridge/setPluginParameter', () => ({
    setPluginParameter: vi.fn(),
}));

describe('setPluginParameter', () => {
    it('should delegate native plugin parameter updates to the Plugin repository boundary', async () => {
        await setPluginParameter({ instanceId: 'instance-1', paramId: 9, value: 0.25 });

        expect(setPluginParameterRepository).toHaveBeenCalledWith({
            instanceId: 'instance-1',
            paramId: 9,
            value: 0.25,
        });
    });
});
