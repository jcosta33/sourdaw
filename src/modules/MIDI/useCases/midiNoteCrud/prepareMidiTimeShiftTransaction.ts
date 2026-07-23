import {
    transformMidiGlobalTimeState,
    type MidiGlobalTimeShiftClip,
} from '../../services/transformMidiGlobalTimeState';
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

type PreparedMidiTimeShiftInput = {
    atBeat: number;
    beatDelta: number;
    clipsById: ReadonlyMap<string, MidiGlobalTimeShiftClip>;
};

type PreparedMidiState = {
    status: 'ready' | 'rejected';
    hasChanges: boolean;
    nextState: MidiStoreState | null;
};

type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function createClipIndex(owners: unknown): ReadonlyMap<string, MidiGlobalTimeShiftClip> | null {
    if (!Array.isArray(owners)) {
        return null;
    }

    const trackIds = new Set<string>();
    const clipsById = new Map<string, MidiGlobalTimeShiftClip>();
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
                clipId,
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

    return { atBeat, beatDelta, clipsById };
}

function hasCompleteOwnership(state: MidiStoreState, clipsById: ReadonlyMap<string, MidiGlobalTimeShiftClip>): boolean {
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

function rejectPreparation(): PreparedMidiState {
    return { status: 'rejected', hasChanges: false, nextState: null };
}

function prepareNextState(preparedState: MidiStoreState | null, input: unknown): PreparedMidiState {
    if (!preparedState) {
        return rejectPreparation();
    }

    const preparedInput = prepareInput(input);
    if (!preparedInput || !hasCompleteOwnership(preparedState, preparedInput.clipsById)) {
        return rejectPreparation();
    }

    const transformed = transformMidiGlobalTimeState({
        state: preparedState,
        commands: [
            {
                type: 'shift',
                atBeat: preparedInput.atBeat,
                beatDelta: preparedInput.beatDelta,
                clips: [...preparedInput.clipsById.values()],
            },
        ],
        targetNoteIds: [],
    });
    if (transformed.status === 'rejected') {
        return rejectPreparation();
    }

    return {
        status: 'ready',
        hasChanges: transformed.hasChanges,
        nextState: transformed.state,
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
