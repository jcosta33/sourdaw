import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEVAIN_CONTROLLER_DEFAULTS } from '../levainControllerDefaults';

const EXPRESSION_SOURCE = join(process.cwd(), 'crates/daw-dsp/src/levain/expression.rs');

/** The literal the engine's `ExpressionState::new` initialises one field to. */
function engineDefault(field: string): number {
    const source = readFileSync(EXPRESSION_SOURCE, 'utf8');
    const constructor = /pub fn new\(sample_rate: f32, config: &ExpressionConfig\) -> Self \{[\s\S]*?\n {4}\}/.exec(
        source
    );
    const literal = new RegExp(`\\b${field}: (\\d+),`).exec(constructor?.[0] ?? '');
    if (!literal) {
        throw new Error(`ExpressionState::new sets no ${field} literal`);
    }
    return Number(literal[1]);
}

describe('LEVAIN_CONTROLLER_DEFAULTS', () => {
    it.each([
        ['cc1', 1],
        ['cc2', 2],
        ['cc7', 7],
        ['cc11', 11],
    ])('mirrors the engine default of %s', (field, controller) => {
        expect(LEVAIN_CONTROLLER_DEFAULTS.get(controller)).toBe(engineDefault(field));
    });

    it('holds only the expression controllers the engine initialises', () => {
        expect([...LEVAIN_CONTROLLER_DEFAULTS.keys()].sort((a, b) => a - b)).toEqual([1, 2, 7, 11]);
    });
});
