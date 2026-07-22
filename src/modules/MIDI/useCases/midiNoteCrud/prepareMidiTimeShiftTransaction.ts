import { midiStore, type MidiStoreState } from '../../stores/midiStore';

type MidiTimeShiftClipSnapshot = {
    clipId: string;
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
};

type MidiTimeShiftOwnerSnapshot = {
    trackId: string;
    eligible: boolean;
    clips: readonly MidiTimeShiftClipSnapshot[];
};

type PrepareMidiTimeShiftTransactionInput = {
    atBeat: number;
    beatDelta: number;
    owners: readonly MidiTimeShiftOwnerSnapshot[];
};

type IndexedMidiClip = {
    eligible: boolean;
    startBeat: number;
    endBeat: number;
    midiOffsetBeats: number;
};

type PreparedMidiTimeShiftInput = {
    atBeat: number;
    beatDelta: number;
    clipsById: ReadonlyMap<string, IndexedMidiClip>;
};

type TransactionStatus = 'ready' | 'rejected';

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

type PreparedEventArray<TRow> =
    | {
          status: 'rejected';
      }
    | {
          status: 'ready';
          hasChanges: boolean;
          events: TRow[];
      };

type PreparedEventMap<TRow> =
    | {
          status: 'rejected';
      }
    | {
          status: 'ready';
          hasChanges: boolean;
          eventsByClipId: Record<string, TRow[]>;
      };

type PrepareEventArrayInput<TRow> = {
    events: TRow[];
    windowStartMedia: number;
    beatDelta: number;
    readBeat: (event: TRow) => number;
    withBeat: (event: TRow, beat: number) => TRow;
};

type PrepareEventMapInput<TRow> = {
    eventsByClipId: Record<string, TRow[]>;
    clipsById: ReadonlyMap<string, IndexedMidiClip>;
    atBeat: number;
    beatDelta: number;
    readBeat: (event: TRow) => number;
    withBeat: (event: TRow, beat: number) => TRow;
};

type PreparedMidiState = {
    status: TransactionStatus;
    hasChanges: boolean;
    nextState: MidiStoreState | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function createClipIndex(owners: unknown): ReadonlyMap<string, IndexedMidiClip> | null {
    if (!Array.isArray(owners)) {
        return null;
    }

    const trackIds = new Set<string>();
    const clipsById = new Map<string, IndexedMidiClip>();

    for (const owner of owners) {
        if (!isPlainObject(owner)) {
            return null;
        }

        const trackId = owner.trackId;
        const eligible = owner.eligible;
        const clips = owner.clips;
        if (!isNonEmptyId(trackId) || trackIds.has(trackId)) {
            return null;
        }
        if (typeof eligible !== 'boolean' || !Array.isArray(clips)) {
            return null;
        }

        const ownerClipIds = new Set<string>();
        for (const clip of clips) {
            if (!isPlainObject(clip)) {
                return null;
            }

            const clipId = clip.clipId;
            const startBeat = clip.startBeat;
            const endBeat = clip.endBeat;
            const midiOffsetBeats = clip.midiOffsetBeats;
            if (!isNonEmptyId(clipId) || ownerClipIds.has(clipId) || clipsById.has(clipId)) {
                return null;
            }
            if (!isFiniteNumber(startBeat) || !isFiniteNumber(endBeat) || endBeat <= startBeat) {
                return null;
            }
            if (midiOffsetBeats !== undefined && !isFiniteNumber(midiOffsetBeats)) {
                return null;
            }

            ownerClipIds.add(clipId);
            clipsById.set(clipId, {
                eligible,
                startBeat,
                endBeat,
                midiOffsetBeats: midiOffsetBeats ?? 0,
            });
        }

        trackIds.add(trackId);
    }

    return clipsById;
}

function prepareInput(input: unknown): PreparedMidiTimeShiftInput | null {
    if (!isPlainObject(input)) {
        return null;
    }

    const atBeat = input.atBeat;
    const beatDelta = input.beatDelta;
    if (!isFiniteNumber(atBeat) || atBeat < 0 || !isFiniteNumber(beatDelta)) {
        return null;
    }

    const clipsById = createClipIndex(input.owners);
    if (!clipsById) {
        return null;
    }

    return {
        atBeat,
        beatDelta,
        clipsById,
    };
}

function hasCompleteOwnership(state: MidiStoreState, clipsById: ReadonlyMap<string, IndexedMidiClip>): boolean {
    const dataMaps = [state.notesByClipId, state.ccByClipId, state.pitchBendByClipId];
    for (const dataMap of dataMaps) {
        for (const clipId of Object.keys(dataMap)) {
            if (!clipsById.has(clipId)) {
                return false;
            }
        }
    }

    return true;
}

function prepareEventArray<TRow>({
    events,
    windowStartMedia,
    beatDelta,
    readBeat,
    withBeat,
}: PrepareEventArrayInput<TRow>): PreparedEventArray<TRow> {
    let hasChanges = false;
    const nextEvents: TRow[] = [];

    for (const event of events) {
        const currentBeat = readBeat(event);
        if (currentBeat < windowStartMedia) {
            nextEvents.push(event);
            continue;
        }

        const shiftedBeat = currentBeat + beatDelta;
        if (!Number.isFinite(shiftedBeat)) {
            return { status: 'rejected' };
        }
        if (shiftedBeat === currentBeat) {
            nextEvents.push(event);
            continue;
        }

        hasChanges = true;
        nextEvents.push(withBeat(event, shiftedBeat));
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
        events: nextEvents,
    };
}

function prepareEventMap<TRow>({
    eventsByClipId,
    clipsById,
    atBeat,
    beatDelta,
    readBeat,
    withBeat,
}: PrepareEventMapInput<TRow>): PreparedEventMap<TRow> {
    let hasChanges = false;
    let nextEventsByClipId = eventsByClipId;

    for (const [clipId, events] of Object.entries(eventsByClipId)) {
        if (events.length === 0) {
            continue;
        }

        const clip = clipsById.get(clipId);
        if (!clip || !clip.eligible) {
            continue;
        }
        if (clip.startBeat >= atBeat || clip.endBeat <= atBeat) {
            continue;
        }

        const windowStartMedia = atBeat - clip.startBeat + clip.midiOffsetBeats;
        if (!Number.isFinite(windowStartMedia)) {
            return { status: 'rejected' };
        }

        const preparedEvents = prepareEventArray({
            events,
            windowStartMedia,
            beatDelta,
            readBeat,
            withBeat,
        });
        if (preparedEvents.status === 'rejected') {
            return preparedEvents;
        }
        if (!preparedEvents.hasChanges) {
            continue;
        }

        if (!hasChanges) {
            nextEventsByClipId = { ...eventsByClipId };
        }
        hasChanges = true;
        nextEventsByClipId[clipId] = preparedEvents.events;
    }

    return {
        status: 'ready',
        hasChanges,
        eventsByClipId: nextEventsByClipId,
    };
}

function rejectPreparation(): PreparedMidiState {
    return {
        status: 'rejected',
        hasChanges: false,
        nextState: null,
    };
}

function prepareNextState(preparedState: MidiStoreState | null, input: unknown): PreparedMidiState {
    if (!preparedState) {
        return rejectPreparation();
    }

    const preparedInput = prepareInput(input);
    if (!preparedInput || !hasCompleteOwnership(preparedState, preparedInput.clipsById)) {
        return rejectPreparation();
    }

    if (preparedInput.beatDelta === 0) {
        return {
            status: 'ready',
            hasChanges: false,
            nextState: preparedState,
        };
    }

    const preparedNotes = prepareEventMap({
        eventsByClipId: preparedState.notesByClipId,
        clipsById: preparedInput.clipsById,
        atBeat: preparedInput.atBeat,
        beatDelta: preparedInput.beatDelta,
        readBeat: (midiNote) => midiNote.startBeat,
        withBeat: (midiNote, startBeat) => ({ ...midiNote, startBeat }),
    });
    if (preparedNotes.status === 'rejected') {
        return rejectPreparation();
    }

    const preparedCcs = prepareEventMap({
        eventsByClipId: preparedState.ccByClipId,
        clipsById: preparedInput.clipsById,
        atBeat: preparedInput.atBeat,
        beatDelta: preparedInput.beatDelta,
        readBeat: (midiCc) => midiCc.beat,
        withBeat: (midiCc, beat) => ({ ...midiCc, beat }),
    });
    if (preparedCcs.status === 'rejected') {
        return rejectPreparation();
    }

    const preparedPitchBends = prepareEventMap({
        eventsByClipId: preparedState.pitchBendByClipId,
        clipsById: preparedInput.clipsById,
        atBeat: preparedInput.atBeat,
        beatDelta: preparedInput.beatDelta,
        readBeat: (midiPitchBend) => midiPitchBend.beat,
        withBeat: (midiPitchBend, beat) => ({ ...midiPitchBend, beat }),
    });
    if (preparedPitchBends.status === 'rejected') {
        return rejectPreparation();
    }

    const hasChanges = preparedNotes.hasChanges || preparedCcs.hasChanges || preparedPitchBends.hasChanges;
    if (!hasChanges) {
        return {
            status: 'ready',
            hasChanges: false,
            nextState: preparedState,
        };
    }

    return {
        status: 'ready',
        hasChanges: true,
        nextState: {
            ...preparedState,
            notesByClipId: preparedNotes.eventsByClipId,
            ccByClipId: preparedCcs.eventsByClipId,
            pitchBendByClipId: preparedPitchBends.eventsByClipId,
        },
    };
}

function isPublishingPhase(phase: TransactionPhase): boolean {
    return phase === 'publishing';
}

export function prepareMidiTimeShiftTransaction(input: PrepareMidiTimeShiftTransactionInput) {
    const preparedState = midiStore.value;
    const preparedShift = prepareNextState(preparedState, input);
    let phase: TransactionPhase = 'prepared';

    function apply(): boolean {
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }
        if (preparedShift.status !== 'ready' || !preparedShift.hasChanges || !preparedShift.nextState) {
            phase = 'closed';
            return false;
        }
        if (!preparedState || midiStore.value !== preparedState) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            midiStore.set(preparedShift.nextState);
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!isPublishingPhase(phase)) {
            phase = 'closed';
            return false;
        }
        if (midiStore.value !== preparedShift.nextState) {
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
        if (!preparedState || !preparedShift.nextState || midiStore.value !== preparedShift.nextState) {
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
        status: preparedShift.status,
        hasChanges: preparedShift.hasChanges,
        apply,
        revert,
    };
}
