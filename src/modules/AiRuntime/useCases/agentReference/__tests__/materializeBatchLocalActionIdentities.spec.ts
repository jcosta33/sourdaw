import { describe, expect, it } from 'vitest';

import { materializeBatchLocalActionIdentities } from '../materializeBatchLocalActionIdentities';

const busId = 'bus-ai-12345678-1234-4123-8123-123456789abc';
const deviceId = 'device-ai-12345678-1234-4123-8123-123456789abc';
const trackId = 'track-ai-12345678-1234-4123-8123-123456789abc';
const initialDeviceId = 'device-command-12345678-1234-4123-8123-123456789abc';
const secondTrackId = 'track-ai-87654321-4321-4321-8321-cba987654321';
const clipId = 'clip-ai-12345678-1234-4123-8123-123456789abc';

describe('materializeBatchLocalActionIdentities', () => {
    it('adds an application-owned bus ID only after provider actions are validated', () => {
        const result = materializeBatchLocalActionIdentities(
            [
                { type: 'createBus', payload: { name: 'Vocal Plate' } },
                { type: 'addDevice', payload: { trackId: busId, deviceType: 'builtin-reverb' } },
            ],
            [{ actionType: 'createBus', actionOrdinal: 0, busId }]
        );

        expect(result).toEqual({
            status: 'accepted',
            actions: [
                { type: 'createBus', payload: { name: 'Vocal Plate', busId } },
                { type: 'addDevice', payload: { trackId: busId, deviceType: 'builtin-reverb' } },
            ],
        });
    });

    it('adds an application-owned initial bus gain without exposing it to the provider action', () => {
        const result = materializeBatchLocalActionIdentities(
            [{ type: 'createBus', payload: { name: 'Vocal Delay' } }],
            [{ actionType: 'createBus', actionOrdinal: 0, busId, initialGain: 1 }]
        );

        expect(result).toEqual({
            status: 'accepted',
            actions: [{ type: 'createBus', payload: { name: 'Vocal Delay', busId, initialGain: 1 } }],
        });
    });

    it('adds an application-owned device ID only after the matching provider action is validated', () => {
        const result = materializeBatchLocalActionIdentities(
            [{ type: 'addDevice', payload: { trackId: busId, deviceType: 'builtin-reverb' } }],
            [{ actionType: 'addDevice', actionOrdinal: 0, deviceId }]
        );

        expect(result).toEqual({
            status: 'accepted',
            actions: [
                {
                    type: 'addDevice',
                    payload: { trackId: busId, deviceType: 'builtin-reverb', deviceId },
                },
            ],
        });
    });

    it.each([
        {
            identity: { actionType: 'createBus' as const, actionOrdinal: 0, busId: 'provider-id' },
            reason: 'Invalid or duplicate batch-local action identity',
        },
        {
            identity: { actionType: 'createBus' as const, actionOrdinal: 2, busId },
            reason: 'Batch-local action identity has no validated createBus action',
        },
        {
            identity: { actionType: 'createBus' as const, actionOrdinal: 0, busId, initialGain: 3 },
            reason: 'Invalid or duplicate batch-local action identity',
        },
    ])('rejects identity metadata that cannot correspond to a validated createBus action', ({ identity, reason }) => {
        const result = materializeBatchLocalActionIdentities(
            [{ type: 'createBus', payload: { name: 'Vocal Plate' } }],
            [identity]
        );

        expect(result).toEqual({ status: 'rejected', reason });
    });

    it('adds application-owned track and clip IDs to their own ordinals', () => {
        const result = materializeBatchLocalActionIdentities(
            [
                { type: 'addTrack', payload: { name: 'Piano', kind: 'midi' } },
                { type: 'addTrack', payload: { name: 'Strings', kind: 'midi' } },
                { type: 'addClip', payload: { trackId, startBeat: 0, endBeat: 4, name: 'Melody' } },
            ],
            [
                { actionType: 'addTrack', actionOrdinal: 1, trackId: secondTrackId },
                { actionType: 'addTrack', actionOrdinal: 0, initialDeviceId, trackId },
                { actionType: 'addClip', actionOrdinal: 0, clipId },
            ]
        );

        expect(result).toEqual({
            status: 'accepted',
            actions: [
                {
                    type: 'addTrack',
                    payload: { name: 'Piano', kind: 'midi', id: trackId, initialDeviceId },
                },
                { type: 'addTrack', payload: { name: 'Strings', kind: 'midi', id: secondTrackId } },
                { type: 'addClip', payload: { trackId, startBeat: 0, endBeat: 4, name: 'Melody', id: clipId } },
            ],
        });
    });

    it.each([
        {
            identity: { actionType: 'addTrack' as const, actionOrdinal: 0, trackId: busId },
            reason: 'Invalid or duplicate batch-local action identity',
        },
        {
            identity: { actionType: 'addClip' as const, actionOrdinal: 0, clipId: trackId },
            reason: 'Invalid or duplicate batch-local action identity',
        },
        {
            identity: { actionType: 'addClip' as const, actionOrdinal: 0, clipId },
            reason: 'Batch-local action identity has no validated addClip action',
        },
        {
            identity: { actionType: 'addTrack' as const, actionOrdinal: 0, trackId, initialDeviceId: deviceId },
            reason: 'Invalid or duplicate batch-local action identity',
        },
    ])('refuses a creation identity whose shape does not match its own action type', ({ identity, reason }) => {
        const result = materializeBatchLocalActionIdentities(
            [{ type: 'addTrack', payload: { name: 'Piano', kind: 'midi' } }],
            [identity]
        );

        expect(result).toEqual({ status: 'rejected', reason });
    });

    it('refuses two creation identities that mint the same ID', () => {
        const result = materializeBatchLocalActionIdentities(
            [
                { type: 'addTrack', payload: { name: 'Piano', kind: 'midi' } },
                { type: 'addTrack', payload: { name: 'Strings', kind: 'midi' } },
            ],
            [
                { actionType: 'addTrack', actionOrdinal: 0, trackId },
                { actionType: 'addTrack', actionOrdinal: 1, trackId },
            ]
        );

        expect(result).toEqual({ status: 'rejected', reason: 'Invalid or duplicate batch-local action identity' });
    });

    it('rejects an application-owned device identity without a matching validated addDevice action', () => {
        const result = materializeBatchLocalActionIdentities(
            [{ type: 'createBus', payload: { name: 'Vocal Plate' } }],
            [{ actionType: 'addDevice', actionOrdinal: 0, deviceId }]
        );

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Batch-local action identity has no validated addDevice action',
        });
    });
});
