import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToggleNodeView } from '../handleToggleNodeView';

vi.mock('#/modules/Plugin/useCases', () => ({
    toggleNodeView: vi.fn(),
}));

import { toggleNodeView } from '#/modules/Plugin/useCases';

describe('handleToggleNodeView', () => {
    beforeEach(() => {
        vi.mocked(toggleNodeView).mockClear();
    });

    it('forwards to toggleNodeView', () => {
        handleToggleNodeView.execute({ type: 'toggleNodeView', payload: undefined });

        expect(toggleNodeView).toHaveBeenCalledTimes(1);
    });
});
