import { isRecord } from '#/utils/structuralEquality';

const MIN_BARS = 1;
const MAX_BARS = 8;

type TransportBarsActionType = 'setCountInBars' | 'setPreRollBars';

function isTransportBarsAction(action: unknown, actionType: TransportBarsActionType): boolean {
    if (!isRecord(action) || action.type !== actionType || !isRecord(action.payload)) {
        return false;
    }
    const { bars } = action.payload;
    return typeof bars === 'number' && Number.isInteger(bars) && bars >= MIN_BARS && bars <= MAX_BARS;
}

/**
 * A saved count-in or pre-roll entry replays only when its forward, inverse and redo are each that
 * same action with whole bars inside the range the setting accepts.
 */
export function validateTransportBarsSessionEntry(
    actionType: TransportBarsActionType,
    entry: { readonly action?: unknown; readonly inverseAction?: unknown; readonly redoAction?: unknown }
): boolean {
    return [entry.action, entry.inverseAction, entry.redoAction].every((action) =>
        isTransportBarsAction(action, actionType)
    );
}
