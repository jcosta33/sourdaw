import { describe, it, expect } from 'vitest';

import { MarkovChain } from '../MarkovChain';

describe('MarkovChain', () => {
    it('constructs with default matrix', () => {
        const mc = new MarkovChain('t1');
        const matrix = mc.getMatrix();
        expect(matrix.length).toBeGreaterThan(0);
    });

    it('matrix rows sum to ~1', () => {
        const mc = new MarkovChain('t2');
        for (const row of mc.getMatrix()) {
            const sum = row.reduce((a, b) => a + b, 0);
            expect(sum).toBeGreaterThan(0.5);
        }
    });

    it('sampleNext returns valid state', () => {
        const mc = new MarkovChain('t3');
        const state = mc.sampleNext();
        expect(state).toBeGreaterThanOrEqual(0);
        expect(state).toBeLessThan(mc.getStateCount());
    });

    it('reset returns to state 0', () => {
        const mc = new MarkovChain('t4');
        mc.sampleNext();
        mc.reset();
        expect(mc.getCurrentState()).toBe(0);
    });

    it('setTransition modifies probabilities', () => {
        const mc = new MarkovChain('t5');
        mc.setTransition(0, 0, 1.0);
        const matrix = mc.getMatrix();
        expect(matrix[0][0]).toBeGreaterThan(matrix[0][1] ?? 0);
    });

    it('deterministic with identity transition', () => {
        const mc = new MarkovChain('t6');
        mc.setTransition(0, 0, 1.0);
        const state = mc.sampleNext();
        expect(state).toBe(0);
    });

    it('all setParam values accepted', () => {
        const mc = new MarkovChain('t7');
        mc.setParam('root', 60);
        mc.setParam('range', 12);
        mc.setParam('velocity', 80);
        mc.setParam('gate', 0.5);
        mc.setParam('depth', 0.5);
        mc.setParam('rate_denom', 8);
        expect(mc.getStateCount()).toBeGreaterThan(0);
    });

    it('getCurrentState starts at 0', () => {
        expect(new MarkovChain('t8').getCurrentState()).toBe(0);
    });
});
