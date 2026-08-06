import { createAppError, type AppError } from '#/infra/errors/createAppError';

export type TempoRampWriteError = AppError<'TempoRampWrite', { bpm: number; tempoChangeId: string }>;

export type CreateTempoRampWriteErrorInput = {
    bpm: number;
    /** The `linear` event the playhead's segment starts at — the one a write would have landed on. */
    tempoChangeId: string;
};

/**
 * A tempo write was refused because the playhead sits strictly inside a `linear`
 * ramp, where the tempo in force is interpolated between two events and is not
 * any event's own value.
 *
 * This is thrown rather than reported as a `no-write` status because
 * `executeAppAction` turns `no-write` into a silent transaction abort and
 * returns normally: a caller that cannot see the UI — the AI runtime — then
 * reported the action as dispatched having changed nothing. A typed error
 * reaches `executePlannedActions`, which surfaces it as a failure reason.
 */
export const createTempoRampWriteError = ({
    bpm,
    tempoChangeId,
}: CreateTempoRampWriteErrorInput): TempoRampWriteError =>
    createAppError(
        'TempoRampWrite',
        `Cannot set ${bpm} BPM here: the playhead is inside a tempo ramp, where no single tempo event carries the tempo in force. Edit the ramp's end points in the tempo map instead.`,
        { bpm, tempoChangeId }
    );
