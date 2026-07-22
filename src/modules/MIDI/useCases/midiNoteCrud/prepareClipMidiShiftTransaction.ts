import { midiStore, type MidiStoreState } from '../../stores/midiStore';

type PrepareClipMidiShiftTransactionInput = {
    clipId: string;
    beatDelta: number;
};

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

type TransactionStatus = 'ready' | 'rejected';

type ShiftEventsInput<TRow> = {
    events: TRow[] | undefined;
    beatDelta: number;
    readBeat: (event: TRow) => number;
    withBeat: (event: TRow, beat: number) => TRow;
};

type ShiftedEvents<TRow> =
    | {
          status: 'rejected';
          hasChanges: false;
      }
    | {
          status: 'ready';
          hasChanges: false;
          events: TRow[] | undefined;
      }
    | {
          status: 'ready';
          hasChanges: true;
          events: TRow[];
      };

type ShiftedMidiState = {
    status: TransactionStatus;
    hasChanges: boolean;
    nextState: MidiStoreState | null;
};

function isPublishingPhase(phase: TransactionPhase): boolean {
    return phase === 'publishing';
}

function shiftEvents<TRow>({ events, beatDelta, readBeat, withBeat }: ShiftEventsInput<TRow>): ShiftedEvents<TRow> {
    if (!events || events.length === 0) {
        return {
            status: 'ready',
            hasChanges: false,
            events,
        };
    }

    const shiftedEvents: TRow[] = [];
    let hasChanges = false;

    for (const event of events) {
        const currentBeat = readBeat(event);
        const shiftedBeat = currentBeat + beatDelta;
        if (!Number.isFinite(shiftedBeat)) {
            return {
                status: 'rejected',
                hasChanges: false,
            };
        }
        if (shiftedBeat === currentBeat) {
            shiftedEvents.push(event);
            continue;
        }

        hasChanges = true;
        shiftedEvents.push(withBeat(event, shiftedBeat));
    }

    if (!hasChanges) {
        return {
            status: 'ready',
            hasChanges: false,
            events,
        };
    }

    return {
        status: 'ready',
        hasChanges: true,
        events: shiftedEvents,
    };
}

function prepareShiftedState(
    preparedState: MidiStoreState | null,
    clipId: string,
    beatDelta: number
): ShiftedMidiState {
    if (!preparedState || clipId.length === 0 || !Number.isFinite(beatDelta)) {
        return {
            status: 'rejected',
            hasChanges: false,
            nextState: null,
        };
    }

    const shiftedNotes = shiftEvents({
        events: preparedState.notesByClipId[clipId],
        beatDelta,
        readBeat: (midiNote) => midiNote.startBeat,
        withBeat: (midiNote, startBeat) => ({ ...midiNote, startBeat }),
    });
    if (shiftedNotes.status === 'rejected') {
        return {
            status: 'rejected',
            hasChanges: false,
            nextState: null,
        };
    }

    const shiftedCcs = shiftEvents({
        events: preparedState.ccByClipId[clipId],
        beatDelta,
        readBeat: (midiCc) => midiCc.beat,
        withBeat: (midiCc, beat) => ({ ...midiCc, beat }),
    });
    if (shiftedCcs.status === 'rejected') {
        return {
            status: 'rejected',
            hasChanges: false,
            nextState: null,
        };
    }

    const shiftedPitchBends = shiftEvents({
        events: preparedState.pitchBendByClipId[clipId],
        beatDelta,
        readBeat: (midiPitchBend) => midiPitchBend.beat,
        withBeat: (midiPitchBend, beat) => ({ ...midiPitchBend, beat }),
    });
    if (shiftedPitchBends.status === 'rejected') {
        return {
            status: 'rejected',
            hasChanges: false,
            nextState: null,
        };
    }

    const hasChanges = shiftedNotes.hasChanges || shiftedCcs.hasChanges || shiftedPitchBends.hasChanges;
    if (!hasChanges) {
        return {
            status: 'ready',
            hasChanges: false,
            nextState: preparedState,
        };
    }

    let notesByClipId = preparedState.notesByClipId;
    if (shiftedNotes.hasChanges) {
        notesByClipId = {
            ...preparedState.notesByClipId,
            [clipId]: shiftedNotes.events,
        };
    }

    let ccByClipId = preparedState.ccByClipId;
    if (shiftedCcs.hasChanges) {
        ccByClipId = {
            ...preparedState.ccByClipId,
            [clipId]: shiftedCcs.events,
        };
    }

    let pitchBendByClipId = preparedState.pitchBendByClipId;
    if (shiftedPitchBends.hasChanges) {
        pitchBendByClipId = {
            ...preparedState.pitchBendByClipId,
            [clipId]: shiftedPitchBends.events,
        };
    }

    return {
        status: 'ready',
        hasChanges: true,
        nextState: {
            ...preparedState,
            notesByClipId,
            ccByClipId,
            pitchBendByClipId,
        },
    };
}

export function prepareClipMidiShiftTransaction({ clipId, beatDelta }: PrepareClipMidiShiftTransactionInput) {
    const preparedState = midiStore.value;
    const shiftedState = prepareShiftedState(preparedState, clipId, beatDelta);
    let phase: TransactionPhase = 'prepared';

    function apply(): boolean {
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }
        if (shiftedState.status !== 'ready' || !shiftedState.hasChanges || !shiftedState.nextState || !preparedState) {
            phase = 'closed';
            return false;
        }
        if (midiStore.value !== preparedState) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            midiStore.set(shiftedState.nextState);
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!isPublishingPhase(phase)) {
            phase = 'closed';
            return false;
        }
        if (midiStore.value !== shiftedState.nextState) {
            phase = 'closed';
            return false;
        }

        phase = 'applied';
        return true;
    }

    function revert(): boolean {
        if (phase !== 'applied') {
            phase = 'closed';
            return false;
        }
        if (!preparedState || !shiftedState.nextState || midiStore.value !== shiftedState.nextState) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            midiStore.set(preparedState);
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!isPublishingPhase(phase)) {
            phase = 'closed';
            return false;
        }

        phase = 'closed';
        return midiStore.value === preparedState;
    }

    return {
        status: shiftedState.status,
        hasChanges: shiftedState.hasChanges,
        apply,
        revert,
    };
}
