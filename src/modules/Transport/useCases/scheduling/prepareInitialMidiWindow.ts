import type { trackStore } from '#/modules/Arrangement/stores';
import type { midiStore } from '#/modules/MIDI/stores';

import type { TransportState } from '../../models/TransportState';
import type { tempoMapStore } from '../../stores/tempoMapStore';

import { prepareYeastTrackNotes, type PreparedYeastTrackNotes } from './prepareYeastTrackNotes';
import { resolveMidiWindowClips } from './resolveMidiWindowClips';
import type { SchedulerCancellation } from './scheduleMidiNotes';

/** Prepare only the external MIDI work. No controller, note or source is emitted here. */
export async function prepareInitialMidiWindow(
    fromBeat: number,
    toBeat: number,
    transport: TransportState,
    cancellation: SchedulerCancellation,
    programme: {
        trackState: typeof trackStore.value;
        midiState: typeof midiStore.value;
        tempoState: typeof tempoMapStore.value;
        isCurrent: () => boolean;
    }
) {
    const { trackState, midiState, tempoState, isCurrent } = programme;
    const yeastByTrack = new Map<string, PreparedYeastTrackNotes>();
    const tracks = trackState?.tracks ?? [];
    const busIds = new Set(tracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    if (midiState) {
        for (const track of tracks) {
            if (!isCurrent()) {
                return null;
            }
            if (
                track.kind !== 'midi' ||
                (track.muted && !track.sends.some((send) => send.preFader && busIds.has(send.busId))) ||
                (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) ||
                !track.devices.some((device) => device.type === 'yeast')
            ) {
                continue;
            }
            const clips = resolveMidiWindowClips(track, fromBeat, toBeat);
            if (clips.length === 0) {
                continue;
            }
            const prepared = await prepareYeastTrackNotes(
                track,
                clips,
                midiState,
                fromBeat,
                toBeat,
                tempoState?.changes ?? [],
                transport,
                { ...cancellation, isCurrent }
            );
            if (!prepared || !isCurrent()) {
                return null;
            }
            yeastByTrack.set(track.id, prepared);
        }
    }
    return isCurrent() ? { fromBeat, toBeat, yeastByTrack, isCurrent } : null;
}

export type PreparedInitialMidiWindow = NonNullable<Awaited<ReturnType<typeof prepareInitialMidiWindow>>>;
