import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    setMode: vi.fn(),
    setCrumbsMode: vi.fn(),
}));

vi.mock('../../stores/crumbsStore', () => ({
    crumbsStore: { value: {} },
    setMode: mocks.setMode,
}));

vi.mock('../../repositories/crumbsBridge', () => ({
    setCrumbsMode: mocks.setCrumbsMode,
}));

import { switchCrumbsMode } from '../setCrumbsMode';

describe('switchCrumbsMode', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates store and bridge', async () => {
        await switchCrumbsMode('inst1', 'slice');
        expect(mocks.setMode).toHaveBeenCalledWith('inst1', 'slice');
        expect(mocks.setCrumbsMode).toHaveBeenCalledWith('inst1', 'slice');
    });

    it('logs warning when bridge fails but still updates store', async () => {
        mocks.setCrumbsMode.mockRejectedValueOnce(new Error('bridge fail'));
        await switchCrumbsMode('inst1', 'drum');
        expect(mocks.setMode).toHaveBeenCalledWith('inst1', 'drum');
    });
});
