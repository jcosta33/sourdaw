import { type TransportState } from '../../models/TransportState';

const MAX_FINITE_PUNCH_BEAT = Number.MAX_VALUE;
const MIN_POSITIVE_PUNCH_BEAT = Number.MIN_VALUE;
const FLOATING_POINT_EPSILON = Number.EPSILON;

type PunchRegion = Pick<TransportState, 'punchInBeat' | 'punchOutBeat'>;

type CreatePunchRegionPatchInput = {
    current: PunchRegion;
    beat: number;
    edge: 'in' | 'out';
};

function normalize_punch_beat(beat: number): number {
    if (!Number.isFinite(beat)) {
        return beat === Number.POSITIVE_INFINITY ? MAX_FINITE_PUNCH_BEAT : 0;
    }

    return Math.max(0, beat);
}

function get_next_finite_punch_beat(beat: number): number | null {
    const one_beat_later = beat + 1;
    if (Number.isFinite(one_beat_later) && one_beat_later > beat) {
        return one_beat_later;
    }

    const step = Math.max(MIN_POSITIVE_PUNCH_BEAT, Math.abs(beat) * FLOATING_POINT_EPSILON);
    const next_beat = beat + step;
    return Number.isFinite(next_beat) && next_beat > beat ? next_beat : null;
}

function get_previous_finite_punch_beat(beat: number): number {
    const one_beat_earlier = Math.max(0, beat - 1);
    if (one_beat_earlier < beat) {
        return one_beat_earlier;
    }

    const step = Math.max(MIN_POSITIVE_PUNCH_BEAT, Math.abs(beat) * FLOATING_POINT_EPSILON);
    const previous_beat = beat - step;
    return previous_beat >= 0 && previous_beat < beat ? previous_beat : 0;
}

function create_punch_in_patch(input: { beat: number; current: PunchRegion }): Partial<PunchRegion> {
    if (input.beat < input.current.punchOutBeat) {
        return { punchInBeat: input.beat };
    }

    // At IEEE-754 limits, adding or subtracting one can overflow or round back to the same value.
    const next_punch_out_beat = get_next_finite_punch_beat(input.beat);
    if (next_punch_out_beat !== null) {
        return { punchInBeat: input.beat, punchOutBeat: next_punch_out_beat };
    }

    if (input.beat < MAX_FINITE_PUNCH_BEAT) {
        return { punchInBeat: input.beat, punchOutBeat: MAX_FINITE_PUNCH_BEAT };
    }

    return {
        punchInBeat: get_previous_finite_punch_beat(input.beat),
        punchOutBeat: MAX_FINITE_PUNCH_BEAT,
    };
}

function create_punch_out_patch(input: { beat: number; current: PunchRegion }): Partial<PunchRegion> {
    if (input.beat > input.current.punchInBeat) {
        return { punchOutBeat: input.beat };
    }

    if (input.beat === 0) {
        return { punchOutBeat: MIN_POSITIVE_PUNCH_BEAT, punchInBeat: 0 };
    }

    return {
        punchOutBeat: input.beat,
        punchInBeat: get_previous_finite_punch_beat(input.beat),
    };
}

export function create_punch_region_patch(input: CreatePunchRegionPatchInput): Partial<PunchRegion> {
    const beat = normalize_punch_beat(input.beat);

    if (input.edge === 'in') {
        return create_punch_in_patch({ beat, current: input.current });
    }

    return create_punch_out_patch({ beat, current: input.current });
}
