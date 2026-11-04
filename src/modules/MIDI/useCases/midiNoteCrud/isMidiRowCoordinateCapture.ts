import { planMidiRowCoordinateShift } from './planMidiRowCoordinateShift';

type CoordinateCapture = Extract<ReturnType<typeof planMidiRowCoordinateShift>, { status: 'planned' }>['capture'];

/** Validates serialized replay data independently of today's clip and row membership. */
export function isMidiRowCoordinateCapture(value: unknown): value is CoordinateCapture {
    if (value === null || typeof value !== 'object' || !('beatDelta' in value) || typeof value.beatDelta !== 'number') {
        return false;
    }
    return (
        planMidiRowCoordinateShift({
            notes: [],
            controllers: [],
            pitchBends: [],
            beatDelta: -value.beatDelta,
            restore: value,
        }).status === 'planned'
    );
}
