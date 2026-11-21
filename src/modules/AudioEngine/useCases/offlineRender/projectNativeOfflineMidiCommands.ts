import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphScheduleMidiCommand } from '../../models/AudioGraphBackend';
import { projectLiveMidiProgramme, type LiveMidiProgrammeInput } from '../livePlayback/projectLiveMidiProgramme';

import { type NativeOfflineHostedRuntime } from './nativeOfflineHostedDevice';

/** What the notes are projected from: the render's captured musical projections, not live stores. */
export type NativeOfflineMidiSource = Omit<
    LiveMidiProgrammeInput,
    'stripTracks' | 'attachedInstanceIds' | 'bakedStripIds' | 'carriedStripIds' | 'span'
>;

/**
 * The `schedule-midi` a hosted-instrument track owes the native export (#6777).
 *
 * One producer with live (`projectLiveMidiProgramme`), so comping, loop
 * expansion, groove, chord transposition, overlap trim and the chance roll are
 * the numbers the browser and the Web Audio export already use; this adds only
 * the export's own span (the whole render, from its frame 0) and the strip's
 * latency compensation, which the Web Audio note path and the native audio
 * clips both add and which moves every event of one strip by the same figure.
 *
 * The track must already be admitted by `nativeOfflineInstrumentSink`: it
 * names the one device the notes address, so the producer's sink law and the
 * selection's cannot disagree.
 */
export function projectNativeOfflineMidiCommands(input: {
    track: Track;
    hostedRuntime: NativeOfflineHostedRuntime;
    source: NativeOfflineMidiSource;
    durationSeconds: number;
    compensationDelaySeconds: number;
}): readonly AudioGraphScheduleMidiCommand[] {
    const { track, hostedRuntime, source, durationSeconds, compensationDelaySeconds } = input;
    const programme = projectLiveMidiProgramme({
        ...source,
        stripTracks: [track],
        attachedInstanceIds: hostedRuntime.loadedInstanceIds,
        bakedStripIds: new Set(),
        carriedStripIds: new Set([track.id]),
        span: { startSeconds: 0, endSeconds: durationSeconds },
    });
    return programme.targets.map(({ target, events }): AudioGraphScheduleMidiCommand => ({
        kind: 'schedule-midi',
        target,
        probabilitySeed: source.probabilitySeed,
        notes: events.map((event) => ({ ...event, time: event.time + compensationDelaySeconds })),
    }));
}
