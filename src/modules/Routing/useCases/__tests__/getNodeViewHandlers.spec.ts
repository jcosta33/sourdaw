import { describe, it, expect } from 'vitest';

import { handleToggleNodeView } from '../../handlers/nodeView/handleToggleNodeView';
import { getNodeViewHandlers } from '../getNodeViewHandlers';

describe('getNodeViewHandlers', () => {
    it('merges the node-view handler map with the toggleNodeView handler wired in', () => {
        const handlers = getNodeViewHandlers();

        expect(handlers).toEqual({ toggleNodeView: handleToggleNodeView });
        expect(handlers.toggleNodeView).toBe(handleToggleNodeView);
    });
});
