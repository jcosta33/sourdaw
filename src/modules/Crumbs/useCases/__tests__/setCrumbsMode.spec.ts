import { describe, it, expect, vi, beforeEach } from 'vitest';
import { switchSamplerMode } from '../setSamplerMode';

const mocks = vi.hoisted(() => ({
    samplerStoreValue: { value: { instanceId: 'inst1' } },
    setMode: vi.fn(),
    setSamplerMode: vi.fn(),
}));

vi.mock('../../stores/samplerStore', () => ({
    samplerStore: { get value() { return mocks.samplerStoreValue.value; } },
    setMode: mocks.setMode,
}));

vi.mock('../../repositories/samplerBridge', () => ({
    setSamplerMode: mocks.setSamplerMode,
}));

describe('switchSamplerMode', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates store and bridge', async () => {
        await switchSamplerMode('slice');
        expect(mocks.setMode).toHaveBeenCalledWith('slice');
        expect(mocks.setSamplerMode).toHaveBeenCalledWith('inst1', 'slice');
    });

    it('bails if no instanceId', async () => {
        mocks.samplerStoreValue.value = null as any;
        await switchSamplerMode('drum');
        expect(mocks.setMode).not.toHaveBeenCalled();
    });
});
