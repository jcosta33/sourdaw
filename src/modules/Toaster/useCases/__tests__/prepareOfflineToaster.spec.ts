import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDefaultKit, type DrumEngineType, type ToasterKit } from '../../models/ToasterKit';
import { defaultToasterState, toasterStore } from '../../stores/toasterStore';
import { TOASTER_ENGINE_MAP } from '../loadToasterKit';
import { prepareOfflineToaster } from '../prepareOfflineToaster';

/**
 * The engine index each pad holds when nothing configures it — `ToasterEngine::new`
 * (`crates/daw-dsp/src/toaster/engine.rs`) read through the `engine_type` match arms
 * in `pad.rs`. This is what an export rendered: right notes, wrong drums.
 *
 * Every assertion below is written against this table, not merely against "a
 * message arrived", because the failure mode is present-but-wrong audio. A guard
 * that only counted messages would be satisfied by the default kit.
 */
const RUST_DEFAULT_ENGINE_INDEX_BY_PAD = [0, 1, 2, 2, 3, 12, 5, 5, 5, 6, 6, 9, 10, 11, 4, 4] as const;

/**
 * A pad configuration chosen so that **every** field differs from the Rust
 * constructor defaults (`Pad::new`: volume 0.8, pan 0, tune 0, decay 0.5, tone 0.5,
 * drive 0, filter fully open, sends 0) and from the default engine for that pad
 * index. That divergence is the whole point of the fixture — rendering the default
 * kit has to fail these assertions.
 *
 * Do not "tidy" these values back towards the defaults. Matching the defaults
 * would leave the test green against a completely unconfigured engine, which is
 * precisely the bug it exists to catch.
 */
const PROJECT_ENGINE_TYPES: readonly DrumEngineType[] = [
    'cr78-metallic', // 28, against a default of 0 (generic Kick)
    'modal-tabla', //   7, against a default of 1 (generic Snare)
    'hihat-open', //   16, against a default of 2 — and carries the `open` flag
    'kick-909', //     14, against a default of 2 (generic HiHat)
];

function makeProjectKit(): ToasterKit {
    const base = createDefaultKit();
    const pads = base.pads.slice(0, PROJECT_ENGINE_TYPES.length).map((pad, index) => ({
        ...pad,
        engineType: PROJECT_ENGINE_TYPES[index]!,
        volume: 0.42,
        pan: -0.6,
        tune: -7,
        decay: 0.13,
        tone: 0.91,
        drive: 6.5,
        filterCutoff: 800,
        filterResonance: 12,
        sendReverb: 0.77,
        sendDelay: 0.33,
    }));
    return {
        ...base,
        pads,
        masterGain: 1.7,
        reverbMix: 0.62,
        reverbDecay: 0.88,
        delayTime: 210,
        delayFeedback: 0.71,
        delayMix: 0.44,
        lofiBits: 6,
        lofiRate: 8000,
        lofiMix: 0.85,
    };
}

type PadParamMessage = { type: 'padParam'; pad: number; name: string; value: number };
type ParamMessage = { type: 'param'; name: string; value: number };
type PortMessage = PadParamMessage | ParamMessage;

function isPadParam(message: PortMessage): message is PadParamMessage {
    return message.type === 'padParam';
}

function makeRecordingPort(): { port: MessagePort; sent: PortMessage[] } {
    const sent: PortMessage[] = [];
    const port = {
        postMessage: (message: PortMessage) => {
            sent.push(message);
        },
    } as unknown as MessagePort;
    return { port, sent };
}

function padValue(sent: PortMessage[], pad: number, name: string): number | undefined {
    return sent.filter(isPadParam).find((message) => message.pad === pad && message.name === name)?.value;
}

function kitValue(sent: PortMessage[], name: string): number | undefined {
    return sent.find((message): message is ParamMessage => message.type === 'param' && message.name === name)?.value;
}

describe('prepareOfflineToaster', () => {
    beforeEach(() => {
        toasterStore.set({});
    });

    afterEach(() => {
        toasterStore.set({});
    });

    it("puts the project's own engine selection on every pad, not the engine's built-in kit", () => {
        toasterStore.set({ 'toaster-1': { ...defaultToasterState, kit: makeProjectKit() } });
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: 'toaster-1', port });

        // engine_type is the strongest discriminator: it selects the synthesis
        // model, so getting it wrong is the difference between a CR-78 and a
        // generic kick regardless of how every other parameter is set.
        for (const [index, engineType] of PROJECT_ENGINE_TYPES.entries()) {
            const expected = TOASTER_ENGINE_MAP[engineType];
            expect(padValue(sent, index, 'engine_type')).toBe(expected);
            expect(expected).not.toBe(RUST_DEFAULT_ENGINE_INDEX_BY_PAD[index]);
        }
    });

    it('carries the per-pad voicing the session was mixed with', () => {
        toasterStore.set({ 'toaster-1': { ...defaultToasterState, kit: makeProjectKit() } });
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: 'toaster-1', port });

        expect(padValue(sent, 1, 'volume')).toBe(0.42);
        expect(padValue(sent, 1, 'pan')).toBe(-0.6);
        expect(padValue(sent, 1, 'tune')).toBe(-7);
        expect(padValue(sent, 1, 'decay')).toBe(0.13);
        expect(padValue(sent, 1, 'tone')).toBe(0.91);
        expect(padValue(sent, 1, 'drive')).toBe(6.5);
        expect(padValue(sent, 1, 'filter_cutoff')).toBe(800);
        expect(padValue(sent, 1, 'filter_resonance')).toBe(12);
        expect(padValue(sent, 1, 'send_reverb')).toBe(0.77);
        expect(padValue(sent, 1, 'send_delay')).toBe(0.33);
    });

    it('distinguishes the open hat from the closed one, which share an engine index', () => {
        toasterStore.set({ 'toaster-1': { ...defaultToasterState, kit: makeProjectKit() } });
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: 'toaster-1', port });

        // Pad 2 is 'hihat-open'. Engine index 16 alone does not say which hat it
        // is — `open` does, and without it the export renders a closed hat.
        // Pad 2 is deliberately the slot the application's *default* kit fills
        // with 'hihat-closed', so posting the default kit fails this outright
        // rather than coinciding with it.
        expect(padValue(sent, 2, 'engine_type')).toBe(16);
        expect(padValue(sent, 2, 'open')).toBe(1);
        // Pad 3 is 'kick-909' here and 'hihat-open' in the default kit, so a
        // stray `open` on pad 3 means the default kit was rendered.
        expect(padValue(sent, 3, 'open')).toBeUndefined();
    });

    it('carries the kit-level mix the session was rendered with', () => {
        toasterStore.set({ 'toaster-1': { ...defaultToasterState, kit: makeProjectKit() } });
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: 'toaster-1', port });

        expect(kitValue(sent, 'master_gain')).toBe(1.7);
        expect(kitValue(sent, 'reverb_mix')).toBe(0.62);
        expect(kitValue(sent, 'reverb_decay')).toBe(0.88);
        expect(kitValue(sent, 'delay_time')).toBe(210);
        expect(kitValue(sent, 'delay_feedback')).toBe(0.71);
        expect(kitValue(sent, 'delay_mix')).toBe(0.44);
        expect(kitValue(sent, 'lofi_bits')).toBe(6);
        expect(kitValue(sent, 'lofi_rate')).toBe(8000);
        expect(kitValue(sent, 'lofi_mix')).toBe(0.85);
    });

    it('sends engine-specific pad params, which no other offline write path carries', () => {
        const kit = makeProjectKit();
        kit.pads[0] = { ...kit.pads[0]!, engineParams: { snappy: 0.93, noise_level: 1.4 } };
        toasterStore.set({ 'toaster-1': { ...defaultToasterState, kit } });
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: 'toaster-1', port });

        expect(padValue(sent, 0, 'snappy')).toBe(0.93);
        expect(padValue(sent, 0, 'noise_level')).toBe(1.4);
    });

    it('falls back to the default kit for a device with no store record, which still is not the engine default', () => {
        const { port, sent } = makeRecordingPort();

        prepareOfflineToaster({ deviceId: 'never-registered', port });

        // The application's default kit is 808/909 circuit-faithful voices; the
        // engine's constructor default is the generic set. Sending nothing would
        // render the generic set, so the fallback is not cosmetic.
        expect(padValue(sent, 0, 'engine_type')).toBe(TOASTER_ENGINE_MAP['kick-808']);
        expect(padValue(sent, 0, 'engine_type')).not.toBe(RUST_DEFAULT_ENGINE_INDEX_BY_PAD[0]);
        expect(padValue(sent, 1, 'engine_type')).toBe(TOASTER_ENGINE_MAP['snare-808']);
        expect(padValue(sent, 1, 'engine_type')).not.toBe(RUST_DEFAULT_ENGINE_INDEX_BY_PAD[1]);
    });
});
