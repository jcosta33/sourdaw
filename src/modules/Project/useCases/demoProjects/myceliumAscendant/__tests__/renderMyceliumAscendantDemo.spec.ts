import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    durationBeats: number;
    projectSha256: string;
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
    it('pins the blueprint against the recorded evidence artifacts', () => {
        const evidence = readRenderEvidence();
        const automationStemEvidence = readAutomationStemEvidence();
        const motifEventReport = readMotifEventReport();
        const desktopRuntimeEvidence = readDesktopRuntimeEvidence();
        const { projectData } = createMyceliumAscendantBlueprint();
        const projectSha256 = createHash('sha256').update(JSON.stringify(projectData)).digest('hex');

        expect(projectData.meta.name).toBe('Mycelium Ascendant');
        expect(projectData.transport.loopEnd).toBe(evidence.durationBeats);
        expect(projectSha256).toBe(evidence.projectSha256);
        expect(automationStemEvidence.projectSha256).toBe(projectSha256);
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
    });
});
