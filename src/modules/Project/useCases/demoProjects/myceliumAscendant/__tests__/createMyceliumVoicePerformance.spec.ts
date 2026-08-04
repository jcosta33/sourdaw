import { describe, expect, it } from 'vitest';

import { isHydratableProjectData } from '../../../projectPersistence/helpers/isHydratableProjectData';
import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';
import { createMyceliumVoicePerformance } from '../createMyceliumVoicePerformance';

import type { ProjectData, ProjectMidiNote } from '../../../../models/ProjectData';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VOICE_NAMES =
    'Triplet Helix|Psy Pluck|Main Vision|Counter Vision|Harmonic Mist|FM Spores|Levain Call|Levain Answer|Grand Boule Ritual|Root Drone|Granular Voices|Fractal Riser|Impact Field|Glitch Spirits'.split(
        '|'
    );
const ORGANIC_NAMES = ['Levain Call', 'Levain Answer', 'Grand Boule Ritual'] as const;
const SECTIONS = [
    ['Sporefall', 0, 64],
    ['First Germination', 64, 128],
    ['Pressure Bloom', 128, 192],
    ['Drop I', 192, 288],
    ['Psilocybin Chapel', 288, 352],
    ['Singularity Build', 352, 416],
    ['Drop II', 416, 544],
    ['Dissolution', 544, 576],
] as const;

type AbsoluteNote = ProjectMidiNote & { absoluteBeat: number; trackName: string; clipId: string };

function getNotes(projectData: ProjectData, trackNames: readonly string[]): AbsoluteNote[] {
    return projectData.arrangement.tracks
        .filter((track) => trackNames.includes(track.name))
        .flatMap((track) =>
            track.clips.flatMap((clip) =>
                (projectData.midi.notesByClipId[clip.id] ?? []).map((note) => ({
                    ...note,
                    absoluteBeat: clip.startBeat + note.startBeat,
                    trackName: track.name,
                    clipId: clip.id,
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

describe('createMyceliumVoicePerformance', () => {
    it('adds deterministic canonical voice material beyond the global performance floor', () => {
        const first = createMyceliumAscendantBlueprint().projectData;
        const second = createMyceliumAscendantBlueprint().projectData;
        const voiceTracks = first.arrangement.tracks.filter((track) => VOICE_NAMES.some((name) => name === track.name));
        const voiceClips = voiceTracks.flatMap((track) => track.clips);
        const allClips = first.arrangement.tracks.flatMap((track) => track.clips);
        const allNotes = allClips.flatMap((clip) => first.midi.notesByClipId[clip.id] ?? []);
        const ids = [...allClips.map((clip) => clip.id), ...allNotes.map((note) => note.id)];
        const active = first.arrangements?.find((arrangement) => arrangement.id === first.activeArrangementId);
        const sourceSnapshot = structuredClone(first);

        expect(voiceTracks.map((track) => track.name)).toEqual(VOICE_NAMES);
        expect(allClips).toHaveLength(119);
        expect(allNotes).toHaveLength(3_985);
        expect(
            allNotes.every((note) => Number.isInteger(note.velocity) && note.velocity >= 1 && note.velocity <= 127)
        ).toBe(true);
        expect(
            voiceClips.every((clip) =>
                (first.midi.notesByClipId[clip.id] ?? []).every(
                    (note) => note.startBeat >= 0 && note.startBeat + note.duration <= clip.endBeat - clip.startBeat
                )
            )
        ).toBe(true);
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
        createMyceliumVoicePerformance(first);
        expect(first).toEqual(sourceSnapshot);
        expect(isHydratableProjectData(first)).toBe(true);
    });

    it('produces a normalized section and track note report with substantive coverage', () => {
        const projectData = createMyceliumAscendantBlueprint().projectData;
        const normalizedReport = SECTIONS.map(([section, startBeat, endBeat]) => {
            const tracks = VOICE_NAMES.flatMap((trackName) => {
                const notes = inRange(getNotes(projectData, [trackName]), startBeat, endBeat);
                return notes.length > 0 ? [{ trackName, noteCount: notes.length }] : [];
            });
            return `${section}: ${tracks.map(({ trackName, noteCount }) => `${trackName}=${noteCount}`).join(', ')}`;
        });

        expect(normalizedReport).toEqual([
            'Sporefall: Harmonic Mist=32, Levain Call=32, Grand Boule Ritual=32, Root Drone=4, Granular Voices=16, Glitch Spirits=16',
            'First Germination: Triplet Helix=32, Psy Pluck=32, Levain Answer=32, Granular Voices=16',
            'Pressure Bloom: Psy Pluck=32, FM Spores=32, Granular Voices=16, Fractal Riser=16, Impact Field=16',
            'Drop I: Psy Pluck=48, Main Vision=24, Counter Vision=24, FM Spores=48, Levain Call=12, Levain Answer=12, Grand Boule Ritual=12, Glitch Spirits=24',
            'Psilocybin Chapel: Psy Pluck=68, Harmonic Mist=68, Levain Call=36, Levain Answer=36, Grand Boule Ritual=36, Root Drone=5, Granular Voices=67, Glitch Spirits=68',
            'Singularity Build: Triplet Helix=64, FM Spores=63, Fractal Riser=32, Impact Field=32, Glitch Spirits=32',
            'Drop II: Triplet Helix=64, Psy Pluck=64, Main Vision=32, Counter Vision=32, Harmonic Mist=64, FM Spores=64, Levain Call=16, Levain Answer=16, Grand Boule Ritual=16, Glitch Spirits=32',
            'Dissolution: Main Vision=4, Harmonic Mist=8, Levain Call=16, Grand Boule Ritual=16, Root Drone=2, Granular Voices=8',
        ]);
    });

    it('transforms one compact interval cell by inversion, displacement, register, and timbre', () => {
        const projectData = createMyceliumAscendantBlueprint().projectData;
        const signatures = projectData.arrangement.tracks
            .filter((track) => VOICE_NAMES.some((name) => name === track.name))
            .flatMap((track) =>
                track.clips.flatMap((clip) => {
                    const pitches = (projectData.midi.notesByClipId[clip.id] ?? [])
                        .slice(0, 4)
                        .map((note) => note.pitch);
                    if (pitches.length !== 4) {
                        return [];
                    }
                    return [pitches.slice(1).map((pitch, index) => pitch - pitches[index]!)];
                })
            );
        const notes = getNotes(projectData, VOICE_NAMES);
        const displacements = new Set(notes.map((note) => note.startBeat % 1));
        const pitches = notes.map((note) => note.pitch);

        expect(signatures).toContainEqual([3, 4, -5]);
        expect(signatures).toContainEqual([-3, -4, 5]);
        expect(displacements.size).toBeGreaterThanOrEqual(4);
        expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThanOrEqual(36);
        expect(new Set(notes.map((note) => note.trackName)).size).toBe(VOICE_NAMES.length);
    });

    it('phrases call and response on real 7/8 bars and leaves drop space for the rhythm engine', () => {
        const projectData = createMyceliumAscendantBlueprint().projectData;
        const call = inRange(getNotes(projectData, ['Levain Call']), 288, 316);
        const answer = inRange(getNotes(projectData, ['Levain Answer']), 288, 316);
        const chapel = inRange(getNotes(projectData, VOICE_NAMES), 288, 316);
        const dropOrganic = [
            ...inRange(getNotes(projectData, ORGANIC_NAMES), 192, 288),
            ...inRange(getNotes(projectData, ORGANIC_NAMES), 416, 544),
        ];

        expect(new Set(call.map((note) => Math.floor((note.absoluteBeat - 288) / 3.5)))).toEqual(new Set([0, 2, 4, 6]));
        expect(new Set(answer.map((note) => Math.floor((note.absoluteBeat - 288) / 3.5)))).toEqual(
            new Set([1, 3, 5, 7])
        );
        expect(chapel.some((note) => note.absoluteBeat === 315.125)).toBe(true);
        expect(dropOrganic.every((note) => note.absoluteBeat % 1 !== 0)).toBe(true);
        expect(dropOrganic.length).toBeLessThan(96);
    });

    it('exchanges drop voices, preserves automation-causal silence windows, and dissolves to organic atmosphere', () => {
        const projectData = createMyceliumAscendantBlueprint().projectData;
        const voices = getNotes(projectData, VOICE_NAMES);
        const late = inRange(voices, 560, 576);
        const trackByName = new Map(projectData.arrangement.tracks.map((track) => [track.name, track]));

        const exchangeWindows = [
            [192, 288],
            [416, 544],
        ] as const;
        for (const [startBeat, endBeat] of exchangeWindows) {
            const blockSets = ['Main Vision', 'Counter Vision'].map((trackName) => {
                const notes = inRange(getNotes(projectData, [trackName]), startBeat, endBeat);
                return new Set(notes.map((note) => Math.floor((note.absoluteBeat - startBeat) / 8)));
            });
            for (let blockIndex = 0; blockIndex < Math.ceil((endBeat - startBeat) / 8); blockIndex++) {
                expect(blockSets.map((blocks) => blocks.has(blockIndex))).toEqual([
                    blockIndex % 2 === 0,
                    blockIndex % 2 === 1,
                ]);
            }
        }
        expect(overlaps(voices, 191.75, 192)).toEqual([]);
        expect(overlaps(voices, 415.75, 416)).toEqual([]);
        for (const trackName of ['Triplet Helix', 'Main Vision', 'Levain Call', 'Glitch Spirits']) {
            const track = trackByName.get(trackName);
            const gainLane = projectData.automation.lanes.find(
                (lane) => lane.trackId === track?.id && lane.parameterId === 'gain'
            );

            expect(overlaps(getNotes(projectData, [trackName]), 480, 484).length).toBeGreaterThan(0);
            expect(gainLane?.points.find((point) => point.beat === 480)?.value).toBe(0);
            expect(gainLane?.points.find((point) => point.beat === 480)?.curve).toBe('step');
            expect(gainLane?.points.find((point) => point.beat === 484)?.value).toBeGreaterThan(0);
        }
        expect(new Set(late.map((note) => note.trackName))).toEqual(
            new Set(['Levain Call', 'Grand Boule Ritual', 'Root Drone', 'Granular Voices'])
        );
    });
});
