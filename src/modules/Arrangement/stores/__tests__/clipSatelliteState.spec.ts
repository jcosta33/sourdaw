import { beforeEach, describe, expect, it } from 'vitest';

import { createWarpMarker, defaultWarpState } from '../../models/WarpMarker';
import { createClipSatelliteTransitionPlan, readClipSatelliteEntry } from '../clipSatelliteState';
import { __resetGainEnvelopesForTest, setEnvelope } from '../gainEnvelopeStore';
import { setWarpState, warpStates } from '../warpStates';

function envelope(clipId: string) {
    return { clipId, enabled: true, points: [{ id: `${clipId}-p`, beatOffset: 1, gainDb: -6 }] };
}

function warpState() {
    return { ...defaultWarpState, enabled: true, markers: [createWarpMarker(0, 0.5, { origin: 'user' as const })] };
}

describe('clipSatelliteState', () => {
    beforeEach(() => {
        warpStates.clear();
        __resetGainEnvelopesForTest();
    });

    it('drops own keys holding undefined when reading a marker the app placed by hand', () => {
        setWarpState('clip-1', warpState());
        // `createWarpMarker` always writes the key, value or not.
        expect(Object.hasOwn(warpStates.get('clip-1')?.markers[0] ?? {}, 'confidence')).toBe(true);

        const entry = readClipSatelliteEntry('clip-1');

        // A snapshot carrying it would not survive the canonical JSON round
        // trip the inverse-plan encoder verifies.
        expect(Object.hasOwn(entry.warpState?.markers[0] ?? {}, 'confidence')).toBe(false);
        expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    });

    it('captures a removal as a cleared replacement and skips clips carrying nothing', () => {
        setEnvelope('clip-1', envelope('clip-1'));

        const plan = createClipSatelliteTransitionPlan({ removedClipIds: ['clip-1', 'bare'], migrations: [] });

        expect(plan?.expected.entries).toEqual([
            { clipId: 'clip-1', gainEnvelope: envelope('clip-1'), warpState: null },
        ]);
        expect(plan?.replacement.entries).toEqual([{ clipId: 'clip-1', gainEnvelope: null, warpState: null }]);
    });

    it('captures a migration as a move that re-keys the envelope onto the target', () => {
        setEnvelope('source', envelope('source'));
        setWarpState('source', warpState());

        const plan = createClipSatelliteTransitionPlan({
            removedClipIds: [],
            migrations: [{ sourceClipId: 'source', targetClipId: 'target' }],
        });

        expect(plan?.expected.entries.map((entry) => entry.clipId)).toEqual(['source', 'target']);
        expect(plan?.expected.entries[1]).toEqual({ clipId: 'target', gainEnvelope: null, warpState: null });
        expect(plan?.replacement.entries[0]).toEqual({ clipId: 'source', gainEnvelope: null, warpState: null });
        expect(plan?.replacement.entries[1]?.gainEnvelope).toEqual({ ...envelope('source'), clipId: 'target' });
        expect(plan?.replacement.entries[1]?.warpState).toEqual(readClipSatelliteEntry('source').warpState);
    });

    it('refuses a transition that addresses one clip id twice', () => {
        setEnvelope('clip-1', envelope('clip-1'));

        expect(createClipSatelliteTransitionPlan({ removedClipIds: ['clip-1', 'clip-1'], migrations: [] })).toBeNull();
        expect(
            createClipSatelliteTransitionPlan({
                removedClipIds: ['clip-1'],
                migrations: [{ sourceClipId: 'clip-1', targetClipId: 'clip-2' }],
            })
        ).toBeNull();
        expect(
            createClipSatelliteTransitionPlan({
                removedClipIds: [],
                migrations: [
                    { sourceClipId: 'clip-1', targetClipId: 'clip-2' },
                    { sourceClipId: 'clip-3', targetClipId: 'clip-2' },
                ],
            })
        ).toBeNull();
    });
});
