import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyPhaserParams } from '../applyPhaserParams';
import { createPhaser } from '../createPhaser';
import { PHASER_STAGES_RANGE } from '../phaserWiring';

/**
 * Issue #3733 oracle: `phaser-stages` advertised integer 2..12 but the factory
 * always instantiated four allpass filters and the applier mapped the knob
 * onto Q — so 2 and 6 were identical and 12 still had four stages. These
 * tests require the built graph to hold exactly the requested number of active
 * stages and to render a different response at 2, 6 and 12.
 */

const SAMPLE_RATE = 48_000;
const MAX_STAGES = PHASER_STAGES_RANGE.max;

type MockFn = { mockClear: () => void; mock: { calls: unknown[][] } };
type MockNode = { connect: MockFn; disconnect: MockFn };

function makeDevice() {
    const ctx = createMockAudioContext();
    return createPhaser(asBaseAudioContext(ctx));
}

function filterOf(device: ReturnType<typeof createPhaser>, index: number): MockNode {
    return device.namedNodes![`filter${index}`] as unknown as MockNode;
}

/**
 * Rewire to `stages` and count the active chain from the wiring calls the
 * applier made — the mock keeps stale `connectedTo` entries, so the connect
 * calls are the graph truth for the change under test.
 */
function stagesAfterRewire(device: ReturnType<typeof createPhaser>, stages: number): number {
    const nn = device.namedNodes!;
    for (let index = 0; index < MAX_STAGES; index++) {
        const filter = filterOf(device, index);
        filter.connect.mockClear();
        filter.disconnect.mockClear();
    }
    applyPhaserParams(device, { 'phaser-stages': stages });

    let active = 1;
    for (let index = 0; index < MAX_STAGES - 1; index++) {
        const successor = nn[`filter${index + 1}`];
        const calls = filterOf(device, index).connect.mock.calls;
        if (calls.some((call) => call[0] === successor)) {
            active += 1;
            continue;
        }
        break;
    }
    return active;
}

/** One RBJ 2nd-order allpass stage, coefficients read from the built node. */
type AllpassNode = { frequency: { value: number }; Q: { value: number } };

function allpassStage(input: Float64Array, node: AllpassNode): Float64Array {
    const w0 = (2 * Math.PI * node.frequency.value) / SAMPLE_RATE;
    const alpha = Math.sin(w0) / (2 * node.Q.value);
    const norm = 1 + alpha;
    const b0 = (1 - alpha) / norm;
    const b1 = (-2 * Math.cos(w0)) / norm;
    const b2 = 1;
    const a1 = b1;
    const a2 = b0;
    const output = new Float64Array(input.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let index = 0; index < input.length; index++) {
        const x0 = input[index]!;
        const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        output[index] = y0;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
    }
    return output;
}

/** Impulse response of the active chain, reading each filter's own values. */
function renderStages(device: ReturnType<typeof createPhaser>, stages: number): Float64Array<ArrayBufferLike> {
    const impulse = new Float64Array(SAMPLE_RATE);
    impulse[0] = 1;
    let signal: Float64Array<ArrayBufferLike> = impulse;
    for (let index = 0; index < stages; index++) {
        signal = allpassStage(signal, device.namedNodes![`filter${index}`] as unknown as AllpassNode);
    }
    return signal;
}

function maxDelta(a: Float64Array, b: Float64Array): number {
    let max = 0;
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
        max = Math.max(max, Math.abs(a[index]! - b[index]!));
    }
    return max;
}

describe('phaser stage count (#3733)', () => {
    it('activates exactly the requested number of allpass stages', () => {
        const device = makeDevice();

        expect(stagesAfterRewire(device, 8)).toBe(8);
        expect(stagesAfterRewire(device, 2)).toBe(2);
        expect(stagesAfterRewire(device, 12)).toBe(12);
        expect(stagesAfterRewire(device, 6)).toBe(6);
    });

    it('routes only the last active stage into the wet gain and feedback loop', () => {
        const device = makeDevice();
        const nn = device.namedNodes!;
        stagesAfterRewire(device, 3);

        const lastActive = filterOf(device, 2);
        expect(lastActive.connect).toHaveBeenCalledWith(nn.wet);
        expect(lastActive.connect).toHaveBeenCalledWith(nn.feedback);
        // An inactive pooled stage must not be wired back into the chain.
        const inactive = filterOf(device, 5);
        expect(inactive.connect).not.toHaveBeenCalled();
    });

    it('never maps stages onto Q', () => {
        const device = makeDevice();
        applyPhaserParams(device, { 'phaser-stages': 12 });
        for (let index = 0; index < MAX_STAGES; index++) {
            const filter = device.namedNodes![`filter${index}`] as unknown as { Q: { value: number } };
            expect(filter.Q.value).toBe(0.5);
        }
    });

    it('renders different responses at 2, 6 and 12 stages', () => {
        const device = makeDevice();

        applyPhaserParams(device, { 'phaser-stages': 2 });
        const two = renderStages(device, 2);
        applyPhaserParams(device, { 'phaser-stages': 6 });
        const six = renderStages(device, 6);
        applyPhaserParams(device, { 'phaser-stages': 12 });
        const twelve = renderStages(device, 12);

        expect(maxDelta(two, six)).toBeGreaterThan(1e-3);
        expect(maxDelta(six, twelve)).toBeGreaterThan(1e-3);
        expect(maxDelta(two, twelve)).toBeGreaterThan(1e-3);
    });

    it('clamps out-of-range stage requests to the declared 2..12 window', () => {
        const device = makeDevice();
        expect(stagesAfterRewire(device, 99)).toBe(12);
        expect(stagesAfterRewire(device, -3)).toBe(2);
    });
});
