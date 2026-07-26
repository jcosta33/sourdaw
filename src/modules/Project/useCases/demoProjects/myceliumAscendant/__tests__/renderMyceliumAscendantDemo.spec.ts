import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

import type { ProjectData } from '../../../../models/ProjectData';

const RENDER_EVIDENCE_PATH = join(process.cwd(), 'docs/evidence/mycelium-ascendant/render-evidence.json');
const AUTOMATION_STEM_EVIDENCE_PATH = join(
    process.cwd(),
    'docs/evidence/mycelium-ascendant/automation-stem-evidence.json'
);
const MOTIF_EVENT_REPORT_PATH = join(process.cwd(), 'docs/evidence/mycelium-ascendant/motif-event-report.json');
const DESKTOP_RUNTIME_EVIDENCE_PATH = join(
    process.cwd(),
    'docs/evidence/mycelium-ascendant/desktop-runtime-evidence.json'
);
const RENDER_SOURCE_ROOTS = ['public/audio/worklets', 'public/wasm', 'src'] as const;
const RUNTIME_EXTENSIONS = new Set(['.css', '.js', '.json', '.mjs', '.ts', '.tsx', '.wasm']);
const MOTIF_SECTIONS = [
    ['Drop I — Hyphal Drive', 192, 288],
    ['Psilocybin Chapel', 288, 352],
    ['Drop II — Fractal Bloom', 416, 544],
    ['Dissolution', 544, 576],
] as const;
const MOTIF_TRACK_NAMES = [
    'Main Vision',
    'Counter Vision',
    'Psy Pluck',
    'Levain Call',
    'Levain Answer',
    'Grand Boule Ritual',
] as const;

type RenderEvidence = {
    activeBlockRatio: number;
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
    rendererSourceRoots: string[];
    rendererSourceSha256: string;
    samplePeak: number;
    sampleRate: number;
    tailSeconds: number;
    truePeakDbTp: number;
    warningCount: number;
    wavSha256: string;
    wavHashScope: string;
};

type AutomationStemEvidence = {
    capturedAt: string;
    fullMixCapturedAt: string;
    fullMixTransition: {
        renderBeats: number[];
        channels: number;
        warnings: string[];
        falseFloor: { beats: number[]; durationSeconds: number; rms: number; samplePeak: number };
        returnStrike: { beats: number[]; durationSeconds: number; rms: number; samplePeak: number };
    };
    projectSha256: string;
    rendererSourceRoots: string[];
    rendererSourceSha256: string;
};

type MotifComparison = {
    section: string;
    trackName: string;
    eventCount: number;
    intervalSignature: number[];
    events: Array<{ beat: number; pitch: number; duration: number; velocity: number }>;
};

type MotifEventReport = {
    capturedAt: string;
    projectSha256: string;
    comparisons: MotifComparison[];
};

type DesktopRuntimeEvidence = {
    acceptanceStatus: 'partial';
    capturedAt: string;
    projectSha256: string;
    nativeCommandAllowlist: string[];
    nativeDesktopLaunchVerified: false;
    consoleErrorCount: number;
    externalRequestCount: number;
    failedRequestCount: number;
    httpErrorCount: number;
    pageErrorCount: number;
    unexpectedNativeCommandCount: number;
    unexpectedWarningCount: number;
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

function readAutomationStemEvidence(): AutomationStemEvidence {
    return JSON.parse(readFileSync(AUTOMATION_STEM_EVIDENCE_PATH, 'utf8')) as AutomationStemEvidence;
}

function readMotifEventReport(): MotifEventReport {
    return JSON.parse(readFileSync(MOTIF_EVENT_REPORT_PATH, 'utf8')) as MotifEventReport;
}

function readDesktopRuntimeEvidence(): DesktopRuntimeEvidence {
    return JSON.parse(readFileSync(DESKTOP_RUNTIME_EVIDENCE_PATH, 'utf8')) as DesktopRuntimeEvidence;
}

function buildMotifComparisons(projectData: ProjectData): MotifComparison[] {
    return MOTIF_SECTIONS.flatMap(([section, startBeat, endBeat]) =>
        MOTIF_TRACK_NAMES.flatMap((trackName) => {
            const track = projectData.arrangement.tracks.find((candidate) => candidate.name === trackName);
            const notes = (track?.clips ?? [])
                .flatMap((clip) =>
                    (projectData.midi.notesByClipId[clip.id] ?? []).map((note) => ({
                        ...note,
                        absoluteBeat: clip.startBeat + note.startBeat,
                    }))
                )
                .filter((note) => note.absoluteBeat >= startBeat && note.absoluteBeat < endBeat)
                .toSorted((first, second) => first.absoluteBeat - second.absoluteBeat || first.pitch - second.pitch);
            if (notes.length === 0) {
                return [];
            }
            const events = notes.slice(0, 4).map((note) => ({
                beat: note.absoluteBeat - startBeat,
                pitch: note.pitch,
                duration: note.duration,
                velocity: note.velocity,
            }));
            return [
                {
                    section,
                    trackName,
                    eventCount: notes.length,
                    intervalSignature: events.slice(1).map((event, index) => event.pitch - events[index]!.pitch),
                    events,
                },
            ];
        })
    );
}

describe('Mycelium Ascendant full browser render', () => {
    it('meets the render envelope', () => {
        const evidence = readRenderEvidence();
        const automationStemEvidence = readAutomationStemEvidence();
        const motifEventReport = readMotifEventReport();
        const desktopRuntimeEvidence = readDesktopRuntimeEvidence();
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
        expect(evidence.rendererSourceRoots).toEqual(RENDER_SOURCE_ROOTS);
        expect(automationStemEvidence.projectSha256).toBe(projectSha256);
        if (rendererSourceSha256 !== automationStemEvidence.rendererSourceSha256) {
            throw new Error(`Automation stem renderer source SHA mismatch: ${rendererSourceSha256}`);
        }
        expect(automationStemEvidence.rendererSourceRoots).toEqual(RENDER_SOURCE_ROOTS);
        expect(Date.parse(automationStemEvidence.capturedAt)).not.toBeNaN();
        expect(Date.parse(automationStemEvidence.fullMixCapturedAt)).not.toBeNaN();
        expect(automationStemEvidence.fullMixTransition.renderBeats).toEqual([416, 488]);
        expect(automationStemEvidence.fullMixTransition.channels).toBe(2);
        expect(automationStemEvidence.fullMixTransition.warnings).toEqual([]);
        expect(automationStemEvidence.fullMixTransition.falseFloor.beats).toEqual([480, 484]);
        expect(automationStemEvidence.fullMixTransition.falseFloor.rms).toBeGreaterThan(0);
        expect(automationStemEvidence.fullMixTransition.falseFloor.rms).toBeLessThan(
            automationStemEvidence.fullMixTransition.returnStrike.rms * 0.25
        );
        expect(automationStemEvidence.fullMixTransition.returnStrike.beats).toEqual([484, 488]);
        expect(automationStemEvidence.fullMixTransition.returnStrike.samplePeak).toBeGreaterThan(0.1);
        expect(motifEventReport.projectSha256).toBe(projectSha256);
        expect(Date.parse(motifEventReport.capturedAt)).not.toBeNaN();
        expect(motifEventReport.comparisons).toEqual(buildMotifComparisons(projectData));
        expect(desktopRuntimeEvidence.projectSha256).toBe(projectSha256);
        expect(desktopRuntimeEvidence.acceptanceStatus).toBe('partial');
        expect(desktopRuntimeEvidence.nativeDesktopLaunchVerified).toBe(false);
        expect(desktopRuntimeEvidence.nativeCommandAllowlist).toEqual(['list_midi_inputs']);
        expect(desktopRuntimeEvidence.unexpectedNativeCommandCount).toBe(0);
        expect(Date.parse(desktopRuntimeEvidence.capturedAt)).not.toBeNaN();
        expect(desktopRuntimeEvidence.consoleErrorCount).toBe(0);
        expect(desktopRuntimeEvidence.unexpectedWarningCount).toBe(0);
        expect(desktopRuntimeEvidence.pageErrorCount).toBe(0);
        expect(desktopRuntimeEvidence.failedRequestCount).toBe(0);
        expect(desktopRuntimeEvidence.externalRequestCount).toBe(0);
        expect(desktopRuntimeEvidence.httpErrorCount).toBe(0);
        expect(evidence.wavSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(evidence.wavHashScope).toContain('stochastic DSP');
        expect(Date.parse(evidence.capturedAt)).not.toBeNaN();
        expect(evidence.tailSeconds).toBe(2);
        expect(evidence.durationSeconds).toBeGreaterThan(240);
        expect(evidence.durationSeconds).toBeLessThan(242);
        expect(evidence.activeBlockRatio).toBeGreaterThan(0.5);
        expect(evidence.sampleRate).toBe(44_100);
        expect(evidence.channels).toBe(2);
        expect(evidence.bitsPerSample).toBe(24);
        expect(evidence.integratedLufs).toBeGreaterThanOrEqual(-11);
        expect(evidence.integratedLufs).toBeLessThanOrEqual(-8);
        expect(evidence.truePeakDbTp).toBeLessThanOrEqual(-0.8);
        expect(evidence.samplePeak).toBeLessThan(0.9);
        expect(evidence.clippedSampleCount).toBe(0);
        expect(maximumDcOffset).toBeLessThan(0.005);
        expect(evidence.lowMonoCompatibilityDb).toBeGreaterThan(-3);
        expect(evidence.lowCorrelation).toBeGreaterThan(0);
        expect(evidence.warningCount).toBe(0);
        expect(evidence.consoleErrorCount).toBe(0);
        expect(evidence.failedRequestCount).toBe(0);
    });
});
