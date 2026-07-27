import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
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
const EVIDENCE_PATHSPEC = ':(exclude)docs/evidence/mycelium-ascendant/**';
const SOURCE_TREE_HASH_SCOPE = 'git-ls-files-excluding:docs/evidence/mycelium-ascendant/**';

type EvidenceReceipt = {
    projectSha256: string;
    projectSectionSha256: Record<string, string>;
    sourceRevision: string;
    sourceDirty: boolean;
    sourceTreeSha256: string;
    sourceTreeHashScope: string;
    sourceTrackedFileCount: number;
    trackNotesMutationSha256: string;
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

function isSerializedProjectClip(value: Record<string, unknown>): boolean {
    return (
        typeof value.id === 'string' &&
        typeof value.trackId === 'string' &&
        typeof value.startBeat === 'number' &&
        typeof value.endBeat === 'number' &&
        (value.type === 'audio' || value.type === 'midi')
    );
}

function normalizeProjectEvidence(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeProjectEvidence(item));
    }
    if (!isRecord(value)) {
        return value;
    }
    const entries = Object.entries(value).filter(([key, child]) => {
        if (child === undefined) {
            return false;
        }
        if (key === 'createdAt' || key === 'updatedAt') {
            return false;
        }
        if (key === 'notes' && Array.isArray(child) && isSerializedProjectClip(value)) {
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
        if (key === 'ghostClips') {
            return !Array.isArray(child) || child.length > 0;
        }
        if (key === 'takeLanes') {
            return hasItems(child, 'lanes');
        }
        return true;
    });
    return Object.fromEntries(
        entries
            .toSorted(([first], [second]) => first.localeCompare(second))
            .map(([key, child]) => {
                if (key === 'frequencies' && Array.isArray(child)) {
                    return [
                        key,
                        child.map((frequency: unknown) =>
                            typeof frequency === 'number' ? Number(frequency.toPrecision(12)) : frequency
                        ),
                    ];
                }
                return [key, normalizeProjectEvidence(child)];
            })
    );
}

function projectSectionSha256(normalizedProject: unknown): Record<string, string> {
    if (!isRecord(normalizedProject)) {
        throw new TypeError('Mycelium evidence normalization did not produce a project object');
    }
    return Object.fromEntries(
        Object.entries(normalizedProject).map(([key, value]) => [
            key,
            createHash('sha256').update(JSON.stringify(value)).digest('hex'),
        ])
    );
}

function trackNotesMutationSha256(projectData: ProjectData): string {
    const mutationProject = structuredClone(projectData);
    const mutationTrack = mutationProject.arrangement.tracks.find((track) => track.name === 'Pulse Engine');
    if (!mutationTrack) {
        throw new Error('Mycelium evidence could not select Pulse Engine for the track-notes mutation probe');
    }
    mutationTrack.notes = `${mutationTrack.notes}\n[mycelium-evidence-track-notes-probe]`;
    return createHash('sha256')
        .update(JSON.stringify(normalizeProjectEvidence(mutationProject)))
        .digest('hex');
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

function currentSourceTreeManifest(): { sha256: string; trackedFileCount: number } {
    const files = execFileSync('git', ['ls-files', '-z', '--', '.', EVIDENCE_PATHSPEC], {
        cwd: process.cwd(),
        encoding: 'utf8',
    })
        .split('\0')
        .filter((path) => path.length > 0)
        .toSorted();
    const hash = createHash('sha256');
    for (const path of files) {
        const absolutePath = resolve(process.cwd(), path);
        hash.update(path);
        hash.update('\0');
        hash.update(lstatSync(absolutePath).isSymbolicLink() ? readlinkSync(absolutePath) : readFileSync(absolutePath));
        hash.update('\0');
    }
    return { sha256: hash.digest('hex'), trackedFileCount: files.length };
}

function expectValidReceipt(
    receipt: EvidenceReceipt,
    projectSha256: string,
    expectedProjectSectionSha256: Record<string, string>,
    expectedTrackNotesMutationSha256: string,
    sourceRevision: string,
    sourceTreeManifest: { sha256: string; trackedFileCount: number }
): void {
    const payload = { ...receipt };
    Reflect.deleteProperty(payload, 'receiptSha256');
    expect(receipt.receiptSha256).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
    expect(receipt.projectSectionSha256).toEqual(expectedProjectSectionSha256);
    expect(receipt.projectSha256).toBe(projectSha256);
    expect(receipt.trackNotesMutationSha256).toBe(expectedTrackNotesMutationSha256);
    expect(receipt.sourceRevision).toBe(sourceRevision);
    expect(receipt.sourceDirty).toBe(false);
    expect(receipt.sourceTreeSha256).toBe(sourceTreeManifest.sha256);
    expect(receipt.sourceTreeHashScope).toBe(SOURCE_TREE_HASH_SCOPE);
    expect(receipt.sourceTrackedFileCount).toBe(sourceTreeManifest.trackedFileCount);
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
        const normalizedProject = normalizeProjectEvidence(projectData);
        const projectSha256 = createHash('sha256').update(JSON.stringify(normalizedProject)).digest('hex');
        const expectedProjectSectionSha256 = projectSectionSha256(normalizedProject);
        const expectedTrackNotesMutationSha256 = trackNotesMutationSha256(projectData);
        const sourceRevision = evidence.sourceRevision;
        execFileSync('git', ['merge-base', '--is-ancestor', sourceRevision, 'HEAD'], {
            cwd: process.cwd(),
        });
        const sourceTreeManifest = currentSourceTreeManifest();
        const noteSections = buildNoteSections(projectData);

        expect(projectData.meta.name).toBe('Mycelium Ascendant');
        expect(projectData.transport.loopEnd).toBe(evidence.durationBeats);
        expectValidReceipt(
            desktopRuntimeEvidence,
            projectSha256,
            expectedProjectSectionSha256,
            expectedTrackNotesMutationSha256,
            sourceRevision,
            sourceTreeManifest
        );
        expectValidReceipt(
            evidence,
            projectSha256,
            expectedProjectSectionSha256,
            expectedTrackNotesMutationSha256,
            sourceRevision,
            sourceTreeManifest
        );
        expectValidReceipt(
            automationStemEvidence,
            projectSha256,
            expectedProjectSectionSha256,
            expectedTrackNotesMutationSha256,
            sourceRevision,
            sourceTreeManifest
        );
        expect(motifEventReport.projectSha256).toBe(projectSha256);
        expect(motifEventReport.comparisons).toEqual(buildMotifComparisons(projectData));
        expect(noteEventReport.projectSha256).toBe(projectSha256);
        expect(noteEventReport.totalNotes).toBe(noteSections.reduce((total, section) => total + section.noteCount, 0));
        expect(noteEventReport.sections).toEqual(noteSections);
    });

    it('includes persistent track notes in the project evidence digest', () => {
        const { projectData } = createMyceliumAscendantBlueprint();
        const projectSha256 = createHash('sha256')
            .update(JSON.stringify(normalizeProjectEvidence(projectData)))
            .digest('hex');

        expect(trackNotesMutationSha256(projectData)).not.toBe(projectSha256);
    });
});
