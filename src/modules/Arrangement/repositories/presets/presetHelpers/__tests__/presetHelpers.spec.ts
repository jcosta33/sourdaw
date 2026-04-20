import { describe, it, expect } from 'vitest';

import { autopan } from '../autopan';
import { bitcrusher } from '../bitcrusher';
import { chorus } from '../chorus';
import { comp } from '../comp';
import { eq } from '../eq';
import { filter } from '../filter';
import { flanger } from '../flanger';
import { limiter } from '../limiter';
import { phaser } from '../phaser';
import { reverb } from '../reverb';
import { synth } from '../synth';
import { tremolo } from '../tremolo';

describe('presetHelpers', () => {
    it('synth should create a synth preset', () => {
        const p = synth('My Synth', { freq: 440 });
        expect(p).toEqual({ type: 'builtin-synth', name: 'My Synth', parameterValues: { freq: 440 } });
    });

    it('autopan should create an autopan preset with overrides', () => {
        const p = autopan('Slow Pan', { 'autopan-rate': 0.5 });
        expect(p.type).toBe('builtin-autopan');
        expect(p.parameterValues['autopan-rate']).toBe(0.5);
        expect(p.parameterValues['autopan-depth']).toBe(0.7); // default
    });

    it('bitcrusher should create a bitcrusher preset with overrides', () => {
        const p = bitcrusher('Lofi', { 'crush-bits': 4 });
        expect(p.type).toBe('builtin-bitcrusher');
        expect(p.parameterValues['crush-bits']).toBe(4);
        expect(p.parameterValues['crush-mix']).toBe(0.5); // default
    });

    it('chorus should create a chorus preset with overrides', () => {
        const p = chorus('Wide', { 'chorus-depth': 10 });
        expect(p.type).toBe('builtin-chorus');
        expect(p.parameterValues['chorus-depth']).toBe(10);
        expect(p.parameterValues['chorus-mix']).toBe(0.5); // default
    });

    it('comp should create a compressor preset with overrides', () => {
        const p = comp('Punchy', { 'comp-ratio': 8 });
        expect(p.type).toBe('builtin-compressor');
        expect(p.parameterValues['comp-ratio']).toBe(8);
        expect(p.parameterValues['comp-threshold']).toBe(-20); // default
    });

    it('eq should create an eq preset with overrides', () => {
        const p = eq('Bright', { 'eq-high-gain': 6 });
        expect(p.type).toBe('builtin-eq');
        expect(p.parameterValues['eq-high-gain']).toBe(6);
        expect(p.parameterValues['eq-low-freq']).toBe(100); // default
    });

    it('filter should create a filter preset with overrides', () => {
        const p = filter('Sweep', { 'filter-cutoff': 500 });
        expect(p.type).toBe('builtin-filter');
        expect(p.parameterValues['filter-cutoff']).toBe(500);
        expect(p.parameterValues['filter-resonance']).toBe(1); // default
    });

    it('flanger should create a flanger preset with overrides', () => {
        const p = flanger('Jet', { 'flanger-feedback': 0.9 });
        expect(p.type).toBe('builtin-flanger');
        expect(p.parameterValues['flanger-feedback']).toBe(0.9);
        expect(p.parameterValues['flanger-mix']).toBe(0.5); // default
    });

    it('limiter should create a limiter preset with overrides', () => {
        const p = limiter('Ceiling', { 'lim-threshold': -0.5 });
        expect(p.type).toBe('builtin-limiter');
        expect(p.parameterValues['lim-threshold']).toBe(-0.5);
        expect(p.parameterValues['lim-release']).toBe(0.1); // default
    });

    it('phaser should create a phaser preset with overrides', () => {
        const p = phaser('Space', { 'phaser-stages': 8 });
        expect(p.type).toBe('builtin-phaser');
        expect(p.parameterValues['phaser-stages']).toBe(8);
        expect(p.parameterValues['phaser-rate']).toBe(0.5); // default
    });

    it('reverb should create a reverb preset with overrides', () => {
        const p = reverb('Hall', { 'rev-decay': 5 });
        expect(p.type).toBe('builtin-reverb');
        expect(p.parameterValues['rev-decay']).toBe(5);
        expect(p.parameterValues['rev-mix']).toBe(0.3); // default
    });

    it('tremolo should create a tremolo preset with overrides', () => {
        const p = tremolo('Wobble', { 'trem-rate': 10 });
        expect(p.type).toBe('builtin-tremolo');
        expect(p.parameterValues['trem-rate']).toBe(10);
        expect(p.parameterValues['trem-depth']).toBe(0.5); // default
    });
});
