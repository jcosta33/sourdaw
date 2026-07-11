import { beforeEach, describe, expect, it } from 'vitest';

import {
    clearActionReplayCapabilities,
    hasActionReplayCapability,
    registerActionReplayCapability,
} from '../../stores/actionReplayCapabilities';
import { syncActionReplayMetadata } from '../syncActionReplayMetadata';

const original_metadata = {
    id: 'entry-1',
    label: 'Set tempo',
    actionKind: 'setTempo',
    source: 'manual' as const,
    timestamp: 10,
    reverted: false,
};

describe('syncActionReplayMetadata', () => {
    beforeEach(() => {
        clearActionReplayCapabilities();
    });

    it('should revoke a capability when peer hydration changes metadata at the same ID', () => {
        registerActionReplayCapability({
            entryId: original_metadata.id,
            inverseAction: { type: 'togglePlayback' },
            metadata: original_metadata,
        });

        syncActionReplayMetadata([{ ...original_metadata, label: 'Peer replacement' }]);

        expect(hasActionReplayCapability(original_metadata.id)).toBe(false);
    });

    it('should revoke on removal and never restore when the same row is re-added', () => {
        registerActionReplayCapability({
            entryId: original_metadata.id,
            inverseAction: { type: 'togglePlayback' },
            metadata: original_metadata,
        });

        syncActionReplayMetadata([]);
        syncActionReplayMetadata([original_metadata]);

        expect(hasActionReplayCapability(original_metadata.id)).toBe(false);
    });
});
