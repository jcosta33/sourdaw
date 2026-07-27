import { describe, expect, it } from 'vitest';

import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

const WINDOW_BEATS = 16;
const QUARTER_BEATS_PER_BEAT = 4;
const MAX_TOTAL_CLIPS = 140;
const MAX_NOTE_STARTS_PER_BEAT = 24;
const MAX_NOTE_STARTS_PER_QUARTER_BEAT = 10;
const MAX_ACTIVE_GENERATOR_TRACKS_PER_WINDOW = 18;
const MAX_SIMULTANEOUS_VOICES = 40;
const MAX_REALTIME_PROCESSOR_DEVICES = 28;
const MAX_TRACK_PROCESSORS = 48;

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
        const toasterParentId = projectData.arrangement.tracks.find((candidate) =>
            candidate.devices.some((device) => device.type === 'toaster')
        )?.id;

        for (const track of projectData.arrangement.tracks) {
            const isToasterPad = track.parentId === toasterParentId;
            const isGeneratorTrack = track.devices.some((device) => GENERATOR_TYPES.has(device.type)) || isToasterPad;
            const generatorId = isToasterPad ? toasterParentId : track.id;

            for (const clip of track.clips) {
                const clipNotes = projectData.midi.notesByClipId[clip.id] ?? [];
                for (const note of clipNotes) {
                    noteCountsByTrack.set(track.name, (noteCountsByTrack.get(track.name) ?? 0) + 1);
                    const startBeat = clip.startBeat + note.startBeat - (clip.midiOffsetBeats ?? 0);
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

        const metrics = {
            totalNotes: Object.values(projectData.midi.notesByClipId).reduce((total, notes) => total + notes.length, 0),
            totalClips: projectData.arrangement.tracks.reduce((total, track) => total + track.clips.length, 0),
            maxNoteStartsPerBeat: Math.max(...noteStartsPerBeat.values()),
            maxNoteStartsPerQuarterBeat: Math.max(...noteStartsPerQuarterBeat.values()),
            maxActiveGeneratorTracksPerWindow: Math.max(
                ...Array.from(generatorWindows.values(), (tracks) => tracks.size)
            ),
            maxSimultaneousVoices,
            realtimeProcessorDevices: projectData.arrangement.tracks
                .flatMap((track) => track.devices)
                .filter((device) => REALTIME_PROCESSOR_TYPES.has(device.type)).length,
            trackProcessors: projectData.arrangement.tracks.length,
            topTrackNoteCounts: Array.from(noteCountsByTrack.entries())
                .sort((left, right) => right[1] - left[1])
                .slice(0, 12),
        };
        const metricEvidence = JSON.stringify(metrics);

        expect(metrics.totalClips, metricEvidence).toBeLessThanOrEqual(MAX_TOTAL_CLIPS);
        expect(metrics.maxNoteStartsPerBeat, metricEvidence).toBeLessThanOrEqual(MAX_NOTE_STARTS_PER_BEAT);
        expect(metrics.maxNoteStartsPerQuarterBeat, metricEvidence).toBeLessThanOrEqual(
            MAX_NOTE_STARTS_PER_QUARTER_BEAT
        );
        expect(metrics.maxActiveGeneratorTracksPerWindow, metricEvidence).toBeLessThanOrEqual(
            MAX_ACTIVE_GENERATOR_TRACKS_PER_WINDOW
        );
        expect(metrics.maxSimultaneousVoices, metricEvidence).toBeLessThanOrEqual(MAX_SIMULTANEOUS_VOICES);
        expect(metrics.realtimeProcessorDevices, metricEvidence).toBeLessThanOrEqual(MAX_REALTIME_PROCESSOR_DEVICES);
        expect(metrics.trackProcessors, metricEvidence).toBeLessThanOrEqual(MAX_TRACK_PROCESSORS);
    });
});
