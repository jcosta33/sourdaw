import { describe, it, expect } from 'vitest';
import { detectIssues, generateSuggestions, type DetectIssuesInput, type GenerateSuggestionsInput } from '../mixAnalysisTransformers';
import { type MixAnalysis } from '../../models/MixAnalysis';
import { type FrequencyBands } from '../../repositories/mixAnalysis/readFrequencyBalance';

describe('mixAnalysisTransformers', () => {
    describe('detectIssues', () => {
        it('detects clipping tracks as critical issues', () => {
            const input: DetectIssuesInput = {
                masterLevels: { peakDb: -5, rmsDb: -20 },
                bands: { sub: -40, bass: -40, lowMid: -40, mid: -40, highMid: -40, high: -40 },
                trackLevels: [
                    { trackId: 't1', trackName: 'Drums', peakDb: 1.5, rmsDb: -10, isClipping: true, isMuted: false },
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
                masterLevels: { peakDb: -1, rmsDb: -15 },
                bands: { sub: -40, bass: -40, lowMid: -40, mid: -40, highMid: -40, high: -40 },
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
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: { sub: -10, bass: -10, lowMid: -40, mid: -40, highMid: -40, high: -40 }, // low = -10, high = -40
                trackLevels: [],
            };

            const issues = detectIssues(input);
            expect(issues).toHaveLength(1);
            expect(issues[0]!.message).toContain('muddy');
        });

        it('warns about harsh mixes (highMids >> mids)', () => {
            const input: DetectIssuesInput = {
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
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: { sub: -40, bass: -40, lowMid: -40, mid: -40, highMid: -40, high: -40 },
                trackLevels: [
                    { trackId: 't1', trackName: 'Loud', peakDb: -5, rmsDb: -10, isClipping: false, isMuted: false },
                    { trackId: 't2', trackName: 'Quiet', peakDb: -30, rmsDb: -40, isClipping: false, isMuted: false },
                ],
            };

            const issues = detectIssues(input);
            expect(issues).toHaveLength(1);
            expect(issues[0]!.message).toContain('differ by 25.0 dB');
            expect(issues[0]!.message).toContain('Loud vs Quiet');
        });
    });

    describe('generateSuggestions', () => {
        it('suggests gain reduction for clipping tracks', () => {
            const input: GenerateSuggestionsInput = {
                masterLevels: { peakDb: -5, rmsDb: -20 },
                bands: { sub: -40, bass: -40, lowMid: -40, mid: -40, highMid: -40, high: -40 },
                trackLevels: [
                    { trackId: 't1', trackName: 'Drums', peakDb: 1.5, rmsDb: -10, isClipping: true, isMuted: false },
                ],
                issues: [],
            };

            const suggestions = generateSuggestions(input);
            // 1.5 + 0.5 = 2.0
            expect(suggestions[0]).toBe('Drums is clipping — reduce gain by at least 2.0 dB');
        });

        it('suggests master gain reduction when hot', () => {
            const input: GenerateSuggestionsInput = {
                masterLevels: { peakDb: -1, rmsDb: -15 },
                bands: { sub: -40, bass: -40, lowMid: -40, mid: -40, highMid: -40, high: -40 },
                trackLevels: [],
                issues: [],
            };

            const suggestions = generateSuggestions(input);
            // -1 + 6 = 5.0
            expect(suggestions[0]).toBe('Master is hot at -1.0 dB — reduce by 5.0 dB to leave headroom for mastering');
        });

        it('suggests high-pass filter when muddy', () => {
            const input: GenerateSuggestionsInput = {
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
                masterLevels: { peakDb: -5, rmsDb: -15 },
                bands: { sub: -40, bass: -40, lowMid: -40, mid: -40, highMid: -40, high: -40 },
                trackLevels: [],
                issues: [], // Empty issues array
            };

            const suggestions = generateSuggestions(input);
            expect(suggestions[0]).toBe('Mix has good frequency balance and healthy levels');
        });
    });
});
