import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

const RENDER_EVIDENCE_PATH = join(process.cwd(), 'docs/evidence/mycelium-ascendant/render-evidence.json');
const RENDER_SOURCE_ROOTS = [
    'public/wasm',
    'src/infra',
    'src/modules/Arrangement',
    'src/modules/AudioEngine',
    'src/modules/AudioRendering',
    'src/modules/Automation',
    'src/modules/Project',
    'src/modules/Transport',
    'src/modules/Yeast',
] as const;
const RUNTIME_EXTENSIONS = new Set(['.css', '.js', '.json', '.mjs', '.ts', '.tsx', '.wasm']);

type RenderEvidence = {
    bitsPerSample: number;
    capturedAt: string;
    channels: number;
    clippedSampleCount: number;
    consoleErrorCount: number;
    dcOffsets: number[];
    durationBeats: number;
    durationSeconds: number;
    failedRequestCount: number;
    integratedLufs: number;
    lowCorrelation: number;
    lowMonoCompatibilityDb: number;
    projectSha256: string;
    rendererSourceSha256: string;
    samplePeak: number;
    sampleRate: number;
    tailSeconds: number;
    truePeakDbTp: number;
    warningCount: number;
    wavSha256: string;
    wavHashScope: string;
};

function collectRuntimeFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '__tests__') {
            continue;
        }
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectRuntimeFiles(path));
            continue;
        }
        if (entry.name.includes('.spec.') || !RUNTIME_EXTENSIONS.has(extname(entry.name))) {
            continue;
        }
        files.push(path);
    }
    return files;
}

function hashRendererSource(): string {
    const hash = createHash('sha256');
    const files = RENDER_SOURCE_ROOTS.flatMap((root) => collectRuntimeFiles(join(process.cwd(), root))).toSorted();
    for (const file of files) {
        hash.update(relative(process.cwd(), file));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function readRenderEvidence(): RenderEvidence {
    return JSON.parse(readFileSync(RENDER_EVIDENCE_PATH, 'utf8')) as RenderEvidence;
}

describe('Mycelium Ascendant full browser render', () => {
    it('meets the render envelope', () => {
        const evidence = readRenderEvidence();
        const { projectData } = createMyceliumAscendantBlueprint();
        const maximumDcOffset = Math.max(...evidence.dcOffsets.map(Math.abs));
        const projectSha256 = createHash('sha256').update(JSON.stringify(projectData)).digest('hex');
        const rendererSourceSha256 = hashRendererSource();

        expect(projectData.meta.name).toBe('Mycelium Ascendant');
        expect(projectData.transport.loopEnd).toBe(evidence.durationBeats);
        expect(projectSha256).toBe(evidence.projectSha256);
        if (rendererSourceSha256 !== evidence.rendererSourceSha256) {
            throw new Error(`Renderer source SHA mismatch: ${rendererSourceSha256}`);
        }
        expect(evidence.wavSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(evidence.wavHashScope).toContain('stochastic DSP');
        expect(Date.parse(evidence.capturedAt)).not.toBeNaN();
        expect(evidence.tailSeconds).toBe(2);
        expect(evidence.durationSeconds).toBeGreaterThan(240);
        expect(evidence.durationSeconds).toBeLessThan(242);
        expect(evidence.sampleRate).toBe(44_100);
        expect(evidence.channels).toBe(2);
        expect(evidence.bitsPerSample).toBe(24);
        expect(evidence.integratedLufs).toBeGreaterThanOrEqual(-11);
        expect(evidence.integratedLufs).toBeLessThanOrEqual(-8);
        expect(evidence.truePeakDbTp).toBeLessThanOrEqual(-0.8);
        expect(evidence.samplePeak).toBeLessThan(1);
        expect(evidence.clippedSampleCount).toBe(0);
        expect(maximumDcOffset).toBeLessThan(0.005);
        expect(evidence.lowMonoCompatibilityDb).toBeGreaterThan(-3);
        expect(evidence.lowCorrelation).toBeGreaterThan(0);
        expect(evidence.warningCount).toBe(0);
        expect(evidence.consoleErrorCount).toBe(0);
        expect(evidence.failedRequestCount).toBe(0);
    });
});
