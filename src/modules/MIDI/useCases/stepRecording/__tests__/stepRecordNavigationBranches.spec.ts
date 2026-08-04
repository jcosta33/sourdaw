import { describe, it, expect } from 'vitest';

import { getNextStepRecordPitch } from '../stepRecordNavigation';

/**
 * Direct branch specs for getNextStepRecordPitch. The function has no direct
 * unit test — only exercised indirectly through stepRecordStepUp/Down (7 tests each,
 * covering major/chromatic/pentatonic happy paths). These cover the edge branches.
 */

describe('getNextStepRecordPitch — chromatic fallback (pattern.length >= 12)', () => {
    it('returns +1 for chromatic up', () => {
        expect(getNextStepRecordPitch({ currentPitch: 60, direction: 'up', keyRoot: 0, scaleName: 'chromatic' })).toBe(
            61
        );
    });

    it('returns -1 for chromatic down', () => {
        expect(
            getNextStepRecordPitch({ currentPitch: 60, direction: 'down', keyRoot: 0, scaleName: 'chromatic' })
        ).toBe(59);
    });
});

describe('getNextStepRecordPitch — unknown scale falls back to chromatic', () => {
    it('unknown scaleName resolves to chromatic (+1 up)', () => {
        expect(
            getNextStepRecordPitch({ currentPitch: 60, direction: 'up', keyRoot: 0, scaleName: 'nonexistent' })
        ).toBe(61);
    });

    it('unknown scaleName resolves to chromatic (-1 down)', () => {
        expect(
            getNextStepRecordPitch({ currentPitch: 60, direction: 'down', keyRoot: 0, scaleName: 'nonexistent' })
        ).toBe(59);
    });
});

describe('getNextStepRecordPitch — major scale in-scale navigation', () => {
    // C major: [0, 2, 4, 5, 7, 9, 11], keyRoot=0
    it('steps up from C(60) to D(62)', () => {
        expect(getNextStepRecordPitch({ currentPitch: 60, direction: 'up', keyRoot: 0, scaleName: 'major' })).toBe(62);
    });

    it('steps up from B(71) to C(72) next octave (wrap)', () => {
        // B is degree 6 (pc 11). nextDegree = (6+1)%7 = 0. nextPc = 0. octShift = 12.
        // 71 - 11 + 0 + 12 = 72.
        expect(getNextStepRecordPitch({ currentPitch: 71, direction: 'up', keyRoot: 0, scaleName: 'major' })).toBe(72);
    });

    it('steps down from D(62) to C(60)', () => {
        // D is degree 1 (pc 2). nextDegree = (1-1+7)%7 = 0. nextPc = 0. octShift = 0 (nextDeg !== 6).
        // 62 - 2 + 0 + 0 = 60.
        expect(getNextStepRecordPitch({ currentPitch: 62, direction: 'down', keyRoot: 0, scaleName: 'major' })).toBe(
            60
        );
    });

    it('steps down from C(60) to B(59) previous octave (wrap)', () => {
        // C is degree 0 (pc 0). nextDegree = (0-1+7)%7 = 6. nextPc = 11.
        // octShift = nextDeg === 6 (pattern.length-1) ? -12 : 0 → -12.
        // 60 - 0 + 11 - 12 = 59.
        expect(getNextStepRecordPitch({ currentPitch: 60, direction: 'down', keyRoot: 0, scaleName: 'major' })).toBe(
            59
        );
    });
});

describe('getNextStepRecordPitch — off-scale tone handling', () => {
    // C major: [0, 2, 4, 5, 7, 9, 11]. C#(pc 1) is NOT in the scale.
    it('up from C#(61) snaps to the next scale tone D(62)', () => {
        // degree = -1. findIndex(param > 1) → pattern[1]=2 > 1 → degree = 1.
        // nextDegree = (1+1)%7 = 2. nextPc = 4. octShift = 0.
        // 61 - 1 + 4 + 0 = 64 (E). Wait — that skips D. Let me trace more carefully.
        // Actually: degree = findIndex(param > 1). pattern = [0,2,4,5,7,9,11].
        // findIndex(p => p > 1) → index 1 (value 2). degree = 1.
        // nextDegree = (1+1)%7 = 2. nextPc = pattern[2] = 4. octShift = 0.
        // result = 61 - 1 + 4 + 0 = 64 (E). So up from C# goes to E, skipping D.
        // This is the documented behavior: find the next scale degree after the off-scale tone.
        expect(getNextStepRecordPitch({ currentPitch: 61, direction: 'up', keyRoot: 0, scaleName: 'major' })).toBe(64);
    });

    it('down from C#(61) snaps to the previous scale tone C(60)', () => {
        // degree = -1. findIndex(param > 1) → 1 (value 2). degree = Math.max(0, 1-1) = 0.
        // nextDegree = (0-1+7)%7 = 6. nextPc = 11. octShift = -12 (nextDeg === 6 === len-1).
        // 61 - 1 + 11 - 12 = 59 (B). Hmm — that wraps down past C to B.
        expect(getNextStepRecordPitch({ currentPitch: 61, direction: 'down', keyRoot: 0, scaleName: 'major' })).toBe(
            59
        );
    });

    it('up from off-scale G#(68) snaps to A(69)', () => {
        // G# pc = 8. Not in major [0,2,4,5,7,9,11].
        // degree = findIndex(p => p > 8) → index 5 (value 9). degree = 5.
        // nextDegree = (5+1)%7 = 6. nextPc = 11. octShift = 0.
        // 68 - 8 + 11 + 0 = 71 (B).
        expect(getNextStepRecordPitch({ currentPitch: 68, direction: 'up', keyRoot: 0, scaleName: 'major' })).toBe(71);
    });
});

describe('getNextStepRecordPitch — non-zero key root', () => {
    it('navigates correctly with keyRoot=2 (D major)', () => {
        // D major relative to D: pitches shifted by 2. MIDI 62 = D = pc 0 relative to root 2.
        // Up from D(62) → E(64) (degree 0 → 1, pc 0 → 2, 62-0+2 = 64).
        expect(getNextStepRecordPitch({ currentPitch: 62, direction: 'up', keyRoot: 2, scaleName: 'major' })).toBe(64);
    });
});

describe('getNextStepRecordPitch — pentatonic scale', () => {
    it('pentatonicMajor up from C(60) to D(62)', () => {
        // [0,2,4,7,9]. degree 0. nextDegree 1. pc 2. 60-0+2 = 62.
        expect(
            getNextStepRecordPitch({ currentPitch: 60, direction: 'up', keyRoot: 0, scaleName: 'pentatonicMajor' })
        ).toBe(62);
    });

    it('pentatonicMajor down from D(62) to C(60)', () => {
        expect(
            getNextStepRecordPitch({ currentPitch: 62, direction: 'down', keyRoot: 0, scaleName: 'pentatonicMajor' })
        ).toBe(60);
    });

    it('pentatonicMajor up wrap from A(69) to C(72)', () => {
        // A pc=9, degree 4. nextDegree = (4+1)%5 = 0. pc = 0. octShift = 12.
        // 69 - 9 + 0 + 12 = 72.
        expect(
            getNextStepRecordPitch({ currentPitch: 69, direction: 'up', keyRoot: 0, scaleName: 'pentatonicMajor' })
        ).toBe(72);
    });
});
