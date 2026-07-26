import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

const RENDER_EVIDENCE = {
    capturedAt: '2026-07-26T12:41:51.828Z',
    sourceBaseCommit: '192901c20e96e517f66bdedef979fc90bd39e14e',
    projectSha256: '1cea829dfa15f1e3ac94e611606cc3ef2ac3c4a2bccdfe1cc5707412565ffd9c',
    durationBeats: 576,
    tailSeconds: 2,
    durationSeconds: 240.9941723356009,
    sampleRate: 44_100,
    channels: 2,
    integratedLufs: -9.94650357800738,
    truePeakDbTp: -2.2119193820612066,
    samplePeak: 0.7736612558364868,
    clippedSampleCount: 0,
    dcOffsets: [0.0017770500556386186, 0.0017781638059884493],
    lowMonoCompatibilityDb: -0.0046787452509035096,
    lowCorrelation: 0.9978605973465653,
    warningCount: 0,
    consoleErrorCount: 0,
    failedRequestCount: 0,
} as const;

describe('Mycelium Ascendant full browser render', () => {
    it('meets the render envelope', () => {
        const { projectData } = createMyceliumAscendantBlueprint();
        const maximumDcOffset = Math.max(...RENDER_EVIDENCE.dcOffsets.map(Math.abs));
        const projectSha256 = createHash('sha256').update(JSON.stringify(projectData)).digest('hex');

        expect(projectData.meta.name).toBe('Mycelium Ascendant');
        expect(projectData.transport.loopEnd).toBe(RENDER_EVIDENCE.durationBeats);
        if (projectSha256 !== RENDER_EVIDENCE.projectSha256) {
            throw new Error(`Project SHA mismatch: ${projectSha256}`);
        }
        expect(RENDER_EVIDENCE.durationSeconds).toBeGreaterThan(240);
        expect(RENDER_EVIDENCE.durationSeconds).toBeLessThan(242);
        expect(RENDER_EVIDENCE.sampleRate).toBe(44_100);
        expect(RENDER_EVIDENCE.channels).toBe(2);
        expect(RENDER_EVIDENCE.integratedLufs).toBeGreaterThanOrEqual(-11);
        expect(RENDER_EVIDENCE.integratedLufs).toBeLessThanOrEqual(-8);
        expect(RENDER_EVIDENCE.truePeakDbTp).toBeLessThanOrEqual(-0.8);
        expect(RENDER_EVIDENCE.samplePeak).toBeLessThan(1);
        expect(RENDER_EVIDENCE.clippedSampleCount).toBe(0);
        expect(maximumDcOffset).toBeLessThan(0.005);
        expect(RENDER_EVIDENCE.lowMonoCompatibilityDb).toBeGreaterThan(-3);
        expect(RENDER_EVIDENCE.lowCorrelation).toBeGreaterThan(0);
        expect(RENDER_EVIDENCE.warningCount).toBe(0);
        expect(RENDER_EVIDENCE.consoleErrorCount).toBe(0);
        expect(RENDER_EVIDENCE.failedRequestCount).toBe(0);
    });
});
