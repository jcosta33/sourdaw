import { describe, expect, it } from 'vitest';

import { isHydratableProjectData } from '../../../projectPersistence/helpers/isHydratableProjectData';
import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

import type { ProjectData, ProjectMidiNote } from '../../../../models/ProjectData';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAD_NAMES = [
    'Kick',
    'Snare',
    'Closed HH',
    'Open HH',
    'Clap',
    'Rim',
    'Low Tom',
    'Mid Tom',
    'Hi Tom',
    'Crash',
    'Ride',
    'Cowbell',
    'Clave',
    'Shaker',
    'Perc 1',
    'Perc 2',
] as const;
const BASS_NAMES = ['Sub Mycelium', 'Rolling Colony', 'Acid Tendril'] as const;

type AbsoluteNote = ProjectMidiNote & { absoluteBeat: number; trackName: string };

function getNotes(projectData: ProjectData, trackNames: readonly string[]): AbsoluteNote[] {
    return projectData.arrangement.tracks
        .filter((track) => trackNames.includes(track.name))
        .flatMap((track) =>
            track.clips.flatMap((clip) =>
                (projectData.midi.notesByClipId[clip.id] ?? []).map((note) => ({
                    ...note,
                    absoluteBeat: clip.startBeat + note.startBeat,
                    trackName: track.name,
                }))
            )
        );
}

function inRange(notes: AbsoluteNote[], startBeat: number, endBeat: number): AbsoluteNote[] {
    return notes.filter((note) => note.absoluteBeat >= startBeat && note.absoluteBeat < endBeat);
}

function overlaps(notes: AbsoluteNote[], startBeat: number, endBeat: number): AbsoluteNote[] {
    return notes.filter((note) => note.absoluteBeat < endBeat && note.absoluteBeat + note.duration > startBeat);
}

function pressureCounts(notes: AbsoluteNote[]): number[] {
    return [inRange(notes, 128, 160).length, inRange(notes, 160, 176).length, inRange(notes, 176, 191.75).length];
}

describe('createMyceliumRhythmPerformance', () => {
    it('creates canonical nonempty clips and valid clip-relative notes for every rhythm track', () => {
        const first = createMyceliumAscendantBlueprint().projectData;
        const second = createMyceliumAscendantBlueprint().projectData;
        const rhythmNames: readonly string[] = [...PAD_NAMES, ...BASS_NAMES];
        const tracks = first.arrangement.tracks.filter((track) => rhythmNames.includes(track.name));
        const clips = tracks.flatMap((track) => track.clips);
        const notes = clips.flatMap((clip) => first.midi.notesByClipId[clip.id] ?? []);
        const ids = [...clips.map((clip) => clip.id), ...notes.map((note) => note.id)];
        const active = first.arrangements?.find((arrangement) => arrangement.id === first.activeArrangementId);

        expect(tracks.map((track) => track.name)).toEqual(rhythmNames);
        expect(clips.length).toBeGreaterThanOrEqual(35);
        expect(clips.length).toBeLessThan(70);
        expect(notes.length).toBeGreaterThanOrEqual(1400);
        expect(notes.length).toBeLessThan(2200);
        expect(
            notes.every((note) => Number.isInteger(note.velocity) && note.velocity >= 1 && note.velocity <= 127)
        ).toBe(true);
        expect(clips.every((clip) => (first.midi.notesByClipId[clip.id]?.length ?? 0) > 0)).toBe(true);
        expect(
            clips.every((clip) =>
                (first.midi.notesByClipId[clip.id] ?? []).every(
                    (note) => note.startBeat >= 0 && note.startBeat + note.duration <= clip.endBeat - clip.startBeat
                )
            )
        ).toBe(true);
        expect(PAD_NAMES.every((name) => tracks.find((track) => track.name === name)?.clips.length)).toBe(true);
        expect(ids.every((id) => UUID_PATTERN.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
        expect(active?.tracks?.tracks).toBe(first.arrangement.tracks);
        expect(active?.midi).toEqual({
            notesByClipId: first.midi.notesByClipId,
            ccByClipId: first.midi.ccByClipId,
            pitchBendByClipId: first.midi.pitchBendByClipId,
        });
        expect(active?.midi).not.toHaveProperty('probabilitySeed');
        expect(first).toEqual(second);
        expect(JSON.parse(JSON.stringify(first))).toEqual(first);
        expect(isHydratableProjectData(first)).toBe(true);
    });

    it('teases shuffled ghosts, progressively blooms, and preserves both quarter-beat vacuums', () => {
        const projectData = createMyceliumAscendantBlueprint().projectData;
        const kick = getNotes(projectData, ['Kick']);
        const bass = getNotes(projectData, BASS_NAMES);
        const shuffledPercussion = inRange(getNotes(projectData, ['Shaker']), 64, 128);
        const ghostBass = inRange(bass, 64, 128);
        const rolling = getNotes(projectData, ['Rolling Colony']);
        const hats = getNotes(projectData, ['Closed HH', 'Open HH']);
        const fills = getNotes(projectData, ['Clap', 'Rim', 'Low Tom', 'Mid Tom', 'Hi Tom']);
        const shuffleIntervals = shuffledPercussion
            .slice(1)
            .map((note, index) => note.absoluteBeat - shuffledPercussion[index]!.absoluteBeat);

        expect(inRange(kick, 0, 128).map((note) => note.absoluteBeat)).toEqual([64, 72, 80, 88, 96, 104, 112, 120]);
        expect(ghostBass.length).toBeGreaterThanOrEqual(3);
        expect(ghostBass.length).toBeLessThanOrEqual(8);
        expect(new Set(shuffleIntervals)).toEqual(new Set([4.25, 3.75]));
        expect(inRange(kick, 128, 191.75).map((note) => note.absoluteBeat)).toEqual(
            Array.from({ length: 64 }, (_, index) => 128 + index)
        );
        for (const notes of [rolling, hats, fills]) {
            const counts = pressureCounts(notes);
            expect(counts[0]).toBeLessThan(counts[1]!);
            expect(counts[1]).toBeLessThan(counts[2]!);
        }
        expect(overlaps(getNotes(projectData, [...PAD_NAMES, ...BASS_NAMES]), 191.75, 192)).toEqual([]);
        expect(overlaps(getNotes(projectData, [...PAD_NAMES, ...BASS_NAMES]), 415.75, 416)).toEqual([]);
    });

    it('locks both drops to four-on-floor kick and three short bass notes between kicks', () => {
        const projectData = createMyceliumAscendantBlueprint().projectData;
        const kick = getNotes(projectData, ['Kick']);
        const rolling = getNotes(projectData, ['Rolling Colony']);
        const dropKickBeats = [
            ...Array.from({ length: 96 }, (_, index) => 192 + index),
            ...Array.from({ length: 128 }, (_, index) => 416 + index),
        ];

        expect([...inRange(kick, 192, 288), ...inRange(kick, 416, 544)].map((note) => note.absoluteBeat)).toEqual(
            dropKickBeats
        );
        for (const kickBeat of dropKickBeats) {
            expect(inRange(rolling, kickBeat, kickBeat + 1).map((note) => note.absoluteBeat)).toEqual([
                kickBeat + 0.25,
                kickBeat + 0.5,
                kickBeat + 0.75,
            ]);
        }
        expect(new Set(rolling.map((note) => note.velocity)).size).toBeGreaterThan(3);
        expect(new Set(rolling.map((note) => note.duration)).size).toBeGreaterThan(2);
        expect(getNotes(projectData, BASS_NAMES).every((note) => note.absoluteBeat % 1 >= 0.25)).toBe(true);
        expect(PAD_NAMES.every((name) => inRange(getNotes(projectData, [name]), 416, 544).length > 0)).toBe(true);
    });

    it('uses real 7/8 bars and section-cadenced tom, rim, shaker, and clap fills', () => {
        const projectData = createMyceliumAscendantBlueprint().projectData;
        const kickAndRolling = getNotes(projectData, ['Kick', 'Rolling Colony']);
        const shaker = inRange(getNotes(projectData, ['Shaker']), 288, 316);
        const underlyingSub = inRange(getNotes(projectData, ['Sub Mycelium']), 288, 316);
        const fillNames = ['Low Tom', 'Mid Tom', 'Hi Tom', 'Rim', 'Shaker', 'Clap'];
        const fills = getNotes(projectData, fillNames);

        expect(inRange(kickAndRolling, 288, 316)).toEqual([]);
        expect(underlyingSub.map((note) => note.absoluteBeat)).toEqual(
            Array.from({ length: 7 }, (_, index) => 288.25 + index * 4)
        );
        expect(shaker.map((note) => note.absoluteBeat)).toEqual(
            Array.from({ length: 56 }, (_, index) => 288 + index * 0.5)
        );
        expect(shaker.some((note) => note.absoluteBeat === 291.5)).toBe(true);
        for (const startBeat of [192, 224, 256]) {
            expect(inRange(fills, startBeat + 28, startBeat + 32).length).toBeGreaterThan(0);
        }
        for (const startBeat of [416, 432, 448, 464, 480, 496, 512, 528]) {
            expect(inRange(fills, Math.max(startBeat + 12, startBeat), startBeat + 16).length).toBeGreaterThan(0);
        }
        expect(new Set(fills.map((note) => note.trackName))).toEqual(new Set(fillNames));
    });

    it('accelerates fragmented build rolls and peels drums and bass through dissolution', () => {
        const projectData = createMyceliumAscendantBlueprint().projectData;
        const buildBass = inRange(getNotes(projectData, BASS_NAMES), 352, 415.75);
        const rolls = getNotes(projectData, ['Hi Tom']);
        const allRhythm = getNotes(projectData, [...PAD_NAMES, ...BASS_NAMES]);
        const rollCounts = [
            inRange(rolls, 352, 384).length,
            inRange(rolls, 384, 400).length,
            inRange(rolls, 400, 415.75).length,
        ];
        const peelCounts = [544, 552, 560, 568].map((beat) => inRange(allRhythm, beat, beat + 8).length);

        expect(buildBass.length).toBeGreaterThan(12);
        expect(rollCounts[0]).toBeLessThan(rollCounts[1]!);
        expect(rollCounts[1]).toBeLessThan(rollCounts[2]!);
        expect(peelCounts[0]).toBeGreaterThan(peelCounts[1]!);
        expect(peelCounts[1]).toBeGreaterThan(peelCounts[2]!);
        expect(peelCounts[2]).toBeGreaterThan(peelCounts[3]!);
    });
});
