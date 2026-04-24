import { describe, it, expect, vi } from 'vitest';

import { type PluginDescriptor } from '../../models/DeviceParameter';
import { getPluginById } from '../getPluginById';

const mocks = vi.hoisted(() => ({
    getPluginById: vi.fn<typeof import('../../models/DeviceParameter').getPluginById>(),
}));

vi.mock('../../models/DeviceParameter', () => ({
    getPluginById: mocks.getPluginById,
}));

describe('getPluginById', () => {
    it('should forward the id to the model and return its result', () => {
        const descriptor = { id: 'builtin-1', name: 'Test' } as unknown as PluginDescriptor;
        mocks.getPluginById.mockReturnValue(descriptor);

        expect(getPluginById('builtin-1')).toBe(descriptor);
        expect(mocks.getPluginById).toHaveBeenCalledWith('builtin-1');
    });
});
