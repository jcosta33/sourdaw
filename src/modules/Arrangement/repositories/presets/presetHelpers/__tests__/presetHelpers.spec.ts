import { describe, it, expect } from 'vitest';

import { getPluginById } from '../../../../models/DeviceParameter';
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
        const param = synth('My Synth', { freq: 440 });
        expect(param).toEqual({ type: 'builtin-synth', name: 'My Synth', parameterValues: { freq: 440 } });
    });

    it('autopan should create an autopan preset with overrides', () => {
        const param = autopan('Slow Pan', { 'autopan-rate': 0.5 });
        expect(param.type).toBe('builtin-autopan');
        expect(param.parameterValues['autopan-rate']).toBe(0.5);
        expect(param.parameterValues['autopan-depth']).toBe(0.7); // default
    });

    it('bitcrusher should create a bitcrusher preset with overrides', () => {
        const param = bitcrusher('Lofi', { 'crush-bits': 4 });
        expect(param.type).toBe('builtin-bitcrusher');
        expect(param.parameterValues['crush-bits']).toBe(4);
        expect(param.parameterValues['crush-mix']).toBe(0.5); // default
    });

    it('chorus should create a chorus preset with overrides', () => {
        const param = chorus('Wide', { 'chorus-depth': 10 });
        expect(param.type).toBe('builtin-chorus');
        expect(param.parameterValues['chorus-depth']).toBe(10);
        expect(param.parameterValues['chorus-mix']).toBe(0.5); // default
    });

    it('comp should create a compressor preset with overrides', () => {
        const param = comp('Punchy', { 'comp-ratio': 8 });
        expect(param.type).toBe('builtin-compressor');
        expect(param.parameterValues['comp-ratio']).toBe(8);
        expect(param.parameterValues['comp-threshold']).toBe(-20); // default
    });

    it('eq should create an eq preset with overrides', () => {
        const param = eq('Bright', { 'eq-high-gain': 6 });
        expect(param.type).toBe('builtin-eq');
        expect(param.parameterValues['eq-high-gain']).toBe(6);
        expect(param.parameterValues['eq-low-freq']).toBe(100); // default
    });

    it('filter should create a filter preset with overrides', () => {
        const param = filter('Sweep', { 'filter-cutoff': 500 });
        expect(param.type).toBe('builtin-filter');
        expect(param.parameterValues['filter-cutoff']).toBe(500);
        expect(param.parameterValues['filter-resonance']).toBe(1); // default
    });

    it('flanger should create a flanger preset with overrides', () => {
        const param = flanger('Jet', { 'flanger-feedback': 0.9 });
        expect(param.type).toBe('builtin-flanger');
        expect(param.parameterValues['flanger-feedback']).toBe(0.9);
        expect(param.parameterValues['flanger-mix']).toBe(0.5); // default
    });

    it('limiter should create a limiter preset with overrides', () => {
        const param = limiter('Ceiling', { 'lim-threshold': -0.5 });
        expect(param.type).toBe('builtin-limiter');
        expect(param.parameterValues['lim-threshold']).toBe(-0.5);
        // 100 ms. Was 0.1, which was seconds against a millisecond parameter —
        // the engine divides by 1000, so it reached the limiter as 0.1 ms.
        expect(param.parameterValues['lim-release']).toBe(100);
    });

    it('keeps the limiter release inside the range the engine is held to', () => {
        // The unit bug above was invisible because nothing compared a preset
        // value to the declared range. Now that the range binds at the write,
        // a value outside it is silently rewritten rather than merely odd.
        const declared = getPluginById('builtin-limiter')?.parameters.find(
            (parameter) => parameter.id === 'lim-release'
        );
        const release = limiter('Ceiling', {}).parameterValues['lim-release']!;

        expect(release).toBeGreaterThanOrEqual(declared!.minValue);
        expect(release).toBeLessThanOrEqual(declared!.maxValue);
    });

    it('phaser should create a phaser preset with overrides', () => {
        const param = phaser('Space', { 'phaser-stages': 8 });
        expect(param.type).toBe('builtin-phaser');
        expect(param.parameterValues['phaser-stages']).toBe(8);
        expect(param.parameterValues['phaser-rate']).toBe(0.5); // default
    });

    it('reverb should create a reverb preset with overrides', () => {
        const param = reverb('Hall', { 'rev-decay': 5 });
        expect(param.type).toBe('builtin-reverb');
        expect(param.parameterValues['rev-decay']).toBe(5);
        expect(param.parameterValues['rev-mix']).toBe(0.3); // default
    });

    it('tremolo should create a tremolo preset with overrides', () => {
        const param = tremolo('Wobble', { 'trem-rate': 10 });
        expect(param.type).toBe('builtin-tremolo');
        expect(param.parameterValues['trem-rate']).toBe(10);
        expect(param.parameterValues['trem-depth']).toBe(0.5); // default
    });
});
