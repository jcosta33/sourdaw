import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    setMode: vi.fn(),
    setCrumbsMode: vi.fn(),
    emit: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../stores/crumbsStore', () => ({
    crumbsStore: { value: {} },
    setMode: mocks.setMode,
}));

vi.mock('../../repositories/crumbsBridge/setCrumbsMode', () => ({
    setCrumbsMode: mocks.setCrumbsMode,
}));

import { setCrumbsEventBus } from '../../stores/crumbsEventBus';
import { switchCrumbsMode } from '../setCrumbsMode';

describe('switchCrumbsMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCrumbsEventBus({ emit: mocks.emit });
    });

    it('updates store and bridge and announces the mode change', async () => {
        await switchCrumbsMode('inst1', 'slice');
        expect(mocks.emit).toHaveBeenCalledWith('crumbs.modeChanged', { deviceId: 'inst1', mode: 'slice' });
        expect(mocks.setMode).toHaveBeenCalledWith('inst1', 'slice');
        expect(mocks.setCrumbsMode).toHaveBeenCalledWith('inst1', 'slice');
    });

    it('logs warning when bridge fails but still updates store', async () => {
        mocks.setCrumbsMode.mockRejectedValueOnce(new Error('bridge fail'));
        await switchCrumbsMode('inst1', 'drum');
        expect(mocks.setMode).toHaveBeenCalledWith('inst1', 'drum');
    });
});
