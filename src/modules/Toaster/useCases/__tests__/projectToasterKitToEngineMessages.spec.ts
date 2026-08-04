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
        ...overrides,
    } as ToasterKit['pads'][number];
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
        const names = params.map((m) => (m.type === 'param' ? m.name : ''));
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
    it('emits 10 padParam messages per pad (engine_type + 9 params)', () => {
        const kit = makeKit([makePad(0)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const padParams = messages.filter((m) => m.type === 'padParam' && m.pad === 0);
        // engine_type + volume + pan + tune + decay + tone + drive + filter_cutoff + filter_resonance + send_reverb + send_delay = 11
        expect(padParams).toHaveLength(11);
    });

    it('emits messages with correct pad index for each pad', () => {
        const kit = makeKit([makePad(0), makePad(1), makePad(2)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const padIndices = new Set(
            messages.filter((m) => m.type === 'padParam').map((m) => (m.type === 'padParam' ? m.pad : -1))
        );
        expect(padIndices).toEqual(new Set([0, 1, 2]));
    });

    it('engine_type maps kick-808 to 13', () => {
        const kit = makeKit([makePad(0, { engineType: 'kick-808' })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const engineType = messages.find((m) => m.type === 'padParam' && m.name === 'engine_type');
        expect(engineType?.type === 'padParam' && engineType.value).toBe(13);
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
    it('produces 9 + pads * 11 messages for pads without hihat', () => {
        const kit = makeKit([makePad(0), makePad(1)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        // 9 kit params + 2 pads * 11 pad params = 31
        expect(messages).toHaveLength(31);
    });

    it('adds +1 per hihat pad for the open flag', () => {
        const kit = makeKit([makePad(0, { engineType: 'hihat-open' }), makePad(1, { engineType: 'hihat-closed' })]);
        const messages = projectToasterKitToEngineMessages({ kit });
        // 9 + 2*11 + 2 (open flags) = 33
        expect(messages).toHaveLength(33);
    });
});
