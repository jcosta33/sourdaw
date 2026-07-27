import { describe, expect, it } from 'vitest';

import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

const WINDOW_BEATS = 16;
const QUARTER_BEATS_PER_BEAT = 4;
const MAX_CANDIDATE_NOTES_PER_SCHEDULER_BEAT = 320;
const MAX_NOTE_STARTS_PER_BEAT = 24;
const MAX_NOTE_STARTS_PER_QUARTER_BEAT = 10;
const MAX_ACTIVE_GENERATOR_TRACKS_PER_WINDOW = 18;
const MAX_SIMULTANEOUS_VOICES = 40;

const GENERATOR_TYPES = new Set(['fermenter', 'toaster', 'levain', 'grand-boule']);
const REALTIME_PROCESSOR_TYPES = new Set([
    ...GENERATOR_TYPES,
    'bacteria',
    'dutch-oven',
    'gluten',
    'proof',
    'builtin-sidechain-compressor',
]);

describe('createMyceliumAscendantBlueprint — live session performance', () => {
    it('stays inside the playable event and processor envelope', () => {
        const { projectData } = createMyceliumAscendantBlueprint();
        const noteStartsPerBeat = new Map<number, number>();
        const noteStartsPerQuarterBeat = new Map<number, number>();
        const voiceEvents: Array<{ beat: number; delta: 1 | -1 }> = [];
        const generatorWindows = new Map<number, Set<string>>();
        const noteCountsByTrack = new Map<string, number>();
        const candidateNotesPerSchedulerBeat = new Map<number, number>();
        const candidateNotesByTrackPerSchedulerBeat = new Map<number, Map<string, number>>();
        const toasterParentId = projectData.arrangement.tracks.find((candidate) =>
            candidate.devices.some((device) => device.type === 'toaster')
        )?.id;

        for (const track of projectData.arrangement.tracks) {
            const isToasterPad = track.parentId === toasterParentId;
            const isGeneratorTrack = track.devices.some((device) => GENERATOR_TYPES.has(device.type)) || isToasterPad;
            const generatorId = isToasterPad ? toasterParentId : track.id;

            for (const clip of track.clips) {
                const clipNotes = projectData.midi.notesByClipId[clip.id] ?? [];
                for (let beat = Math.floor(clip.startBeat); beat < Math.ceil(clip.endBeat); beat++) {
                    candidateNotesPerSchedulerBeat.set(
                        beat,
                        (candidateNotesPerSchedulerBeat.get(beat) ?? 0) + clipNotes.length
                    );
                    const trackCandidates =
                        candidateNotesByTrackPerSchedulerBeat.get(beat) ?? new Map<string, number>();
                    trackCandidates.set(track.name, (trackCandidates.get(track.name) ?? 0) + clipNotes.length);
                    candidateNotesByTrackPerSchedulerBeat.set(beat, trackCandidates);
                }

                for (const note of clipNotes) {
                    noteCountsByTrack.set(track.name, (noteCountsByTrack.get(track.name) ?? 0) + 1);
                    const startBeat = clip.startBeat + note.startBeat;
                    const endBeat = startBeat + note.duration;
                    const beatBucket = Math.floor(startBeat);
                    const quarterBeatBucket = Math.floor(startBeat * QUARTER_BEATS_PER_BEAT);
                    noteStartsPerBeat.set(beatBucket, (noteStartsPerBeat.get(beatBucket) ?? 0) + 1);
                    noteStartsPerQuarterBeat.set(
                        quarterBeatBucket,
                        (noteStartsPerQuarterBeat.get(quarterBeatBucket) ?? 0) + 1
                    );
                    voiceEvents.push({ beat: startBeat, delta: 1 }, { beat: endBeat, delta: -1 });

                    if (isGeneratorTrack && generatorId) {
                        const firstWindow = Math.floor(startBeat / WINDOW_BEATS);
                        const lastWindow = Math.floor(Math.max(startBeat, endBeat - Number.EPSILON) / WINDOW_BEATS);
                        for (let window = firstWindow; window <= lastWindow; window++) {
                            const tracks = generatorWindows.get(window) ?? new Set<string>();
                            tracks.add(generatorId);
                            generatorWindows.set(window, tracks);
                        }
                    }
                }
            }
        }

        voiceEvents.sort((left, right) => left.beat - right.beat || left.delta - right.delta);
        let activeVoices = 0;
        let maxSimultaneousVoices = 0;
        for (const event of voiceEvents) {
            activeVoices += event.delta;
            maxSimultaneousVoices = Math.max(maxSimultaneousVoices, activeVoices);
        }
        const [peakSchedulerBeat, maxCandidateNotesPerSchedulerBeat] = Array.from(
            candidateNotesPerSchedulerBeat.entries()
        ).sort((left, right) => right[1] - left[1])[0]!;

        const metrics = {
            totalNotes: Object.values(projectData.midi.notesByClipId).reduce((total, notes) => total + notes.length, 0),
            maxNoteStartsPerBeat: Math.max(...noteStartsPerBeat.values()),
            maxNoteStartsPerQuarterBeat: Math.max(...noteStartsPerQuarterBeat.values()),
            maxActiveGeneratorTracksPerWindow: Math.max(
                ...Array.from(generatorWindows.values(), (tracks) => tracks.size)
            ),
            maxSimultaneousVoices,
            maxCandidateNotesPerSchedulerBeat,
            peakSchedulerBeat,
            peakTrackCandidateNotes: Array.from(
                candidateNotesByTrackPerSchedulerBeat.get(peakSchedulerBeat)?.entries() ?? []
            ).sort((left, right) => right[1] - left[1]),
            realtimeProcessorDevices: projectData.arrangement.tracks
                .flatMap((track) => track.devices)
                .filter((device) => REALTIME_PROCESSOR_TYPES.has(device.type)).length,
            trackProcessors: projectData.arrangement.tracks.length,
            topTrackNoteCounts: Array.from(noteCountsByTrack.entries())
                .sort((left, right) => right[1] - left[1])
                .slice(0, 12),
        };
        const metricEvidence = JSON.stringify(metrics);

        expect(metrics.maxCandidateNotesPerSchedulerBeat, metricEvidence).toBeLessThanOrEqual(
            MAX_CANDIDATE_NOTES_PER_SCHEDULER_BEAT
        );
        expect(metrics.maxNoteStartsPerBeat, metricEvidence).toBeLessThanOrEqual(MAX_NOTE_STARTS_PER_BEAT);
        expect(metrics.maxNoteStartsPerQuarterBeat, metricEvidence).toBeLessThanOrEqual(
            MAX_NOTE_STARTS_PER_QUARTER_BEAT
        );
        expect(metrics.maxActiveGeneratorTracksPerWindow, metricEvidence).toBeLessThanOrEqual(
            MAX_ACTIVE_GENERATOR_TRACKS_PER_WINDOW
        );
        expect(metrics.maxSimultaneousVoices, metricEvidence).toBeLessThanOrEqual(MAX_SIMULTANEOUS_VOICES);
    });
});
