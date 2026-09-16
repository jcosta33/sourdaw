import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { insertReplacementClips } from '../clipReplacementSnapshot';

function insertSnapshot(snapshot: ReturnType<typeof ClipDummy.create>) {
    return insertReplacementClips({
        affectedClipIds: [snapshot.id],
        currentClips: [],
        replacement: { clips: [snapshot], clipOrder: [snapshot.id] },
    })[0]!;
}

describe('insertReplacementClips', () => {
    it('preserves absent and explicitly undefined optional clip properties', () => {
        const absent = ClipDummy.create({ id: 'absent-optionals' });
        const absentClone = insertSnapshot(absent);

        expect(absentClone).toStrictEqual(absent);
        expect(Object.hasOwn(absentClone, 'overrides')).toBe(false);
        expect(Object.hasOwn(absentClone, 'kneadState')).toBe(false);

        const presentUndefined = {
            ...ClipDummy.create({ id: 'present-undefined-optionals' }),
            overrides: undefined,
            kneadState: undefined,
        };
        const presentUndefinedClone = insertSnapshot(presentUndefined);

        expect(presentUndefinedClone).toStrictEqual(presentUndefined);
        expect(Object.hasOwn(presentUndefinedClone, 'overrides')).toBe(true);
        expect(Object.hasOwn(presentUndefinedClone, 'kneadState')).toBe(true);
    });

    it('deep-clones populated overrides, knead state, blobs, and pitch curves', () => {
        const snapshot = ClipDummy.create({
            id: 'populated-optionals',
            overrides: { gain: true },
            kneadState: {
                blobs: [
                    {
                        id: 'blob-1',
                        startTime: 0,
                        endTime: 1,
                        pitchCenterCents: 1200,
                        originalPitchCenterCents: 1195,
                        pitchCurveCents: [-5, 0, 5],
                        voicedConfidence: 0.9,
                    },
                ],
                retuneSpeedMs: 0,
                humanizePercent: 0,
                formantPreserve: true,
            },
        });

        const clone = insertSnapshot(snapshot);

        expect(clone).toStrictEqual(snapshot);
        expect(clone.overrides).not.toBe(snapshot.overrides);
        expect(clone.kneadState).not.toBe(snapshot.kneadState);
        expect(clone.kneadState?.blobs[0]).not.toBe(snapshot.kneadState?.blobs[0]);
        expect(clone.kneadState?.blobs[0]?.pitchCurveCents).not.toBe(snapshot.kneadState?.blobs[0]?.pitchCurveCents);

        clone.overrides!.gain = false;
        clone.kneadState!.blobs[0]!.pitchCurveCents[0] = 999;

        expect(snapshot.overrides).toEqual({ gain: true });
        expect(snapshot.kneadState?.blobs[0]?.pitchCurveCents).toEqual([-5, 0, 5]);
    });
});
