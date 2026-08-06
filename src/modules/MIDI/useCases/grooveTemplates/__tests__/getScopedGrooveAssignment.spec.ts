import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetGrooveAssignment, mockGetScopedConsumerId } = vi.hoisted(() => ({
    mockGetGrooveAssignment: vi.fn(),
    mockGetScopedConsumerId: vi.fn(),
}));

vi.mock('../getGrooveAssignment', () => ({ getGrooveAssignment: mockGetGrooveAssignment }));
vi.mock('../getScopedGrooveConsumerId', () => ({ getScopedGrooveConsumerId: mockGetScopedConsumerId }));

import { getScopedGrooveAssignment } from '../getScopedGrooveAssignment';

describe('getScopedGrooveAssignment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetScopedConsumerId.mockReturnValue('owner:local');
    });
    it('returns the scoped assignment when one exists for the scoped consumer id', () => {
        const assignment = { consumerType: 'clip', consumerId: 'owner:local', templateId: 'groove-1', amount: 0.5 };
        mockGetScopedConsumerId.mockReturnValue('owner:local');
        mockGetGrooveAssignment.mockReturnValue(assignment);
        const result = getScopedGrooveAssignment({ consumerType: 'clip', ownerId: 'owner', localId: 'local' });
        expect(result).toBe(assignment);
        expect(mockGetGrooveAssignment).toHaveBeenCalledExactlyOnceWith({
            consumerType: 'clip',
            consumerId: 'owner:local',
        });
    });

    it('falls back to the legacy unscoped consumer id when no scoped assignment exists', () => {
        mockGetScopedConsumerId.mockReturnValue('owner:local');
        const legacyAssignment = {
            consumerType: 'clip',
            consumerId: 'local',
            templateId: 'groove-2',
            amount: 1,
        };
        mockGetGrooveAssignment.mockReturnValueOnce(undefined).mockReturnValueOnce(legacyAssignment);
        const result = getScopedGrooveAssignment({ consumerType: 'clip', ownerId: 'owner', localId: 'local' });
        expect(result).toBe(legacyAssignment);
        expect(mockGetGrooveAssignment).toHaveBeenCalledTimes(2);
    });

    it('returns undefined when neither scoped nor legacy assignment exists', () => {
        mockGetScopedConsumerId.mockReturnValue('owner:local');
        mockGetGrooveAssignment.mockReturnValue(undefined);
        const result = getScopedGrooveAssignment({ consumerType: 'clip', ownerId: 'owner', localId: 'local' });
        expect(result).toBeUndefined();
    });
});
