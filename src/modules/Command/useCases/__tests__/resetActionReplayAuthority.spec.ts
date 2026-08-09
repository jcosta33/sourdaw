/**
 * The outcome half of the undo finding.
 *
 * `resetCrdtProjectAuthority` used to call this first, before the document swap
 * that makes it necessary, so every abort on that path emptied the inverse-
 * action map while the project it described was still open — the user's undo
 * entries kept rendering and silently did nothing. The ordering is pinned in
 * `CrdtDocument/useCases/__tests__/resetCrdtProjectAuthority.spec.ts`; what that
 * ordering costs is pinned here, against the real capability store.
 */

import { describe, expect, it } from 'vitest';

import { hasActionReplayCapability, registerActionReplayCapability } from '../../stores/actionReplayCapabilities';
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';

describe('resetActionReplayAuthority', () => {
    it('makes a registered entry unreplayable', () => {
        registerActionReplayCapability({
            entryId: 'entry-under-test',
            inverseAction: { type: 'togglePlayback' },
            metadata: {
                id: 'entry-under-test',
                label: 'Toggle playback',
                actionKind: 'togglePlayback',
                source: 'manual',
                timestamp: 1_700_000_000_000,
            },
        });
        expect(hasActionReplayCapability('entry-under-test')).toBe(true);

        resetActionReplayAuthority();

        // This is the cost of calling it: the entry is still in the user's undo
        // list, and it can no longer be replayed.
        expect(hasActionReplayCapability('entry-under-test')).toBe(false);
    });
});
