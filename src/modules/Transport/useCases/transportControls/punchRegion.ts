import { type TransportState } from '../../models/TransportState';

const MAX_FINITE_PUNCH_BEAT = Number.MAX_VALUE;
const MIN_POSITIVE_PUNCH_BEAT = Number.MIN_VALUE;
const FLOATING_POINT_EPSILON = Number.EPSILON;

type PunchRegion = Pick<TransportState, 'punchInBeat' | 'punchOutBeat'>;
type PunchRegionPatch = Partial<PunchRegion>;

type CreatePunchRegionPatchInput = {
    current: PunchRegion;
    beat: number;
    edge: 'in' | 'out';
};

function normalizePunchBeat(beat: number): number | null {
    if (!Number.isFinite(beat)) {
        return null;
    }

    return Math.max(0, beat);
}

function getNextFinitePunchBeat(beat: number): number | null {
    const oneBeatLater = beat + 1;
    if (Number.isFinite(oneBeatLater) && oneBeatLater > beat) {
        return oneBeatLater;
    }

    const step = Math.max(MIN_POSITIVE_PUNCH_BEAT, Math.abs(beat) * FLOATING_POINT_EPSILON);
    const nextBeat = beat + step;
    return Number.isFinite(nextBeat) && nextBeat > beat ? nextBeat : null;
}

function getPreviousFinitePunchBeat(beat: number): number {
    const oneBeatEarlier = Math.max(0, beat - 1);
    if (oneBeatEarlier < beat) {
        return oneBeatEarlier;
    }

    const step = Math.max(MIN_POSITIVE_PUNCH_BEAT, Math.abs(beat) * FLOATING_POINT_EPSILON);
    const previousBeat = beat - step;
    return previousBeat >= 0 && previousBeat < beat ? previousBeat : 0;
}

function createPunchInPatch(input: { beat: number; current: PunchRegion }): PunchRegionPatch {
    if (input.beat < input.current.punchOutBeat) {
        return { punchInBeat: input.beat };
    }

    // At IEEE-754 limits, adding or subtracting one can overflow or round back to the same value.
    const nextPunchOutBeat = getNextFinitePunchBeat(input.beat);
    if (nextPunchOutBeat !== null) {
        return { punchInBeat: input.beat, punchOutBeat: nextPunchOutBeat };
    }

    if (input.beat < MAX_FINITE_PUNCH_BEAT) {
        return { punchInBeat: input.beat, punchOutBeat: MAX_FINITE_PUNCH_BEAT };
    }

    return {
        punchInBeat: getPreviousFinitePunchBeat(input.beat),
        punchOutBeat: MAX_FINITE_PUNCH_BEAT,
    };
}

function createPunchOutPatch(input: { beat: number; current: PunchRegion }): PunchRegionPatch {
    if (input.beat > input.current.punchInBeat) {
        return { punchOutBeat: input.beat };
    }

    if (input.beat === 0) {
        return { punchOutBeat: MIN_POSITIVE_PUNCH_BEAT, punchInBeat: 0 };
    }

    return {
        punchOutBeat: input.beat,
        punchInBeat: getPreviousFinitePunchBeat(input.beat),
    };
}

export function createPunchRegionPatch(input: CreatePunchRegionPatchInput): PunchRegionPatch | null {
    const beat = normalizePunchBeat(input.beat);
    if (beat === null) {
        return null;
    }

    if (input.edge === 'in') {
        return createPunchInPatch({ beat, current: input.current });
    }

    return createPunchOutPatch({ beat, current: input.current });
}
