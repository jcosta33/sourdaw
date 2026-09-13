import { describe, expect, it } from 'vitest';

import { dbToGain, gainToDb } from '#/utils/audioLevelLaw';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyDeEsserParams } from '../applyDeEsserParams';
import { createDeEsser } from '../createDeEsser';

type DeEsserNode = ReturnType<typeof createDeEsser>;

function gainOf(device: DeEsserNode, name: string): GainNode {
    const node = device.namedNodes?.[name];
    if (!node) {
        throw new Error(`expected a named ${name} node`);
    }
    return node as GainNode;
}

function connectionsOf(node: AudioNode): unknown[] {
    return (node as unknown as { connectedTo: unknown[] }).connectedTo;
}

function expectConnections(from: AudioNode, to: AudioNode): void {
    expect(connectionsOf(from)).toContain(to);
}

describe('createDeEsser split-band graph (#3735)', () => {
    it('feeds the compressor from the selected band only, never the broadband input', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const bandpass = device.namedNodes?.bandpass as BiquadFilterNode;
        const comp = device.namedNodes?.comp as DynamicsCompressorNode;
        const input = device.namedNodes?.input as AudioNode;
        expect(bandpass.type).toBe('bandpass');
        // The detector chain is input → bandpass → compressor: whatever the
        // compressor reacts to has passed through the band selection first.
        expectConnections(input, bandpass);
        expectConnections(bandpass, comp);
        // And no bypass wire from input to the compressor: broadband audio
        // cannot drive the sibilant reduction.
        expect(connectionsOf(input)).not.toContain(comp);
    });

    it('cancels the raw band against the compressed band with equal, opposite Range weights', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const wet = gainOf(device, 'wet');
        const cancel = gainOf(device, 'cancel');
        const defaultWeight = dbToGain(-12);
        expect(wet.gain.value).toBeCloseTo(defaultWeight, 12);
        expect(cancel.gain.value).toBeCloseTo(-defaultWeight, 12);
        // Idle compressor → wet and cancel carry the same band and sum to
        // nothing; the device is unity until the band actually compresses.
        expect(wet.gain.value + cancel.gain.value).toBeCloseTo(0, 12);
    });

    it('sums the full-range path, the band taps and the listen tap at one output', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const output = device.namedNodes?.output as AudioNode;
        const inputGain = gainOf(device, 'inputGain');
        const wet = gainOf(device, 'wet');
        const cancel = gainOf(device, 'cancel');
        const listen = gainOf(device, 'listen');
        expectConnections(inputGain, output);
        expectConnections(wet, output);
        expectConnections(cancel, output);
        expectConnections(listen, output);
    });
});

describe('applyDeEsserParams (#3735)', () => {
    it('moves the detector band with deess-freq and the threshold with deess-threshold', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const bandpass = device.namedNodes?.bandpass as BiquadFilterNode;
        const comp = device.namedNodes?.comp as DynamicsCompressorNode;
        applyDeEsserParams(device, { 'deess-freq': 8000, 'deess-threshold': -30 });
        expect(bandpass.frequency.value).toBe(8000);
        expect(comp.threshold.value).toBe(-30);
    });

    it('scales the reduction limit by deess-range in dB instead of halving it into a ratio', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const wet = gainOf(device, 'wet');
        const cancel = gainOf(device, 'cancel');
        const comp = device.namedNodes?.comp as DynamicsCompressorNode;
        applyDeEsserParams(device, { 'deess-range': -6 });
        // Both taps carry 10^(range/20): with the compressor fully engaged the
        // band is attenuated by exactly −range dB — the declared limit — and
        // never more, whatever the compressor's own ratio does.
        expect(wet.gain.value).toBeCloseTo(dbToGain(-6), 12);
        expect(cancel.gain.value).toBeCloseTo(-dbToGain(-6), 12);
        expect(gainToDb(1 / Math.abs(wet.gain.value))).toBeCloseTo(6, 9);
        // Ratio is the detector's slope, not the Range carrier.
        expect(comp.ratio.value).toBe(8);
    });

    it('isolates the selected band while Listen is on and restores the path after', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const listen = gainOf(device, 'listen');
        const inputGain = gainOf(device, 'inputGain');
        applyDeEsserParams(device, { 'deess-listen': 1 });
        expect(listen.gain.value).toBe(1);
        expect(inputGain.gain.value).toBe(0);
        applyDeEsserParams(device, { 'deess-listen': 0 });
        expect(listen.gain.value).toBe(0);
        expect(inputGain.gain.value).toBe(1);
    });

    it('leaves values untouched when params object is empty', () => {
        const device = createDeEsser(asBaseAudioContext(createMockAudioContext()));
        const bandpass = device.namedNodes?.bandpass as BiquadFilterNode;
        applyDeEsserParams(device, {});
        expect(bandpass.frequency.value).toBe(6000);
    });
});
