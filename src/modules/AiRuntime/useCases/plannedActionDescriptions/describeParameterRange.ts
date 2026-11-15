import { formatDecibels } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

type ParameterRangePayload = Extract<AppAction, { type: 'automateParameterRange' }>['payload'];

function describeRangeTarget(payload: ParameterRangePayload): string {
    if (payload.valueDb !== undefined) {
        return `at ${formatDecibels(payload.valueDb, { trimTrailingZeros: true })} dB`;
    }
    if (payload.deltaDb !== undefined) {
        const sign = payload.deltaDb > 0 ? '+' : '';
        return `by ${sign}${formatDecibels(payload.deltaDb, { trimTrailingZeros: true })} dB`;
    }
    return `at ${String(payload.value)}`;
}

/** Where the range lies, in the words it was asked in and, once resolved, in beats. */
function describeRangeSpan(payload: ParameterRangePayload): string {
    const { range } = payload;
    let asked = `beats ${String(range.startBeat)}–${String(range.endBeat)}`;
    if (range.section !== undefined && range.barsBefore !== undefined) {
        asked = `the ${String(range.barsBefore)} ${range.barsBefore === 1 ? 'bar' : 'bars'} before "${range.section}"`;
    } else if (range.section !== undefined) {
        asked = `"${range.section}"`;
    } else if (range.startBar !== undefined) {
        asked = `bars ${String(range.startBar)}–${String(range.endBar)}`;
    }
    if (payload.startBeat === undefined || payload.endBeat === undefined || range.startBeat !== undefined) {
        return asked;
    }
    return `${asked} (beats ${String(payload.startBeat)}–${String(payload.endBeat)})`;
}

function describeRamps(payload: ParameterRangePayload): string {
    const rampIn = payload.rampIn ?? 0;
    const rampOut = payload.rampOut ?? 0;
    if (rampIn === 0 && rampOut === 0) {
        return 'with no ramps';
    }
    return `ramping in over ${String(rampIn)} and out over ${String(rampOut)} beats`;
}

export function describeParameterRange(
    action: Extract<AppAction, { type: 'automateParameterRange' }>,
    context: ProjectContext
): string {
    const { payload } = action;
    const track = context.tracks.find((candidate) => candidate.id === payload.trackId);
    const target = track ? `track "${track.name}" (${track.id})` : payload.trackId;
    return `Automate ${target} ${payload.parameterId} ${describeRangeTarget(payload)} across ${describeRangeSpan(payload)}, ${describeRamps(payload)}; the curve outside the range is unchanged`;
}
