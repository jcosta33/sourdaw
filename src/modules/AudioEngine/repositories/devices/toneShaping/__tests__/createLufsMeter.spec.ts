import { describe, expect, it } from 'vitest';

import { createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyLufsMeterParams } from '../applyLufsMeterParams';
import { createLufsMeter } from '../createLufsMeter';

describe('createLufsMeter', () => {
    it('creates bypass path, K-weighting filters, and analyser', () => {
        const ctx = createMockAudioContext() as unknown as BaseAudioContext;
        const device = createLufsMeter(ctx);

        expect(ctx.createGain).toHaveBeenCalled();
        expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(2);
        expect(ctx.createAnalyser).toHaveBeenCalled();
        expect(device.nodes).toHaveLength(5);
        expect(device.inputNode).toBeDefined();
        expect(device.outputNode).toBeDefined();
    });

    it('stays a unity passthrough while feeding the K-weighted analyser', () => {
        const ctx = createMockAudioContext();
        const device = createLufsMeter(ctx as unknown as BaseAudioContext);
        const nn = device.namedNodes!;

        // Insert transparency: the input reaches the output untouched…
        expect((nn.input as unknown as { connectedTo: unknown[] }).connectedTo).toContain(nn.output);
        // …and the measurement taps the same input through the K-weight chain.
        expect((nn.input as unknown as { connectedTo: unknown[] }).connectedTo).toContain(nn.kHighShelf);
        expect((nn.kHighShelf as unknown as { connectedTo: unknown[] }).connectedTo).toContain(nn.kHighpass);
        expect((nn.kHighpass as unknown as { connectedTo: unknown[] }).connectedTo).toContain(nn.analyser);
    });

    it('exposes a reader and routes lufs-window onto it', () => {
        const ctx = createMockAudioContext();
        const device = createLufsMeter(ctx as unknown as BaseAudioContext);

        expect(device.lufsMeter).toBeDefined();
        expect(device.lufsMeter?.window()).toBe('momentary');

        applyLufsMeterParams(device, { 'lufs-window': 1 });
        expect(device.lufsMeter?.window()).toBe('shortTerm');

        applyLufsMeterParams(device, { 'lufs-window': 2 });
        expect(device.lufsMeter?.window()).toBe('integrated');
    });

    it('measures the analyser through the reader', () => {
        const ctx = createMockAudioContext();
        const device = createLufsMeter(ctx as unknown as BaseAudioContext);
        const analyser = device.namedNodes!.analyser as unknown as {
            getFloatTimeDomainData: (buffer: Float32Array) => void;
        };
        analyser.getFloatTimeDomainData = (buffer: Float32Array) => {
            buffer.fill(1);
        };

        const reading = device.lufsMeter?.read();
        expect(reading?.value).toBeCloseTo(-0.691, 2);
    });
});
