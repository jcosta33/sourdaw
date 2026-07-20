import { describe, it, expect, vi } from 'vitest';

vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }]))
        ),
}));
vi.mock('#/utils/createHandler', () => ({ createHandler: (config: unknown) => config }));

import { handleCreateCollabSession } from '../../handlers/collaboration/handleCreateCollabSession';
import { handleJoinCollabSession } from '../../handlers/collaboration/handleJoinCollabSession';
import { handleLeaveCollabSession } from '../../handlers/collaboration/handleLeaveCollabSession';
import { getCollaborationHandlers } from '../getCollaborationHandlers';

describe('getCollaborationHandlers', () => {
    it('maps each collaboration action type to its own dedicated handler', () => {
        const handlers = getCollaborationHandlers();

        expect(handlers.createCollabSession).toBe(handleCreateCollabSession);
        expect(handlers.joinCollabSession).toBe(handleJoinCollabSession);
        expect(handlers.leaveCollabSession).toBe(handleLeaveCollabSession);
    });

    it('exposes exactly the three collaboration action types and no others', () => {
        const handlers = getCollaborationHandlers();

        expect(Object.keys(handlers).sort()).toEqual(
            ['createCollabSession', 'joinCollabSession', 'leaveCollabSession'].sort()
        );
    });
});
