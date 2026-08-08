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
    /**
     * The names, not their number. A count is a weaker claim than the list it
     * summarises — it passes for any twelve messages, including twelve copies of
     * `volume` — and it has to be edited by hand every time the contract grows,
     * which is how a projection that had stopped sending `muted` could still
     * have reported the arity it was supposed to.
     */
    it('emits the whole common pad-state contract, in order, for a pad', () => {
        const kit = makeKit([makePad(0)]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const names = messages.filter((m) => m.type === 'padParam' && m.pad === 0).map((m) => m.name);
        expect(names).toEqual([
            'engine_type',
            'volume',
            'pan',
            'muted',
            'soloed',
            'choke_group',
            'tune',
            'decay',
            'tone',
            'drive',
            'filter_cutoff',
            'filter_resonance',
            'send_reverb',
            'send_delay',
        ]);
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

describe('projectToasterKitToEngineMessages — pad solo', () => {
    /**
     * Solo is per pad on the wire but resolved across the pad set in the engine,
     * which makes an omitted `false` worse than it is for mute: one pad left
     * soloed by the outgoing kit silences *every* pad of the incoming one. Both
     * values are therefore stated, and stated per pad.
     */
    it('addresses solo per pad and states the unsoloed pads too', () => {
        const kit = makeKit([
            makePad(0, { soloed: false }),
            makePad(1, { soloed: true }),
            makePad(2, { soloed: false }),
        ]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const soloByPad = messages
            .filter((m) => m.type === 'padParam' && m.name === 'soloed')
            .map((m) => (m.type === 'padParam' ? [m.pad, m.value] : []));
        expect(soloByPad).toEqual([
            [0, 0],
            [1, 1],
            [2, 0],
        ]);
    });
});

describe('projectToasterKitToEngineMessages — pad choke group', () => {
    /**
     * `Pad::choke_group` has always been read at note-on; nothing ever told the
     * engine what the kit's grouping was, so it ran on a construction default and
     * the pad grid's "C1" badge described a grouping the audio did not have.
     *
     * Interior groups matter as much as the ends: a projection that forwarded
     * only "has a group / has none" would pass a 0-vs-1 check and still collapse
     * every distinct pair onto one group, so this asserts a kit that uses three
     * different groups and expects them kept apart.
     */
    it('forwards each pad its own choke group, including group 0 and interior groups', () => {
        const kit = makeKit([
            makePad(0, { chokeGroup: 0 }),
            makePad(1, { chokeGroup: 1 }),
            makePad(2, { chokeGroup: 1 }),
            makePad(3, { chokeGroup: 7 }),
            makePad(4, { chokeGroup: 16 }),
        ]);
        const messages = projectToasterKitToEngineMessages({ kit });
        const chokeByPad = messages
            .filter((m) => m.type === 'padParam' && m.name === 'choke_group')
            .map((m) => (m.type === 'padParam' ? [m.pad, m.value] : []));
        expect(chokeByPad).toEqual([
            [0, 0],
            [1, 1],
            [2, 1],
            [3, 7],
            [4, 16],
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
    /**
     * The shape of the total, derived from the projection's own one-pad output
     * rather than restated as a literal: the kit-level block is emitted once and
     * the per-pad block is emitted once per pad. Emitting the kit block twice,
     * or emitting pad 0's block and skipping pad 1's, both red this.
     */
    it('emits the kit-level block once and the per-pad block once per pad', () => {
        const onePad = projectToasterKitToEngineMessages({ kit: makeKit([makePad(0)]) });
        const twoPads = projectToasterKitToEngineMessages({ kit: makeKit([makePad(0), makePad(1)]) });

        const kitLevelCount = onePad.filter((m) => m.type === 'param').length;
        const perPadCount = onePad.length - kitLevelCount;

        expect(twoPads).toHaveLength(kitLevelCount + 2 * perPadCount);
        expect(twoPads.filter((m) => m.type === 'param')).toHaveLength(kitLevelCount);
        expect(twoPads.filter((m) => m.type === 'padParam' && m.pad === 1)).toHaveLength(perPadCount);
    });

    it('adds exactly one open flag per hihat pad, valued by which hat it is', () => {
        const plain = projectToasterKitToEngineMessages({ kit: makeKit([makePad(0), makePad(1)]) });
        const hats = projectToasterKitToEngineMessages({
            kit: makeKit([makePad(0, { engineType: 'hihat-open' }), makePad(1, { engineType: 'hihat-closed' })]),
        });

        expect(hats.length - plain.length).toBe(2);
        expect(hats.filter((m) => m.type === 'padParam' && m.name === 'open').map((m) => m.value)).toEqual([1, 0]);
    });
});
