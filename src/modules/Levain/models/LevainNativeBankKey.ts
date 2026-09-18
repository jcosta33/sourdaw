import { isInstrumentId, type InstrumentId } from './LevainPatch';

/** The prefix that makes a bank key self-describing, and routable by owner. */
const LEVAIN_BANK_KEY_PREFIX = 'levain:';

/**
 * The key one Levain instrument's bank is staged and built under (#3124).
 *
 * Keyed by instrument rather than by device on purpose: the native store holds
 * one copy of the material and `build_instance` caches its per-rate conversions
 * (`crates/sourdaw-native/src/commands/levain.rs`), so two strips carrying the
 * same instrument share one bank instead of paying for it twice. The prefix is
 * what lets the composition root route an `acquire` to the module that owns the
 * key without a second table of who owns what.
 */
export function levainNativeBankKey(instrumentId: InstrumentId): string {
    return `${LEVAIN_BANK_KEY_PREFIX}${instrumentId}`;
}

/**
 * The instrument a bank key names, or `null` for a key this module does not
 * own or whose instrument this build does not know.
 *
 * Validated rather than trusted: the key travels through the composition root
 * and back, and an unknown id would otherwise surface as a 404 on
 * `/samples/levain/<id>/manifest.json` several async hops later.
 */
export function levainInstrumentIdFromNativeBankKey(bankKey: string): InstrumentId | null {
    if (!bankKey.startsWith(LEVAIN_BANK_KEY_PREFIX)) {
        return null;
    }
    const instrumentId = bankKey.slice(LEVAIN_BANK_KEY_PREFIX.length);
    return isInstrumentId(instrumentId) ? instrumentId : null;
}
