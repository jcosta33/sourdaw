import { describe, it, expect } from 'vitest';
import { getCollaborationHandlers } from '../getCollaborationHandlers';

describe('getCollaborationHandlers', () => {
    it('returns a fresh map of collaboration command handlers', () => {
        const map = getCollaborationHandlers();
        expect(map.createCollabSession).toBeDefined();
        expect(map.joinCollabSession).toBeDefined();
        expect(map.leaveCollabSession).toBeDefined();
        // not the same identity each call (factory must build a new object)
        expect(getCollaborationHandlers()).not.toBe(map);
    });
});
