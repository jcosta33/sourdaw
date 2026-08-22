import { beforeEach, describe, expect, it } from 'vitest';

import { collaborationAssetOwnership, configureCollaborationAssetOwner } from '../getCollaborationAssetOwnerId';

describe('Collaboration durable asset ownership projection', () => {
    let ownerId: string | undefined;

    beforeEach(() => {
        ownerId = 'project:authoritative';
        configureCollaborationAssetOwner({ captureOwnerId: () => ownerId });
    });

    it('captures the current opaque project owner without observing active-track references', () => {
        expect(collaborationAssetOwnership.getOwnerId()).toBe('project:authoritative');

        ownerId = 'project:replacement';

        expect(collaborationAssetOwnership.getOwnerId()).toBe('project:replacement');
    });

    it('fails closed while no authoritative project identity is available', () => {
        ownerId = undefined;

        expect(() => collaborationAssetOwnership.getOwnerId()).toThrow(
            'The active project has no durable asset owner identity'
        );
    });
});
