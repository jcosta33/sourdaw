import { type ProofPatch } from '../models/ProofPatch';

import { isValidProofChainOrder } from './isValidProofChainOrder';

const CHAIN_ORDER_SLOTS = 5;

/**
 * Read a Proof module order back out of persisted `parameterValues`.
 *
 * `chain_order_0..4` is the only place a project records the order, and it is a
 * persistence encoding, not an engine parameter: the worklet's `set_param`
 * matches no `chain_order_` prefix and drops the value on the floor. Every
 * consumer therefore has to decode it here and deliver the result through the
 * engine's `reorder` surface — the live bridge and the offline render both do,
 * against this one decoder, so the two cannot drift into disagreeing about what
 * a saved project means.
 *
 * Returns `null` when the keys are absent, non-integer, out of range, or not a
 * permutation of the five module ids. A caller cannot repair that, and the
 * engine already constructs itself in the default order, so `null` means "the
 * project has nothing to say about order", not "use the default".
 */
export function getRestoredProofChainOrder(parameterValues: Record<string, number>): ProofPatch['chainOrder'] | null {
    const order: number[] = [];
    for (let index = 0; index < CHAIN_ORDER_SLOTS; index++) {
        const value = parameterValues[`chain_order_${index}`];
        if (value === undefined) {
            return null;
        }
        order.push(value);
    }

    if (!isValidProofChainOrder(order)) {
        return null;
    }

    // `isValidProofChainOrder` has already established the length and that every
    // slot is a module id; destructuring is only how the tuple type is recovered.
    const [first, second, third, fourth, fifth] = order;
    if (
        first === undefined ||
        second === undefined ||
        third === undefined ||
        fourth === undefined ||
        fifth === undefined
    ) {
        return null;
    }

    return [first, second, third, fourth, fifth];
}
