import { describe, it, expect } from 'vitest';

import {
    beatToSamples,
    createTempoChange,
    getGoverningTempoChange,
    getTempoAtBeat,
    samplesToBeat,
    secondsBetweenBeats,
    splitRangeAtTempoChanges,
    type TempoChange,
} from '../TempoMap';

describe('getGoverningTempoChange', () => {
    const beatZeroMap: TempoChange[] = [
        { id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' },
        { id: 'tc-4', beat: 4, tempo: 140, curve: 'instant' },
    ];

    it('returns the change at beat 0 when the playhead is at the project start', () => {
        expect(getGoverningTempoChange(beatZeroMap, 0)?.change.id).toBe('tc-0');
    });

    it('returns the latest change at or before the beat', () => {
        expect(getGoverningTempoChange(beatZeroMap, 3.99)?.change.id).toBe('tc-0');
        expect(getGoverningTempoChange(beatZeroMap, 4)?.change.id).toBe('tc-4');
        expect(getGoverningTempoChange(beatZeroMap, 400)?.change.id).toBe('tc-4');
    });

    it('returns the first change when the beat precedes every change', () => {
        const lateMap: TempoChange[] = [{ id: 'tc-16', beat: 16, tempo: 100, curve: 'instant' }];

        expect(getGoverningTempoChange(lateMap, 0)?.change.id).toBe('tc-16');
    });

    it('sorts before resolving so an unsorted map still picks the right change', () => {
        const unsorted: TempoChange[] = [
            { id: 'tc-8', beat: 8, tempo: 150, curve: 'instant' },
            { id: 'tc-0', beat: 0, tempo: 90, curve: 'instant' },
        ];

        expect(getGoverningTempoChange(unsorted, 2)?.change.id).toBe('tc-0');
    });

    it('agrees with getTempoAtBeat about the tempo, not merely about the change', () => {
        const governing = getGoverningTempoChange(beatZeroMap, 2);

        expect(governing?.interpolated).toBe(false);
        expect(governing?.change.tempo).toBe(getTempoAtBeat(beatZeroMap, 2, 240));
    });

    it('reports an interpolated segment rather than pretending the ramp start governs', () => {
        // 90 at beat 0 ramping to 130 at beat 8: the tempo in force at beat 4 is
        // 110, which is neither event's own value. A caller that assigned a typed
        // BPM to `change.tempo` here would move the readout somewhere else again.
        const rampMap: TempoChange[] = [
            { id: 'tc-a', beat: 0, tempo: 90, curve: 'linear' },
            { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
        ];
        const governing = getGoverningTempoChange(rampMap, 4);

        expect(governing?.change.id).toBe('tc-a');
        expect(governing?.interpolated).toBe(true);
        expect(getTempoAtBeat(rampMap, 4, 240)).toBe(110);
        expect(governing?.change.tempo).not.toBe(getTempoAtBeat(rampMap, 4, 240));
    });

    it('does not report a ramp at the ramp event’s own beat, where the write is well defined', () => {
        // Drives between two positions on the same `linear` segment: beat 0, the
        // ramp event's own start point, and beat 4, strictly inside it. At beat 0
        // the interpolation factor is 0, so `getTempoAtBeat` returns the event's
        // own 90 — the readout *is* that event's value and writing to it is
        // exactly defined. Reporting `interpolated` there made a map whose first
        // change is at beat 0 with `curve: 'linear'` read-only at the default
        // playhead position, and a map of all-`linear` changes read-only
        // everywhere except after the last change.
        const rampFromZero: TempoChange[] = [
            { id: 'tc-a', beat: 0, tempo: 90, curve: 'linear' },
            { id: 'tc-b', beat: 8, tempo: 130, curve: 'instant' },
        ];

        const atRampStart = getGoverningTempoChange(rampFromZero, 0);
        expect(atRampStart?.change.id).toBe('tc-a');
        expect(atRampStart?.interpolated).toBe(false);
        expect(getTempoAtBeat(rampFromZero, 0, 240)).toBe(90);

        const insideRamp = getGoverningTempoChange(rampFromZero, 4);
        expect(insideRamp?.change.id).toBe('tc-a');
        expect(insideRamp?.interpolated).toBe(true);
        expect(getTempoAtBeat(rampFromZero, 4, 240)).toBe(110);
    });

    it('keeps the ramp’s own start point writable at a beat other than 0', () => {
        // The equality clause must key on the *event's* beat, not on a hardcoded
        // 0: driving between beat 8 (the second ramp event's own start) and beat
        // 12 (inside its segment) fails a `beat === 0` shortcut.
        const laterRamp: TempoChange[] = [
            { id: 'tc-a', beat: 0, tempo: 90, curve: 'instant' },
            { id: 'tc-b', beat: 8, tempo: 120, curve: 'linear' },
            { id: 'tc-c', beat: 16, tempo: 160, curve: 'instant' },
        ];

        expect(getGoverningTempoChange(laterRamp, 8)?.change.id).toBe('tc-b');
        expect(getGoverningTempoChange(laterRamp, 8)?.interpolated).toBe(false);
        expect(getTempoAtBeat(laterRamp, 8, 240)).toBe(120);

        expect(getGoverningTempoChange(laterRamp, 12)?.interpolated).toBe(true);
        expect(getTempoAtBeat(laterRamp, 12, 240)).toBe(140);
    });

    it('does not report a ramp on the last change, which has nothing to ramp toward', () => {
        const trailingRamp: TempoChange[] = [{ id: 'tc-a', beat: 0, tempo: 90, curve: 'linear' }];

        expect(getGoverningTempoChange(trailingRamp, 4)?.interpolated).toBe(false);
        expect(getGoverningTempoChange(trailingRamp, 4)?.change.tempo).toBe(getTempoAtBeat(trailingRamp, 4, 240));
    });

    it('resolves a non-finite beat to the same change getTempoAtBeat reports', () => {
        // `beat > NaN` is false for every change, so a scan looking for "the last
        // change at or before the beat" walks off the end and answers with the
        // *last* change while the reported tempo comes from the first.
        expect(getTempoAtBeat(beatZeroMap, Number.NaN, 240)).toBe(90);
        expect(getGoverningTempoChange(beatZeroMap, Number.NaN)?.change.id).toBe('tc-0');
        expect(getGoverningTempoChange(beatZeroMap, Number.POSITIVE_INFINITY)?.change.id).toBe('tc-4');
    });

    it('returns undefined for an empty map, where the default tempo still governs', () => {
        expect(getGoverningTempoChange([], 0)).toBeUndefined();
    });
});

describe('createTempoChange', () => {
    it('should clamp tempo into the supported range', () => {
        expect(createTempoChange(0, 10).tempo).toBe(20);
        expect(createTempoChange(0, 2000).tempo).toBe(999);
    });
});

describe('getTempoAtBeat', () => {
    it('should return the default when there are no changes', () => {
        expect(getTempoAtBeat([], 4, 120)).toBe(120);
    });

    it('should use the first change tempo when beat is before all changes', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 4, tempo: 140, curve: 'instant' },
            { id: 'b', beat: 8, tempo: 160, curve: 'instant' },
        ];
        expect(getTempoAtBeat(changes, 2, 120)).toBe(140);
    });

    it('should use the last change tempo when beat is after all changes', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 100, curve: 'instant' },
            { id: 'b', beat: 4, tempo: 200, curve: 'instant' },
        ];
        expect(getTempoAtBeat(changes, 99, 120)).toBe(200);
    });

    it('should interpolate when the active segment uses a linear curve', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
            { id: 'b', beat: 10, tempo: 200, curve: 'instant' },
        ];
        expect(getTempoAtBeat(changes, 5, 120)).toBe(150);
    });

    it('should hold the previous tempo for instant curves until the next point', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 100, curve: 'instant' },
            { id: 'b', beat: 10, tempo: 200, curve: 'instant' },
        ];
        expect(getTempoAtBeat(changes, 9, 120)).toBe(100);
    });
});

describe('integrated tempo-map coordinates', () => {
    const changes: TempoChange[] = [
        { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
        { id: 'b', beat: 4, tempo: 240, curve: 'instant' },
        { id: 'c', beat: 6, tempo: 60, curve: 'instant' },
    ];

    it('keeps one monotonic sample timeline across multiple tempo changes', () => {
        expect(beatToSamples(changes, 3, 120, 48000)).toBe(72000);
        expect(beatToSamples(changes, 4, 120, 48000)).toBe(96000);
        expect(beatToSamples(changes, 5, 120, 48000)).toBe(108000);
        expect(beatToSamples(changes, 6, 120, 48000)).toBe(120000);
        expect(beatToSamples(changes, 7, 120, 48000)).toBe(168000);
    });

    it('inverts exact tempo-boundary samples without changing boundary ownership', () => {
        expect(samplesToBeat(changes, 96000, 120, 48000)).toBe(4);
        expect(samplesToBeat(changes, 120000, 120, 48000)).toBe(6);
        expect(samplesToBeat(changes, 168000, 120, 48000)).toBe(7);
    });

    it('splits only at interior tempo changes and never creates zero-length boundary blocks', () => {
        expect(splitRangeAtTempoChanges(changes, 3, 7)).toEqual([
            { fromBeat: 3, toBeat: 4 },
            { fromBeat: 4, toBeat: 6 },
            { fromBeat: 6, toBeat: 7 },
        ]);
        expect(splitRangeAtTempoChanges(changes, 4, 6)).toEqual([{ fromBeat: 4, toBeat: 6 }]);
    });
});

describe('linear tempo-ramp coordinates', () => {
    const sampleRate = 48_000;
    const defaultTempo = 120;
    const ramp: TempoChange[] = [
        { id: 'ramp-start', beat: 0, tempo: 60, curve: 'linear' },
        { id: 'ramp-end', beat: 8, tempo: 180, curve: 'instant' },
    ];

    // Independent integral: BPM(b) = 60 + 15b, so elapsed seconds are
    // 4 * ln(1 + b / 4). These rounded samples are intentionally hard-coded.
    const rampCoordinates = [
        { beat: 0, samples: 0 },
        { beat: 2, samples: 77_849 },
        { beat: 5, samples: 155_699 },
        { beat: 8, samples: 210_934 },
    ] as const;

    it('matches independently integrated interior coordinates', () => {
        for (const coordinate of rampCoordinates) {
            expect(beatToSamples(ramp, coordinate.beat, defaultTempo, sampleRate)).toBe(coordinate.samples);
        }
    });

    it('inverts ramp start, interior, and end coordinates within one sample', () => {
        for (const coordinate of rampCoordinates) {
            const recoveredBeat = samplesToBeat(ramp, coordinate.samples, defaultTempo, sampleRate);
            const independentlyRecoveredSamples =
                recoveredBeat === 0 ? 0 : 4 * Math.log1p(recoveredBeat / 4) * sampleRate;

            expect(Math.abs(independentlyRecoveredSamples - coordinate.samples)).toBeLessThanOrEqual(1);
        }
    });

    it('stays continuous across adjacent ramp and instant boundaries', () => {
        const adjacentChanges: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 90, curve: 'linear' },
            { id: 'b', beat: 4, tempo: 180, curve: 'instant' },
            { id: 'c', beat: 6, tempo: 120, curve: 'linear' },
            { id: 'd', beat: 9, tempo: 240, curve: 'instant' },
            { id: 'e', beat: 12, tempo: 60, curve: 'instant' },
        ];
        const boundaryCoordinates = [
            { beat: 0, samples: 0 },
            { beat: 4, samples: 88_723 },
            { beat: 6, samples: 120_723 },
            { beat: 9, samples: 170_629 },
            { beat: 12, samples: 206_629 },
        ] as const;
        const epsilonBeat = 0.000_01;

        for (const boundary of boundaryCoordinates) {
            const exact = beatToSamples(adjacentChanges, boundary.beat, defaultTempo, sampleRate);
            const immediatelyLeft = beatToSamples(
                adjacentChanges,
                boundary.beat - epsilonBeat,
                defaultTempo,
                sampleRate
            );
            const immediatelyRight = beatToSamples(
                adjacentChanges,
                boundary.beat + epsilonBeat,
                defaultTempo,
                sampleRate
            );

            expect(exact).toBe(boundary.samples);
            expect(immediatelyLeft).toBeLessThanOrEqual(exact);
            expect(immediatelyRight).toBeGreaterThanOrEqual(exact);
            expect(exact - immediatelyLeft).toBeLessThanOrEqual(1);
            expect(immediatelyRight - exact).toBeLessThanOrEqual(1);
        }
    });

    it('keeps a numerically challenging valid ramp finite, monotonic, and sample-accurate', () => {
        const challengingRamp: TempoChange[] = [
            { id: 'near-flat-start', beat: 0, tempo: 120, curve: 'linear' },
            { id: 'near-flat-end', beat: 100_000, tempo: 120.000_000_000_1, curve: 'instant' },
        ];
        const expectedSamples = [0, 2_400_000_000, 4_800_000_000, 7_200_000_000, 9_600_000_000];
        const beats = [0, 25_000, 50_000, 75_000, 100_000];
        const coordinates = beats.map((beat) => beatToSamples(challengingRamp, beat, defaultTempo, 192_000));

        expect(coordinates).toEqual(expectedSamples);
        for (let index = 0; index < coordinates.length; index++) {
            expect(Number.isFinite(coordinates[index])).toBe(true);
            if (index > 0) {
                expect(coordinates[index]!).toBeGreaterThan(coordinates[index - 1]!);
            }
        }
    });
});

describe('secondsBetweenBeats', () => {
    it('falls back to the default tempo when the map is empty', () => {
        expect(secondsBetweenBeats([], 0, 8, 120)).toBeCloseTo(4, 12);
    });

    it('charges each segment its own tempo across an instant change', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'b', beat: 2, tempo: 240, curve: 'instant' },
        ];
        // 2 beats at 120 (1 s) + 2 beats at 240 (0.5 s). A flat reading at either
        // endpoint's tempo gives 2 s or 1 s — never 1.5 s.
        expect(secondsBetweenBeats(changes, 0, 4, 120)).toBeCloseTo(1.5, 12);
    });

    it('is antisymmetric, so a span behind the playhead reads negative', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'b', beat: 2, tempo: 240, curve: 'instant' },
        ];
        expect(secondsBetweenBeats(changes, 4, 0, 120)).toBeCloseTo(-1.5, 12);
        expect(secondsBetweenBeats(changes, 3, 3, 120)).toBe(0);
    });

    it('integrates a linear ramp rather than averaging its endpoints', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 60, curve: 'linear' },
            { id: 'b', beat: 4, tempo: 120, curve: 'instant' },
        ];
        // Tempo rises linearly 60 → 120 over 4 beats. The exact integral is
        // (4 * 60 / 60) * ln(2) / 1 = 4 ln 2 ≈ 2.7726 s. Averaging the endpoints
        // (90 BPM) would give 2.667 s.
        expect(secondsBetweenBeats(changes, 0, 4, 120)).toBeCloseTo(4 * Math.LN2, 9);
    });

    it('reads an unsorted change list in beat order, and repeats agree', () => {
        // The sorted view is cached by list identity, so a second call must give
        // the same answer as the first — a cache that outlived a real edit would
        // show up here as a disagreement.
        const changes: TempoChange[] = [
            { id: 'b', beat: 2, tempo: 240, curve: 'instant' },
            { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
        ];
        expect(secondsBetweenBeats(changes, 0, 4, 120)).toBeCloseTo(1.5, 12);
        expect(secondsBetweenBeats(changes, 0, 4, 120)).toBeCloseTo(1.5, 12);
        // A replaced list (the only way the store ever writes) is a different
        // object, so it is read afresh rather than served from the first one.
        const edited: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'b', beat: 2, tempo: 60, curve: 'instant' },
        ];
        expect(secondsBetweenBeats(edited, 0, 4, 120)).toBeCloseTo(3, 12);
    });

    it('agrees with beatToSamples, which the MIDI path converts through', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'b', beat: 2, tempo: 240, curve: 'instant' },
        ];
        const sampleRate = 48000;
        const viaSamples =
            (beatToSamples(changes, 4, 120, sampleRate) - beatToSamples(changes, 1, 120, sampleRate)) / sampleRate;
        expect(secondsBetweenBeats(changes, 1, 4, 120)).toBeCloseTo(viaSamples, 6);
    });
});
