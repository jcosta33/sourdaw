import { RUNTIME_ACTION_TYPES, type RuntimeActionType } from '../models/RuntimeAction';

/**
 * The AI runtime's action vocabulary: every AppAction type a planned runtime action may name. The
 * agent command ledger accounts for each of these, so its census reads this list rather than a copy.
 */
export function getRuntimeActionTypes(): readonly RuntimeActionType[] {
    return RUNTIME_ACTION_TYPES;
}
