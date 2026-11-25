import { isRecord } from '#/utils/structuralEquality';
import { MAX_TRANSPORT_BARS, MIN_TRANSPORT_BARS } from '#/utils/transportBarsLimits';

type TransportBarsActionType = 'setCountInBars' | 'setPreRollBars';

function isWholeBarsInRange(bars: unknown): boolean {
    return (
        typeof bars === 'number' && Number.isInteger(bars) && bars >= MIN_TRANSPORT_BARS && bars <= MAX_TRANSPORT_BARS
    );
}

function isTransportBarsAction(action: unknown, actionType: TransportBarsActionType): boolean {
    if (!isRecord(action) || action.type !== actionType || !isRecord(action.payload)) {
        return false;
    }
    const { bars, expectedBars } = action.payload;
    return isWholeBarsInRange(bars) && (expectedBars === undefined || isWholeBarsInRange(expectedBars));
}

/**
 * A saved count-in or pre-roll entry replays only when its forward, inverse and redo are each that
 * same action with whole bars, and a whole expected bar count when it carries one, inside the range the setting accepts.
 */
export function validateTransportBarsSessionEntry(
    actionType: TransportBarsActionType,
    entry: { readonly action?: unknown; readonly inverseAction?: unknown; readonly redoAction?: unknown }
): boolean {
    return [entry.action, entry.inverseAction, entry.redoAction].every((action) =>
        isTransportBarsAction(action, actionType)
    );
}
