import { beforeEach, describe, expect, it } from 'vitest';

import {
    claimActionReplayCapability,
    clearActionReplayCapabilities,
    hasActionReplayCapability,
    registerActionReplayCapability,
    restoreActionReplayCapability,
} from '../actionReplayCapabilities';

describe('action replay capabilities', () => {
    beforeEach(() => {
        clearActionReplayCapabilities();
    });

    it('should atomically claim a typed inverse once', () => {
        const inverseAction = { type: 'togglePlayback' } as const;
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction });

        expect(hasActionReplayCapability('entry-1')).toBe(true);
        const claim = claimActionReplayCapability('entry-1');
        expect(claim?.inverseAction).toEqual(inverseAction);
        expect(claim?.generation).toBeTypeOf('number');
        expect(claimActionReplayCapability('entry-1')).toBeNull();
        expect(hasActionReplayCapability('entry-1')).toBe(false);
    });

    it('should restore a claimed inverse after a failed replay', () => {
        const inverseAction = { type: 'setTempo', payload: { bpm: 120 } } as const;
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction });

        const claim = claimActionReplayCapability('entry-1');
        if (claim === null) {
            throw new Error('Expected the capability to be claimed');
        }

        restoreActionReplayCapability({ entryId: 'entry-1', claim });

        expect(claimActionReplayCapability('entry-1')?.inverseAction).toEqual(inverseAction);
    });

    it('should not restore a claim from a generation cleared while replay was pending', () => {
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } });
        const claim = claimActionReplayCapability('entry-1');
        if (claim === null) {
            throw new Error('Expected the capability to be claimed');
        }

        clearActionReplayCapabilities();
        restoreActionReplayCapability({ entryId: 'entry-1', claim });

        expect(hasActionReplayCapability('entry-1')).toBe(false);
    });

    it('should prune the oldest capabilities at the history bound', () => {
        for (let index = 0; index < 201; index += 1) {
            registerActionReplayCapability({
                entryId: `entry-${index}`,
                inverseAction: { type: 'togglePlayback' },
            });
        }

        expect(hasActionReplayCapability('entry-0')).toBe(false);
        expect(hasActionReplayCapability('entry-1')).toBe(true);
        expect(hasActionReplayCapability('entry-200')).toBe(true);
    });

    it('should clear all capabilities without affecting another owner', () => {
        registerActionReplayCapability({ entryId: 'entry-1', inverseAction: { type: 'togglePlayback' } });

        clearActionReplayCapabilities();

        expect(hasActionReplayCapability('entry-1')).toBe(false);
    });
});
