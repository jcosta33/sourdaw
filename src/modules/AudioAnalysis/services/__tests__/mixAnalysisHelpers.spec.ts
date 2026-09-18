import { describe, it, expect } from 'vitest';

import {
    type DetectIssuesInput,
    type FrequencyBands,
    type GenerateSuggestionsInput,
    detectIssues,
    generateSuggestions,
    readFrequencyBalance,
} from '../../services/mixAnalysisHelpers';

const measured = {
    status: { availability: 'measured', provenance: 'live-analyser-snapshot' },
} as const;

const insufficientNoSignal = {
    status: {
        availability: 'insufficient',
        reason: 'no-signal',
        provenance: 'live-analyser-snapshot',
    },
} as const;

const insufficientSuspended = {
    status: {
        availability: 'insufficient',
        reason: 'audio-context-suspended',
        provenance: 'live-analyser-snapshot',
    },
} as const;

const allBands = (db: number): FrequencyBands => ({
    sub: db,
    bass: db,
    lowMid: db,
    mid: db,
    highMid: db,
    high: db,
});

function frequencyAnalyser(input: {
    sampleRate: number;
    binCount: number;
    /** dB value per bin index; unlisted bins sit at -100 dB. */
    bins?: Record<number, number>;
}): AnalyserNode {
    return {
        frequencyBinCount: input.binCount,
        context: { sampleRate: input.sampleRate },
        getFloatFrequencyData: (data: Float32Array) => {
            data.fill(-100);
            for (const [index, value] of Object.entries(input.bins ?? {})) {
                data[Number(index)] = value;
            }
        },
    } as unknown as AnalyserNode;
}

describe('mixAnalysisTransformers', () => {
    describe('readFrequencyBalance band ownership', () => {
        // The production master analyser runs fftSize 256 → 128 bins → 187.5 Hz
        // per bin at 48 kHz. A tone at 187.5 Hz used to masquerade as sub, bass
        // AND low-mid energy because each band floored/ceilinged the shared bin
        // independently.
        it('attributes a bin to exactly one band and reports the sub band as unresolvable at meter resolution', () => {
            const bands = readFrequencyBalance(
                frequencyAnalyser({ sampleRate: 48_000, binCount: 128, bins: { 1: -10 } })
            );

            // No bin center falls inside 20–60 Hz at 187.5 Hz spacing.
            expect(bands.sub).toBeNull();
            // The single 187.5 Hz bin is owned by bass alone.
            expect(bands.bass).toBeCloseTo(-10, 5);
            expect(bands.lowMid).toBeCloseTo(-100, 5);
            expect(bands.mid).toBeCloseTo(-100, 5);
        });

        it('keeps sub-band energy out of bass at fine resolution (no shared-bin reuse)', () => {
            // 1024 bins at 48 kHz → 23.4 Hz spacing: bins 1–2 (23.4/46.9 Hz)
            // carry sub energy, bin 30 (703 Hz) carries mid energy.
            const bands = readFrequencyBalance(
                frequencyAnalyser({ sampleRate: 48_000, binCount: 1024, bins: { 1: -20, 2: -20, 30: -10 } })
            );

            expect(bands.sub).toBeGreaterThan(-30);
            // Bass owns bins 3–10 (70–234 Hz), all silent — the sub bins must
            // not leak into it.
            expect(bands.bass).toBeCloseTo(-100, 5);
            // Mid averages one -10 dB bin over its 64 attributable bins.
            expect(bands.mid).toBeCloseTo(-28.0618, 3);
        });

        it('resolves ownership at 44.1 kHz and 96 kHz sample rates', () => {
            // 96 kHz, 128 bins → 375 Hz spacing: bin 1 (375 Hz) is low-mid, and
            // sub AND bass are both unresolvable.
            const at96k = readFrequencyBalance(
                frequencyAnalyser({ sampleRate: 96_000, binCount: 128, bins: { 1: -10 } })
            );
            expect(at96k.sub).toBeNull();
            expect(at96k.bass).toBeNull();
            expect(at96k.lowMid).toBeCloseTo(-10, 5);

            // 44.1 kHz, 1024 bins → 21.5 Hz spacing: bins 1–2 (21.5/43.1 Hz)
            // are both sub, averaging -12 dB and floor silence.
            const at44k1 = readFrequencyBalance(
                frequencyAnalyser({ sampleRate: 44_100, binCount: 1024, bins: { 2: -12 } })
            );
            expect(at44k1.sub).toBeCloseTo(-15.0103, 3);
        });

        it('maps non-finite silent bins to the finite floor so measurements serialize without Infinity or null-from-NaN', () => {
            const bands = readFrequencyBalance({
                frequencyBinCount: 128,
                context: { sampleRate: 48_000 },
                getFloatFrequencyData: (data: Float32Array) => {
                    data.fill(Number.NEGATIVE_INFINITY);
                },
            } as unknown as AnalyserNode);

            for (const value of Object.values(bands)) {
                // Sub/bass have no attributable bins → explicitly unavailable;
                // every measured band is a finite number, never -Infinity.
                expect(value === null || Number.isFinite(value)).toBe(true);
            }
            expect(bands.lowMid).toBeCloseTo(-100, 5);
        });
    });

    describe('detectIssues', () => {
        it('detects clipping tracks as critical issues', () => {
            const input: DetectIssuesInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -20 },
                bands: allBands(-40),
                trackLevels: [
                    {
                        trackId: 't1',
                        trackName: 'Drums',
                        peakDb: 1.5,
                        rmsDb: -10,
                        isClipping: true,
                        isMuted: false,
                        isSoloed: false,
                    },
                ],
            };

            const issues = detectIssues(input);
            expect(issues).toHaveLength(1);
            expect(issues[0]).toEqual({
                severity: 'critical',
                category: 'level',
                message: 'Drums is clipping at 1.5 dB',
                trackId: 't1',
            });
        });

        it('warns about hot master levels', () => {
            const input: DetectIssuesInput = {
                ...measured,
                masterLevels: { peakDb: -1, rmsDb: -15 },
                bands: allBands(-40),
                trackLevels: [],
            };

            const issues = detectIssues(input);
            expect(issues).toHaveLength(1);
            expect(issues[0]).toEqual({
                severity: 'warning',
                category: 'level',
                message: 'Master peak is -1.0 dB — low headroom',
            });
        });

        it('warns about muddy mixes (lows >> highs)', () => {
            const input: DetectIssuesInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: { sub: -10, bass: -10, lowMid: -40, mid: -40, highMid: -40, high: -40 }, // low = -10, high = -40
                trackLevels: [],
            };

            const issues = detectIssues(input);
            expect(issues).toHaveLength(1);
            expect(issues[0]!.message).toContain('muddy');
        });

        it('withholds the muddy comparison when a compared band was unresolvable', () => {
            // bass at -10 vs mid at -40 would read "muddy" if the unmeasured
            // sub band were treated as measured silence.
            const input: DetectIssuesInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: { sub: null, bass: -10, lowMid: -40, mid: -40, highMid: -40, high: -40 },
                trackLevels: [],
            };

            expect(detectIssues(input)).toHaveLength(0);
        });

        it('warns about harsh mixes (highMids >> mids)', () => {
            const input: DetectIssuesInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: { sub: -40, bass: -40, lowMid: -40, mid: -40, highMid: -10, high: -40 }, // mid = -40, highMid = -10
                trackLevels: [],
            };

            const issues = detectIssues(input);
            expect(issues).toHaveLength(1);
            expect(issues[0]!.message).toContain('harsh');
        });

        it('detects large volume discrepancies between active tracks', () => {
            const input: DetectIssuesInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: allBands(-40),
                trackLevels: [
                    {
                        trackId: 't1',
                        trackName: 'Loud',
                        peakDb: -5,
                        rmsDb: -10,
                        isClipping: false,
                        isMuted: false,
                        isSoloed: false,
                    },
                    {
                        trackId: 't2',
                        trackName: 'Quiet',
                        peakDb: -30,
                        rmsDb: -40,
                        isClipping: false,
                        isMuted: false,
                        isSoloed: false,
                    },
                ],
            };

            const issues = detectIssues(input);
            expect(issues).toHaveLength(1);
            expect(issues[0]!.message).toContain('differ by 25.0 dB');
            expect(issues[0]!.message).toContain('Loud vs Quiet');
        });

        it('identifies insufficient evidence explicitly instead of reporting mix issues', () => {
            for (const status of [insufficientNoSignal, insufficientSuspended]) {
                const issues = detectIssues({
                    ...status,
                    masterLevels: { peakDb: -100, rmsDb: -100 },
                    bands: allBands(-100),
                    trackLevels: [],
                });
                expect(issues).toHaveLength(1);
                expect(issues[0]!.severity).toBe('info');
                expect(issues[0]!.message).toMatch(/no mix evidence|No signal measured/u);
            }
        });
    });

    describe('generateSuggestions', () => {
        it('suggests gain reduction for clipping tracks', () => {
            const input: GenerateSuggestionsInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -20 },
                bands: allBands(-40),
                trackLevels: [
                    {
                        trackId: 't1',
                        trackName: 'Drums',
                        peakDb: 1.5,
                        rmsDb: -10,
                        isClipping: true,
                        isMuted: false,
                        isSoloed: false,
                    },
                ],
                issues: [],
            };

            const suggestions = generateSuggestions(input);
            // 1.5 + 0.5 = 2.0
            expect(suggestions[0]).toBe('Drums is clipping — reduce gain by at least 2.0 dB');
        });

        it('suggests master gain reduction when hot', () => {
            const input: GenerateSuggestionsInput = {
                ...measured,
                masterLevels: { peakDb: -1, rmsDb: -15 },
                bands: allBands(-40),
                trackLevels: [],
                issues: [],
            };

            const suggestions = generateSuggestions(input);
            // -1 + 6 = 5.0
            expect(suggestions[0]).toBe('Master is hot at -1.0 dB — reduce by 5.0 dB to leave headroom for mastering');
        });

        it('suggests high-pass filter when muddy', () => {
            const input: GenerateSuggestionsInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: { sub: -10, bass: -10, lowMid: -40, mid: -40, highMid: -40, high: -40 },
                trackLevels: [],
                issues: [],
            };

            const suggestions = generateSuggestions(input);
            expect(suggestions[0]).toContain('high-pass filter');
        });

        it('suggests gentle cuts when harsh', () => {
            const input: GenerateSuggestionsInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: { sub: -40, bass: -40, lowMid: -40, mid: -40, highMid: -10, high: -40 },
                trackLevels: [],
                issues: [],
            };

            const suggestions = generateSuggestions(input);
            expect(suggestions[0]).toContain('tame harshness');
        });

        it('compliments the mix when no issues found', () => {
            const input: GenerateSuggestionsInput = {
                ...measured,
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: allBands(-40),
                trackLevels: [],
                issues: [], // Empty issues array
            };

            const suggestions = generateSuggestions(input);
            expect(suggestions[0]).toBe('Mix has good frequency balance and healthy levels');
        });

        it('never calls a silent or suspended mix healthy — the issue #3842 reproduction', () => {
            // The issue's deterministic fixture: zero time data (levels at the
            // -100 floor) and all -Infinity frequency bins.
            for (const status of [insufficientNoSignal, insufficientSuspended]) {
                const issues = detectIssues({
                    ...status,
                    masterLevels: { peakDb: -100, rmsDb: -100 },
                    bands: { sub: -100, bass: -100, lowMid: -100, mid: -100, highMid: -100, high: -100 },
                    trackLevels: [],
                });
                const suggestions = generateSuggestions({
                    ...status,
                    masterLevels: { peakDb: -100, rmsDb: -100 },
                    bands: { sub: -100, bass: -100, lowMid: -100, mid: -100, highMid: -100, high: -100 },
                    trackLevels: [],
                    issues,
                });

                expect(suggestions).not.toContain('Mix has good frequency balance and healthy levels');
                expect(suggestions[0]).toMatch(/Start (the audio engine|playback)/u);
            }
        });
    });
});
