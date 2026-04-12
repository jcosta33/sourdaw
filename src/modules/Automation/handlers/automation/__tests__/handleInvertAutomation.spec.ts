import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleInvertAutomation } from '../handleInvertAutomation';

vi.mock('../../../useCases/automation/invertAutomation', () => ({
    invertAutomation: vi.fn(),
}));

import { invertAutomation } from '../../../useCases/automation/invertAutomation';

describe('handleInvertAutomation', () => {
    beforeEach(() => {
        vi.mocked(invertAutomation).mockClear();
    });

    it('forwards laneId', () => {
        handleInvertAutomation.execute({ type: 'invertAutomation', payload: { laneId: 'lane-1' } });

        expect(invertAutomation).toHaveBeenCalledWith('lane-1');
    });
});
