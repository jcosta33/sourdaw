import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleNodeView } from '#/modules/Plugin/useCases';

import { handleToggleNodeView } from '../handleToggleNodeView';

vi.mock('#/modules/Plugin/useCases', () => ({
    toggleNodeView: vi.fn(),
}));

describe('handleToggleNodeView', () => {
    beforeEach(() => {
        vi.mocked(toggleNodeView).mockClear();
    });

    it('forwards to toggleNodeView', () => {
        void handleToggleNodeView.execute({ type: 'toggleNodeView', payload: undefined });

        expect(toggleNodeView).toHaveBeenCalledTimes(1);
    });
});
