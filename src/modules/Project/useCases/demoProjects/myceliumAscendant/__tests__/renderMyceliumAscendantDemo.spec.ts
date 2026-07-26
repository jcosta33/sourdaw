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
    projectSha256: string;
    comparisons: MotifComparison[];
};

type DesktopRuntimeEvidence = {
    projectSha256: string;
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

// Scope of this spec.
//
// Proves: the demo blueprint still has the identity the recorded evidence files were
// written against. `projectSha256` is recomputed from `createMyceliumAscendantBlueprint()`
// on every run and compared to the digest stored in all four artifacts, so any edit to the
// demo project turns them stale together and this test red. The motif comparisons and
// `loopEnd` are likewise derived from the blueprint here, not read back from JSON.
//
// Does NOT prove: that any audio was rendered, or that a render met its targets. Nothing in
// this repository writes `docs/evidence/mycelium-ascendant/*.json` — the e2e specs only call
// `testInfo.attach`, which lands in the Playwright report. The files are transcribed by hand.
// An assertion that reads a measurement out of one and compares it to a literal here would
// only confirm that a human typed what a human typed, so none are made. The live audio and
// runtime assertions live in `tests/e2e/mycelium*.spec.ts`, which is not a CI health gate.
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
        expect(motifEventReport.projectSha256).toBe(projectSha256);
        expect(motifEventReport.comparisons).toEqual(buildMotifComparisons(projectData));
        expect(desktopRuntimeEvidence.projectSha256).toBe(projectSha256);
    });
});
