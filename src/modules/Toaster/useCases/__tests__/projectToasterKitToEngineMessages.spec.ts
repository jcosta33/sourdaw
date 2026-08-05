import { describe, it, expect } from 'vitest';

import { projectToasterKitToEngineMessages } from '../projectToasterKitToEngineMessages';

import type { ToasterKit } from '#/modules/Toaster/models/ToasterKit';

function makePad(index: number, overrides: Partial<ToasterKit['pads'][number]> = {}): ToasterKit['pads'][number] {
    return {
        id: index,
        name: `Pad ${index}`,
        color: '#fff',
        engineType: 'kick-808',
        chokeGroup: 0,
        midiNote: 36 + index,
        volume: 0.8,
        pan: 0,
        muted: false,
        soloed: false,
        tune: 0,
        decay: 0.5,
        tone: 0.5,
        drive: 0,
        filterCutoff: 1,
        filterResonance: 0,
        sendReverb: 0.3,
        sendDelay: 0,
        engineParams: {},
        ...overrides,
    };
}

function makeKit(pads: ToasterKit['pads'][number][], overrides: Partial<ToasterKit> = {}): ToasterKit {
    return {
        version: 1,
        name: 'Test Kit',
        pads,
        patterns: [],
        activePatternId: 'p1',
        swing: 0,
        masterGain: 1,
        reverbMix: 0.2,
        reverbDecay: 0.5,
        delayTime: 250,
        delayFeedback: 0.3,
        delayMix: 0.1,
        lofiBits: 16,
        lofiRate: 44100,
        lofiMix: 0,
        ...overrides,
    } as ToasterKit;
}

describe('projectToasterKitToEngineMessages — kit-level params', () => {
    it('emits 9 kit-level param messages', () => {
        const kit = makeKit([makePad(0)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const params = messages.filter((m) => m.type === 'param');
        expect(params).toHaveLength(9);
        const names = params.map((m) => m.name);
        expect(names).toContain('master_gain');
        expect(names).toContain('reverb_mix');
        expect(names).toContain('delay_time');
        expect(names).toContain('lofi_bits');
    });

    it('master_gain reflects kit.masterGain', () => {
        const kit = makeKit([makePad(0)], { masterGain: 1.5 });
        const messages = projectToasterKitToEngineMessages({ kit });
        const masterGain = messages.find((m) => m.type === 'param' && m.name === 'master_gain');
        expect(masterGain?.type === 'param' && masterGain.value).toBe(1.5);
    });
});

describe('projectToasterKitToEngineMessages — per-pad messages', () => {
    it('emits 12 padParam messages per pad (engine_type + 11 params)', () => {
        const kit = makeKit([makePad(0)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const padParams = messages.filter((m) => m.type === 'padParam' && m.pad === 0);
        // engine_type + volume + pan + muted + tune + decay + tone + drive + filter_cutoff + filter_resonance + send_reverb + send_delay = 12
        expect(padParams).toHaveLength(12);
    });

    it('emits messages with correct pad index for each pad', () => {
        const kit = makeKit([makePad(0), makePad(1), makePad(2)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const padIndices = new Set(messages.filter((m) => m.type === 'padParam').map((m) => m.pad));
        expect(padIndices).toEqual(new Set([0, 1, 2]));
    });

    it('engine_type maps kick-808 to 13', () => {
        const kit = makeKit([makePad(0, { engineType: 'kick-808' })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const engineType = messages.find((m) => m.type === 'padParam' && m.name === 'engine_type');
        expect(engineType?.type === 'padParam' && engineType.value).toBe(13);
    });

    it('emits engine-specific voicing after engine_type and common pad state', () => {
        const kit = makeKit([
            makePad(0, {
                engineType: 'fm-perc',
                engineParams: { mod_ratio: 7.1, mod_amount: 5, feedback: 0.5 },
            }),
        ]);

        const padParams = projectToasterKitToEngineMessages({ kit }).filter(
            (message) => message.type === 'padParam' && message.pad === 0
        );

        expect(padParams.slice(-3)).toEqual([
            { type: 'padParam', pad: 0, name: 'mod_ratio', value: 7.1 },
            { type: 'padParam', pad: 0, name: 'mod_amount', value: 5 },
            { type: 'padParam', pad: 0, name: 'feedback', value: 0.5 },
        ]);
        expect(padParams.findIndex((message) => message.name === 'engine_type')).toBeLessThan(
            padParams.findIndex((message) => message.name === 'mod_ratio')
        );
        expect(padParams.findIndex((message) => message.name === 'tone')).toBeLessThan(
            padParams.findIndex((message) => message.name === 'mod_amount')
        );
    });
});

describe('projectToasterKitToEngineMessages — pad mute', () => {
    /**
     * `muted` is the pad's only silencing control and the DSP reads it as a
     * trigger gate (`ToasterEngine::note_on` returns before allocating a voice).
     * The engine's own `Pad::new` default is unmuted, so a kit that omits the
     * field leaves a muted pad audible after every device reload, preset load and
     * offline render — this projection is the one answer all three consume.
     */
    it('emits muted=1 for a muted pad', () => {
        const kit = makeKit([makePad(0, { muted: true })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const muted = messages.find((m) => m.type === 'padParam' && m.pad === 0 && m.name === 'muted');
        expect(muted?.type === 'padParam' && muted.value).toBe(1);
    });

    /**
     * The engine keeps pad state across kit loads, so the unmuted case has to be
     * stated rather than omitted: a pad muted under the previous kit would stay
     * muted under the next one if the projection only spoke up for `true`.
     */
    it('emits muted=0 for an unmuted pad so a stale engine mute is cleared', () => {
        const kit = makeKit([makePad(0, { muted: false })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const muted = messages.find((m) => m.type === 'padParam' && m.pad === 0 && m.name === 'muted');
        expect(muted?.type === 'padParam' && muted.value).toBe(0);
    });

    it('addresses mute per pad rather than muting the kit', () => {
        const kit = makeKit([makePad(0, { muted: false }), makePad(1, { muted: true }), makePad(2, { muted: false })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const mutedByPad = messages
            .filter((m) => m.type === 'padParam' && m.name === 'muted')
            .map((m) => (m.type === 'padParam' ? [m.pad, m.value] : []));
        expect(mutedByPad).toEqual([
            [0, 0],
            [1, 1],
            [2, 0],
        ]);
    });
});

describe('projectToasterKitToEngineMessages — hihat open/closed flag', () => {
    it('emits open=1 for hihat-open', () => {
        const kit = makeKit([makePad(0, { engineType: 'hihat-open' })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const openMsg = messages.find((m) => m.type === 'padParam' && m.name === 'open');
        expect(openMsg?.type === 'padParam' && openMsg.value).toBe(1);
    });

    it('emits open=0 for hihat-closed', () => {
        const kit = makeKit([makePad(0, { engineType: 'hihat-closed' })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const openMsg = messages.find((m) => m.type === 'padParam' && m.name === 'open');
        expect(openMsg?.type === 'padParam' && openMsg.value).toBe(0);
    });

    it('does NOT emit an open message for non-hihat engines', () => {
        const kit = makeKit([makePad(0, { engineType: 'kick-808' })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const openMsg = messages.find((m) => m.type === 'padParam' && m.name === 'open');
        expect(openMsg).toBeUndefined();
    });
});

describe('projectToasterKitToEngineMessages — NaN/Infinity filter', () => {
    it('drops messages with NaN values', () => {
        const kit = makeKit([makePad(0)], { masterGain: Number.NaN });
        const messages = projectToasterKitToEngineMessages({ kit });
        const masterGain = messages.find((m) => m.type === 'param' && m.name === 'master_gain');
        expect(masterGain).toBeUndefined();
    });

    it('drops messages with Infinity values', () => {
        const kit = makeKit([makePad(0, { volume: Number.POSITIVE_INFINITY })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const volume = messages.find((m) => m.type === 'padParam' && m.pad === 0 && m.name === 'volume');
        expect(volume).toBeUndefined();
    });

    it('keeps all finite values', () => {
        const kit = makeKit([makePad(0)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        for (const m of messages) {
            expect(Number.isFinite(m.value)).toBe(true);
        }
    });
});

describe('projectToasterKitToEngineMessages — total message count', () => {
    it('produces 9 + pads * 12 messages for pads without hihat', () => {
        const kit = makeKit([makePad(0), makePad(1)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        // 9 kit params + 2 pads * 12 pad params = 33
        expect(messages).toHaveLength(33);
    });

    it('adds +1 per hihat pad for the open flag', () => {
        const kit = makeKit([makePad(0, { engineType: 'hihat-open' }), makePad(1, { engineType: 'hihat-closed' })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        // 9 + 2*12 + 2 (open flags) = 35
        expect(messages).toHaveLength(35);
    });
});
