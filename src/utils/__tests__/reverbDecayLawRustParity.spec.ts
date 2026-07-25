import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    DECAY_DEFAULT,
    DECAY_MAX,
    MAX_IR_STRETCH,
    MAX_RT60_SECONDS,
    MIN_IR_STRETCH,
    MIN_RT60_SECONDS,
} from '../reverbDecayLaw';

/**
 * `reverbDecayLaw.ts` and `crates/proof-chamber/src/decay_curve.rs` are two
 * independent implementations of one law. Each suite previously pinned only its
 * own hand-copied literals, so changing a constant on one side and updating that
 * side's expectations left both suites green while the panel readout and the
 * engine silently disagreed — a mutation raising the Rust ceiling from 30 s to
 * 45 s passed 17/17 Rust and 18/18 TypeScript tests.
 *
 * This reads the Rust source and asserts the shared constants match. It is
 * deliberately source-level rather than behavioural: the compiled wasm is a
 * committed artifact that can lag the crate, so comparing against it would pin
 * the wrong thing.
 */
describe('reverbDecayLaw parity with the Rust decay_curve', () => {
    // Vitest runs with the repo root as cwd (see vitest.config.ts `root`).
    const rustSource = readFileSync(resolve(process.cwd(), 'crates/proof-chamber/src/decay_curve.rs'), 'utf8');

    function rustConstant(name: string): number {
        const match = new RegExp(`pub const ${name}: f32 = ([0-9.]+);`).exec(rustSource);
        const literal = match?.[1];
        if (literal === undefined) {
            throw new Error(`${name} not found in decay_curve.rs — the Rust contract moved or was renamed`);
        }
        return Number.parseFloat(literal);
    }

    it.each([
        ['DECAY_DEFAULT', DECAY_DEFAULT],
        ['DECAY_MAX', DECAY_MAX],
        ['MIN_RT60_SECONDS', MIN_RT60_SECONDS],
        ['MAX_RT60_SECONDS', MAX_RT60_SECONDS],
        ['MIN_IR_STRETCH', MIN_IR_STRETCH],
        ['MAX_IR_STRETCH', MAX_IR_STRETCH],
    ])('%s matches the Rust constant', (name, tsValue) => {
        expect(rustConstant(name)).toBe(tsValue);
    });

    it('mirrors the exponential form, not just the endpoints', () => {
        // Both sides must be `min * (max/min)^x`. A linear or inverted Rust law
        // would keep every constant above identical while diverging in shape.
        expect(rustSource).toContain('min * (max / min).powf(normalised)');
        expect(rustSource).toContain('decay.clamp(0.0, 1.0)');
    });
});
