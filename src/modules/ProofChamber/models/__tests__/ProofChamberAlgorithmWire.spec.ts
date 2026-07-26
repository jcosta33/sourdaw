import { describe, expect, it } from 'vitest';

import { ALGORITHM_MAP } from '../ProofChamberState';

/**
 * Pins the numbers this module writes into `algorithm`.
 *
 * `algorithm` is persisted: the value goes into the project file and is
 * replayed verbatim on load, so these are a wire format rather than an
 * implementation detail. Nothing downstream range-checks them — the write path
 * guards only `Number.isFinite`, and the descriptor's `maxValue` is enforced by
 * no code at all — so the engine dispatch in `crates/proof-chamber/src/lib.rs`
 * is the only thing that decides what each number means. These assertions fail
 * if this side of that agreement moves.
 *
 * 4 and 5 are missing on purpose. They belong to the two convolution-backed
 * engines, which need an impulse response that nothing in the app can supply,
 * so the engine dispatch routes them to Plate. Reverse keeps 6 rather than
 * being renumbered down into the gap, because renumbering would repoint any
 * value already stored.
 */
const RESERVED_FOR_CONVOLUTION_BACKED_ENGINES = [4, 5];

describe('ProofChamber algorithm wire values', () => {
    it('pins every selectable algorithm to the number the engine dispatch expects', () => {
        expect(ALGORITHM_MAP).toEqual({
            plate: 0,
            'fdn-8': 1,
            'fdn-16': 2,
            spring: 3,
            reverse: 6,
        });
    });

    it('offers no algorithm that would select an engine with no impulse response', () => {
        const selectable = Object.values(ALGORITHM_MAP);
        for (const reserved of RESERVED_FOR_CONVOLUTION_BACKED_ENGINES) {
            expect(selectable).not.toContain(reserved);
        }
    });
});
