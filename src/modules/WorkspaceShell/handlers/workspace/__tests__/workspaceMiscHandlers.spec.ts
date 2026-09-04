import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setSnapValue } from '../../../useCases/togglePanel/panelToggles/setSnapValue';
import { handleSetSnapValue } from '../handleSetSnapValue';

vi.mock('../../../useCases/togglePanel/panelToggles/setSnapValue', () => ({ setSnapValue: vi.fn() }));

describe('Workspace Misc Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleSetSnapValue should delegate to setSnapValue', () => {
        void handleSetSnapValue.execute({ type: 'setSnapValue', payload: { value: 0.5 } });
        expect(setSnapValue).toHaveBeenCalledWith(0.5);
    });
});
