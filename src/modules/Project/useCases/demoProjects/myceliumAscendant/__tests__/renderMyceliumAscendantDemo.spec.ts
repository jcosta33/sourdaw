import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

const RENDER_EVIDENCE_PATH = join(process.cwd(), 'docs/evidence/mycelium-ascendant/render-evidence.json');
const AUTOMATION_STEM_EVIDENCE_PATH = join(
    process.cwd(),
    'docs/evidence/mycelium-ascendant/automation-stem-evidence.json'
);
const MOTIF_EVENT_REPORT_PATH = join(process.cwd(), 'docs/evidence/mycelium-ascendant/motif-event-report.json');
const NOTE_EVENT_REPORT_PATH = join(process.cwd(), 'docs/evidence/mycelium-ascendant/note-event-report.json');
const DESKTOP_RUNTIME_EVIDENCE_PATH = join(
    process.cwd(),
    'docs/evidence/mycelium-ascendant/desktop-runtime-evidence.json'
);
type EvidenceStatus = 'historical-stale';

type RenderEvidence = {
    evidenceStatus: EvidenceStatus;
    durationBeats: number;
    projectSha256: string;
};

type AutomationStemEvidence = {
    evidenceStatus: EvidenceStatus;
    projectSha256: string;
};

type MotifEventReport = {
    evidenceStatus: EvidenceStatus;
    projectSha256: string;
};

type NoteEventReport = {
    evidenceStatus: EvidenceStatus;
    projectSha256: string;
};

type DesktopRuntimeEvidence = {
    evidenceStatus: EvidenceStatus;
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

function readNoteEventReport(): NoteEventReport {
    return JSON.parse(readFileSync(NOTE_EVENT_REPORT_PATH, 'utf8')) as NoteEventReport;
}

function readDesktopRuntimeEvidence(): DesktopRuntimeEvidence {
    return JSON.parse(readFileSync(DESKTOP_RUNTIME_EVIDENCE_PATH, 'utf8')) as DesktopRuntimeEvidence;
}

// Scope of this spec.
//
// Proves: all retained capture artifacts describe one historical blueprint and are explicitly
// marked stale after the canonical score reconstruction. The current blueprint must differ from
// that fingerprint until a fresh user render and audition replaces the whole evidence set.
//
// Does NOT prove: that any audio was rendered, or that a render met its targets. Nothing in
// this repository writes `docs/evidence/mycelium-ascendant/*.json` — the e2e specs only call
// `testInfo.attach`, which lands in the Playwright report. The files are transcribed by hand.
// An assertion that reads a measurement out of one and compares it to a literal here would
// only confirm that a human typed what a human typed, so none are made. The live audio and
// runtime assertions live in `tests/e2e/mycelium*.spec.ts`, which is not a CI health gate.
describe('Mycelium Ascendant full browser render', () => {
    it('keeps superseded render artifacts honest until the user records replacements', () => {
        const evidence = readRenderEvidence();
        const automationStemEvidence = readAutomationStemEvidence();
        const motifEventReport = readMotifEventReport();
        const noteEventReport = readNoteEventReport();
        const desktopRuntimeEvidence = readDesktopRuntimeEvidence();
        const { projectData } = createMyceliumAscendantBlueprint();
        const projectSha256 = createHash('sha256').update(JSON.stringify(projectData)).digest('hex');

        expect(projectData.meta.name).toBe('Mycelium Ascendant');
        expect(projectData.transport.loopEnd).toBe(evidence.durationBeats);
        expect(projectSha256).not.toBe(evidence.projectSha256);
        expect(automationStemEvidence.projectSha256).toBe(evidence.projectSha256);
        expect(motifEventReport.projectSha256).toBe(evidence.projectSha256);
        expect(noteEventReport.projectSha256).toBe(evidence.projectSha256);
        expect(desktopRuntimeEvidence.projectSha256).toBe(evidence.projectSha256);
        expect([
            evidence.evidenceStatus,
            automationStemEvidence.evidenceStatus,
            motifEventReport.evidenceStatus,
            noteEventReport.evidenceStatus,
            desktopRuntimeEvidence.evidenceStatus,
        ]).toEqual(Array.from({ length: 5 }, () => 'historical-stale'));
    });
});
