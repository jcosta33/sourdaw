import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

import type { ProjectData } from '../../../../models/ProjectData';

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
const NOTE_SECTIONS = [
    ['Sporefall', 0, 64],
    ['First Germination', 64, 128],
    ['Pressure Bloom', 128, 192],
    ['Drop I — Hyphal Drive', 192, 288],
    ['Psilocybin Chapel', 288, 352],
    ['Singularity Build', 352, 416],
    ['Drop II — Fractal Bloom', 416, 544],
    ['Dissolution', 544, 576],
] as const;
const SOURCE_PATHS = [
    'scripts/capture-mycelium-evidence.mjs',
    'src/modules/AudioEngine',
    'src/modules/Project/useCases/demoProjects/myceliumAscendant',
    'tests/e2e/analyzePcmWav.ts',
    'tests/e2e/e2eUtils.ts',
    'tests/e2e/myceliumAutomationStems.spec.ts',
    'tests/e2e/myceliumDesktopRuntime.spec.ts',
    'tests/e2e/myceliumEvidenceReceipt.ts',
    'tests/e2e/myceliumExport.spec.ts',
    'tests/e2e/playwright.mycelium.config.cjs',
] as const;

type EvidenceReceipt = {
    projectSha256: string;
    sourceRevision: string;
    sourceDirty: boolean;
    sourceTreeSha256: string;
    sourceTreeHashScope: string;
    receiptSha256: string;
};

type RenderEvidence = EvidenceReceipt & {
    durationBeats: number;
};

type AutomationStemEvidence = EvidenceReceipt;

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

type NoteEventReport = {
    projectSha256: string;
    totalNotes: number;
    sections: Array<{
        name: string;
        beats: number[];
        noteCount: number;
        tracks: Record<string, number>;
    }>;
};

type DesktopRuntimeEvidence = EvidenceReceipt;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasItems(value: unknown, property: string): boolean {
    if (!isRecord(value)) {
        return true;
    }
    const items = value[property];
    return !Array.isArray(items) || items.length > 0;
}

function normalizeProjectEvidence(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeProjectEvidence(item));
    }
    if (!isRecord(value)) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key, child]) => {
                if (key === 'createdAt' || key === 'updatedAt' || key === 'notes') {
                    return false;
                }
                if (
                    ((key === 'pitchBend' || key === 'pressure' || key === 'slide') && child === 0) ||
                    (key === 'probability' && child === 100)
                ) {
                    return false;
                }
                if (key === 'adjustmentLayers') {
                    return hasItems(child, 'layers');
                }
                if (key === 'grooves') {
                    return hasItems(child, 'assignments');
                }
                if (key === 'takeLanes') {
                    return hasItems(child, 'lanes');
                }
                return true;
            })
            .toSorted(([first], [second]) => first.localeCompare(second))
            .map(([key, child]) => [key, normalizeProjectEvidence(child)])
    );
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

function readNoteEventReport(): NoteEventReport {
    return JSON.parse(readFileSync(NOTE_EVENT_REPORT_PATH, 'utf8')) as NoteEventReport;
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

function buildNoteSections(projectData: ProjectData): NoteEventReport['sections'] {
    return NOTE_SECTIONS.map(([name, startBeat, endBeat]) => {
        const counts = new Map<string, number>();
        for (const track of projectData.arrangement.tracks) {
            for (const clip of track.clips) {
                for (const note of projectData.midi.notesByClipId[clip.id] ?? []) {
                    const absoluteBeat = clip.startBeat + note.startBeat;
                    if (absoluteBeat >= startBeat && absoluteBeat < endBeat) {
                        counts.set(track.name, (counts.get(track.name) ?? 0) + 1);
                    }
                }
            }
        }
        const tracks = Object.fromEntries(
            [...counts.entries()].toSorted(([first], [second]) => first.localeCompare(second))
        );
        return {
            name,
            beats: [startBeat, endBeat],
            noteCount: [...counts.values()].reduce((total, count) => total + count, 0),
            tracks,
        };
    });
}

function currentSourceTreeSha256(): string {
    const files = execFileSync('git', ['ls-files', '-z', '--', ...SOURCE_PATHS], {
        cwd: process.cwd(),
        encoding: 'utf8',
    })
        .split('\0')
        .filter((path) => path.length > 0)
        .toSorted();
    const hash = createHash('sha256');
    for (const path of files) {
        hash.update(path);
        hash.update('\0');
        hash.update(readFileSync(resolve(process.cwd(), path)));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function expectValidReceipt(
    receipt: EvidenceReceipt,
    projectSha256: string,
    sourceRevision: string,
    sourceTreeSha256: string
): void {
    const payload = { ...receipt };
    Reflect.deleteProperty(payload, 'receiptSha256');
    expect(receipt.receiptSha256).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
    expect(receipt.projectSha256).toBe(projectSha256);
    expect(receipt.sourceRevision).toBe(sourceRevision);
    expect(receipt.sourceDirty).toBe(false);
    expect(receipt.sourceTreeSha256).toBe(sourceTreeSha256);
    expect(receipt.sourceTreeHashScope).toBe(SOURCE_PATHS.join('|'));
}

// Scope of this spec.
//
// Proves: the demo blueprint still has the identity the recorded evidence files were
// written against. `projectSha256` is recomputed from `createMyceliumAscendantBlueprint()`
// on every run and compared to the live-project digest stored in all three runtime receipts,
// so any edit to the demo project turns them stale together and this test red. Receipt hashes
// bind their full persisted payloads, while the source-tree digest binds the generator,
// renderer, analyzer, and evidence tests that produced them. Motif and note reports are
// independently rebuilt from the blueprint and deep-compared here.
//
// Does NOT prove: that any audio was rendered, or that a render met its targets. Nothing in
// this unit spec analyzes audio. The maintained E2E specs make the live assertions, attach
// the complete receipts; `scripts/capture-mycelium-evidence.mjs` extracts those attachments and
// writes the exact receipt objects to the canonical evidence paths.
describe('Mycelium Ascendant full browser render', () => {
    it('pins the blueprint against the recorded evidence artifacts', () => {
        const evidence = readRenderEvidence();
        const automationStemEvidence = readAutomationStemEvidence();
        const motifEventReport = readMotifEventReport();
        const noteEventReport = readNoteEventReport();
        const desktopRuntimeEvidence = readDesktopRuntimeEvidence();
        const { projectData } = createMyceliumAscendantBlueprint();
        const projectSha256 = createHash('sha256')
            .update(JSON.stringify(normalizeProjectEvidence(projectData)))
            .digest('hex');
        const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        }).trim();
        const sourceTreeSha256 = currentSourceTreeSha256();
        const noteSections = buildNoteSections(projectData);

        expect(projectData.meta.name).toBe('Mycelium Ascendant');
        expect(projectData.transport.loopEnd).toBe(evidence.durationBeats);
        expectValidReceipt(evidence, projectSha256, sourceRevision, sourceTreeSha256);
        expectValidReceipt(automationStemEvidence, projectSha256, sourceRevision, sourceTreeSha256);
        expectValidReceipt(desktopRuntimeEvidence, projectSha256, sourceRevision, sourceTreeSha256);
        expect(motifEventReport.projectSha256).toBe(projectSha256);
        expect(motifEventReport.comparisons).toEqual(buildMotifComparisons(projectData));
        expect(noteEventReport.projectSha256).toBe(projectSha256);
        expect(noteEventReport.totalNotes).toBe(noteSections.reduce((total, section) => total + section.noteCount, 0));
        expect(noteEventReport.sections).toEqual(noteSections);
    });
});
