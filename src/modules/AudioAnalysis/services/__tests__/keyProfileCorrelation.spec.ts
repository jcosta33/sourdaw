import { describe, it, expect } from 'vitest';

import { correlateKeyProfiles } from '../keyProfileCorrelation';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function mulberry32(seed: number): () => number {
    let state = seed;
    return function next() {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** One unit of energy in each named pitch class, silence elsewhere. */
function pitchClassSet(pitchClasses: number[]): number[] {
    const chroma = Array.from({ length: 12 }, () => 0);
    for (const pitchClass of pitchClasses) {
        chroma[pitchClass] = 1;
    }
    return chroma;
}

describe('correlateKeyProfiles', () => {
    it('does not favour minor over the 24 keys on unstructured input', () => {
        // The shipped detector used an un-centred dot product, which is
        // dominated by the profile sums (minor 44.51 vs major 41.79) and
        // therefore answered "minor" for 98.3% of random chroma vectors. A
        // mean-centred Pearson correlation has no such thumb on the scale.
        // The bound is deliberately wide: the K-S profiles are not mirror
        // images, so a small residual lean is expected and correct — what is
        // not acceptable is a near-total one.
        const random = mulberry32(0x5eed);
        const total = 20000;
        let minorWins = 0;
        for (let trial = 0; trial < total; trial++) {
            const raw = Array.from({ length: 12 }, () => random());
            const peak = Math.max(...raw);
            const result = correlateKeyProfiles(raw.map((value) => value / peak));
            if (result?.best.mode === 'minor') {
                minorWins++;
            }
        }

        const minorShare = minorWins / total;
        expect(minorShare).toBeGreaterThan(0.35);
        expect(minorShare).toBeLessThan(0.7);
    });

    it('is invariant to a constant added to every pitch class', () => {
        // Adding a constant changes a dot product but not a Pearson
        // correlation, which is defined on deviations from the mean. This is
        // the single arithmetic property the shipped implementation lacked.
        const chroma = pitchClassSet([0, 4, 7]);
        const lifted = chroma.map((value) => value + 5);

        const base = correlateKeyProfiles(chroma);
        const shifted = correlateKeyProfiles(lifted);

        expect(base?.best.tonic).toBe(shifted?.best.tonic);
        expect(base?.best.mode).toBe(shifted?.best.mode);
        expect(shifted?.best.correlation).toBeCloseTo(base?.best.correlation ?? Number.NaN, 10);
    });

    it('reads a C major triad as C major and an A minor triad as A minor', () => {
        const cMajor = correlateKeyProfiles(pitchClassSet([0, 4, 7]));
        const aMinor = correlateKeyProfiles(pitchClassSet([9, 0, 4]));

        expect(cMajor?.best.mode).toBe('major');
        expect(NOTE_NAMES[cMajor?.best.tonic ?? -1]).toBe('C');
        expect(aMinor?.best.mode).toBe('minor');
        expect(NOTE_NAMES[aMinor?.best.tonic ?? -1]).toBe('A');
    });

    it('separates the two diatonic collections that share a pitch-class set', () => {
        // C major and A minor are the same seven pitch classes. Weighting the
        // tonic triad is what tells them apart, and it is an interior point:
        // the two answers differ by a rotation of 9 and a change of mode, so a
        // detector that leans one way fails one of the pair.
        const cMajorWeighted = pitchClassSet([0, 2, 4, 5, 7, 9, 11]);
        cMajorWeighted[0] = 3;
        cMajorWeighted[4] = 2;
        cMajorWeighted[7] = 2;

        const aMinorWeighted = pitchClassSet([9, 11, 0, 2, 4, 5, 7]);
        aMinorWeighted[9] = 3;
        aMinorWeighted[0] = 2;
        aMinorWeighted[4] = 2;

        const cMajor = correlateKeyProfiles(cMajorWeighted);
        const aMinor = correlateKeyProfiles(aMinorWeighted);

        expect(`${NOTE_NAMES[cMajor?.best.tonic ?? -1]} ${cMajor?.best.mode}`).toBe('C major');
        expect(`${NOTE_NAMES[aMinor?.best.tonic ?? -1]} ${aMinor?.best.mode}`).toBe('A minor');
    });

    it('returns no correlation for a chroma with zero variance', () => {
        expect(correlateKeyProfiles(Array.from({ length: 12 }, () => 0.4))).toBeNull();
    });

    it('rejects a chroma vector that is not twelve bins long', () => {
        expect(correlateKeyProfiles([1, 0, 0])).toBeNull();
    });

    it('reports a runner-up that is a different key and never scores above the winner', () => {
        const result = correlateKeyProfiles(pitchClassSet([0, 4, 7]));
        if (!result) {
            throw new Error('expected a correlation for a C major triad');
        }

        expect(`${NOTE_NAMES[result.best.tonic]} ${result.best.mode}`).not.toBe(
            `${NOTE_NAMES[result.runnerUp.tonic]} ${result.runnerUp.mode}`
        );
        expect(result.runnerUp.correlation).toBeLessThanOrEqual(result.best.correlation);
    });

    it('keeps the correlation inside the bounds of a Pearson coefficient', () => {
        const random = mulberry32(0xabcdef);
        let maximum = -Infinity;
        let minimum = Infinity;
        for (let trial = 0; trial < 2000; trial++) {
            const result = correlateKeyProfiles(Array.from({ length: 12 }, () => random()));
            if (!result) {
                continue;
            }
            maximum = Math.max(maximum, result.best.correlation);
            minimum = Math.min(minimum, result.runnerUp.correlation);
        }

        expect(maximum).toBeLessThanOrEqual(1);
        expect(minimum).toBeGreaterThanOrEqual(-1);
        // A saturating metric would pin at the ceiling; a real correlation
        // over random input does not reach it.
        expect(maximum).toBeLessThan(0.999);
    });
});
