import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    createOfflineWorkletRenderHarness,
    harnessRmsBetween,
} from '../../../../helpers/__tests__/offlineWorkletRenderHarness';
import { type Device } from '../../models/TrackViewTypes';
import { type NativeDspNode } from '../../repositories/deviceStrategy/nativeDspDeviceFactories';
import { buildDeviceChain } from '../buildDeviceChain';

/**
 * What `buildDeviceChain` does with a device release admission refuses, for the
 * two properties the Grand Boule specs cannot reach.
 *
 * Both are load-bearing and both were previously unobservable, because
 * `grand-boule` is the only withheld type today and it is an instrument sitting
 * alone on its track. Under that one fixture the withheld stand-in could
 * declare `acceptsNotes: true` unconditionally and could be built at zero gain,
 * and every spec would still pass.
 *
 * The withheld type here is injected rather than real, on purpose. Withholding
 * is a product decision and its membership list changes; the reasoning in
 * [ADR 0032](../../../../../.agents/decisions/0032-withhold-grand-boule-from-release.md)
 * is about patent and provenance risk, which is not instrument-specific. The
 * next device withheld may well be an effect, and these are the two ways that
 * would go wrong.
 */

const { mocks } = vi.hoisted(() => ({
    mocks: {
        loggerWarn: vi.fn(),
        instrumentNoteOn: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn, error: vi.fn(), info: vi.fn() },
}));

/**
 * One withheld effect and one withheld instrument, neither of them real. The
 * production set is deliberately not used: a fixture that named `grand-boule`
 * would stop testing the day it is released, and could never cover the effect
 * case at all.
 */
const WITHHELD_TYPES = new Set(['withheld-effect', 'withheld-instrument']);
vi.mock('#/infra/release/deviceReleaseAdmission', () => ({
    isDeviceReleaseAdmitted: (deviceType: string) => !WITHHELD_TYPES.has(deviceType),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: vi.fn(),
    createFaustNode: vi.fn(),
    isFaustModule: vi.fn(() => false),
    // The `withheld-instrument` arm below rides on this, which is the same
    // question `isOfflineInstrumentDevice` asks of any non-builtin id.
    isFaustInstrumentModule: (deviceType: string) => deviceType === 'withheld-instrument',
}));

function makeInstrumentDspNode(): NativeDspNode {
    return {
        workletNode: { connect: vi.fn(), disconnect: vi.fn(), numberOfInputs: 1 } as unknown as AudioWorkletNode,
        setParam: vi.fn(),
        setBypass: vi.fn(),
        noteOn: mocks.instrumentNoteOn,
        noteOff: vi.fn(),
        ready: Promise.resolve({}),
    };
}

vi.mock('../../repositories/deviceStrategy/nativeDspDeviceFactories', () => ({
    isNativeDspDevice: (type: string) => type === 'fermenter',
    NATIVE_DSP_DEVICE_FACTORIES: [
        { matches: (type: string) => type === 'fermenter', create: () => Promise.resolve(makeInstrumentDspNode()) },
    ],
}));

const SAMPLE_RATE = 44_100;
const harness = createOfflineWorkletRenderHarness();

function device(type: string, id: string): Device {
    return { id, name: type, type, bypassed: false, parameterValues: {} };
}

function makeContext(lengthSeconds: number) {
    return new harness.OfflineAudioContext(
        2,
        Math.round(lengthSeconds * SAMPLE_RATE),
        SAMPLE_RATE
    ) as OfflineAudioContext;
}

describe('a withheld device in the offline chain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Keeps `resolveWorkletPort` on its non-worklet arm, so no device here
        // reaches the offline instrument setup this spec does not model.
        vi.stubGlobal('AudioWorkletNode', undefined);
    });

    it('does not let a withheld effect claim the track notes the real instrument behind it needs', async () => {
        const ctx = makeContext(0.05);
        const devices = [device('withheld-effect', 'd-withheld'), device('fermenter', 'd-fermenter')];

        const entries = await buildDeviceChain(ctx, devices, ctx.createGain(), ctx.createGain());

        // Both entries are present — the withheld one is a silent stand-in, not
        // a drop — and the note surface is on exactly the device that voices.
        // `scheduleTrackClips` takes the FIRST entry carrying `instrumentControls`,
        // so a withheld effect declaring one would shadow the Fermenter here and
        // swallow the track's MIDI into a no-op (MD-4).
        expect(
            entries.map((entry) => ({
                deviceType: entry.deviceType,
                releaseWithheld: entry.releaseWithheld === true,
                voicesNotes: entry.instrumentControls !== undefined,
            }))
        ).toEqual([
            { deviceType: 'withheld-effect', releaseWithheld: true, voicesNotes: false },
            { deviceType: 'fermenter', releaseWithheld: false, voicesNotes: true },
        ]);
    });

    it('gives a withheld instrument the note surface, so nothing substitutes for it', async () => {
        const ctx = makeContext(0.05);

        const entries = await buildDeviceChain(
            ctx,
            [device('withheld-instrument', 'd-withheld')],
            ctx.createGain(),
            ctx.createGain()
        );

        // The mirror of the case above, and the reason `acceptsNotes` is asked
        // per device rather than hardcoded either way: an instrument must keep
        // its note surface, or `scheduleTrackClips` finds no instrument and
        // voices the part on the builtin fallback synth.
        expect(entries.map((entry) => entry.instrumentControls !== undefined)).toEqual([true]);
        entries[0]?.instrumentControls?.noteOn({ noteOrPad: 60, velocity: 100 });
        expect(mocks.instrumentNoteOn).not.toHaveBeenCalled();
    });

    it('passes an upstream signal through a withheld insert instead of silencing the track', async () => {
        const ctx = makeContext(0.05);
        const inputNode = ctx.createGain();
        const outputNode = ctx.createGain();

        // A source carrying real signal, standing in for whatever precedes the
        // withheld device in the rack — an audio clip, or an instrument the
        // build does contain.
        const source = ctx.createOscillator();
        source.connect(inputNode);
        source.start(0);

        await buildDeviceChain(ctx, [device('withheld-effect', 'd-withheld')], inputNode, outputNode);
        outputNode.connect(ctx.destination);

        const rendered = await ctx.startRendering();

        // Unity pass-through, not a zeroed gain. Live never inserts the
        // withheld node at all, so the signal around it is untouched; a zero
        // here would silence a whole track over one withheld insert, turning a
        // preserved project into a lost one for a reason the user cannot see.
        expect(harnessRmsBetween({ buffer: rendered, startSeconds: 0, endSeconds: 0.05 })).toBeGreaterThan(0.5);
    });
});
