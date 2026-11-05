import { type MidiNote, type MidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { projectMidiClipPlayback } from '#/modules/MIDI/useCases';

import { type Clip } from '../models/Track';

/**
 * The rows of a loop-4 phrase whose loop region is `[0, 4)` in media beats:
 * notes on distinct pitches, one crossing beat 2, one rolled at 50 %, one past
 * the region that a pass never plays. Each call returns fresh rows, so a spec
 * can hand them to a store that edits them.
 */
export function loopPhaseNotes(): MidiNote[] {
    return [
        { id: 'n-a', pitch: 60, startBeat: 0.5, duration: 0.5, velocity: 80 },
        { id: 'n-b', pitch: 62, startBeat: 1.5, duration: 1, velocity: 80 },
        { id: 'n-p', pitch: 66, startBeat: 2.5, duration: 0.25, velocity: 80, probability: 50 },
        { id: 'n-c', pitch: 64, startBeat: 3, duration: 0.5, velocity: 80 },
        { id: 'n-out', pitch: 70, startBeat: 5, duration: 0.5, velocity: 80 },
    ];
}

/** The phrase's sustain press and lift, fresh on each call. */
export function loopPhaseControllers(): MidiStoreState['ccByClipId'][string] {
    return [
        { id: 'cc-down', controller: 64, value: 127, beat: 1, channel: 0 },
        { id: 'cc-up', controller: 64, value: 0, beat: 3.5, channel: 0 },
    ];
}

/** Every fixture places its rows on this grid, so sampling it sees every onset. */
const GRID_BEATS = 0.125;
const SAME_BEAT = 1e-9;

export type MidiScoreBeat = {
    beat: number;
    /** `pitch/probability` of every note struck on the beat; a continued note is not struck. */
    struck: string[];
    /** Every pitch sounding across the beat. */
    sounding: number[];
    /** `channel:controller=value` the track's instrument holds on the beat. */
    controllers: string[];
};

type Segment = { pitch: number; probability: number; startBeat: number; endBeat: number; continued: boolean };

function projectClip(clip: Clip) {
    const state = midiStore.value;
    const played = projectMidiClipPlayback({
        notes: state?.notesByClipId[clip.id] ?? [],
        controlChanges: state?.ccByClipId[clip.id] ?? [],
        clip,
    });
    const segments: Segment[] = played.notes.map((note) => ({
        pitch: note.pitch,
        probability: note.probability ?? 100,
        startBeat: note.startBeat,
        endBeat: note.startBeat + note.duration,
        continued: 'beatsIntoNote' in note && typeof note.beatsIntoNote === 'number' && note.beatsIntoNote > 0,
    }));
    return { clip, segments, controlChanges: played.controlChanges };
}

/**
 * The controller values the track's instrument holds on a beat. A value a clip
 * sends stays in force across later clips on the track until another row moves
 * it, so the rows of every clip count, in beat order; on a shared beat the
 * later clip's row has the last word, as `projectClipControllerEvents` orders
 * a clip's closing moves before those of the clip that starts there.
 */
function controllersInForce(projected: readonly ReturnType<typeof projectClip>[], beat: number): string[] {
    const rows = projected
        .flatMap((entry) => entry.controlChanges.map((row) => ({ row, clipStartBeat: entry.clip.startBeat })))
        .filter(({ row }) => row.beat <= beat + SAME_BEAT)
        .toSorted((first, second) => first.row.beat - second.row.beat || first.clipStartBeat - second.clipStartBeat);
    const inForce = new Map<string, number>();
    for (const { row } of rows) {
        inForce.set(`${row.channel ?? 0}:${row.controller}`, row.value);
    }
    return Array.from(inForce, ([key, value]) => `${key}=${value}`).toSorted();
}

/**
 * What a run of MIDI clips plays on every grid beat of `[fromBeat, toBeat)`,
 * read through the projection the note and stored-controller schedulers share
 * (`projectMidiClipPlayback`: every loop pass, the anchored loop window, the
 * pass clipping and the controller carries). Two runs with equal scores play
 * the same notes, struck on the same beats, under the same controller values.
 */
export function scoreMidiClips(clips: readonly Clip[], fromBeat: number, toBeat: number): MidiScoreBeat[] {
    const projected = clips.map(projectClip);
    const score: MidiScoreBeat[] = [];
    for (let step = 0; fromBeat + step * GRID_BEATS < toBeat - SAME_BEAT; step++) {
        const beat = fromBeat + step * GRID_BEATS;
        const segments = projected.flatMap((entry) => entry.segments);
        score.push({
            beat,
            struck: segments
                .filter((segment) => !segment.continued && Math.abs(segment.startBeat - beat) <= SAME_BEAT)
                .map((segment) => `${segment.pitch}/${segment.probability}`)
                .toSorted(),
            sounding: segments
                .filter((segment) => segment.startBeat - SAME_BEAT <= beat && beat < segment.endBeat - SAME_BEAT)
                .map((segment) => segment.pitch)
                .toSorted((first, second) => first - second),
            controllers: controllersInForce(projected, beat),
        });
    }
    return score;
}

/** A score read at `shiftBeats` later: what a span plays after an edit moved it by that much. */
export function shiftScore(score: readonly MidiScoreBeat[], shiftBeats: number): MidiScoreBeat[] {
    return score.map((beat) => ({ ...beat, beat: beat.beat + shiftBeats }));
}
