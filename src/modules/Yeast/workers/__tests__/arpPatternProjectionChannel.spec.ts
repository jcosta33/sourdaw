/**
 * The pattern channel, end to end on the Worker side.
 *
 * These specs drive the REAL projection application path — the same
 * `MidiRack.replaceProjection` + `createProcessor` pair `yeastWorker` calls when
 * it handles a `setProjection` message — and assert the pattern changed what the
 * rack actually emits. Asserting `getPattern()` alone would pass even if the
 * Arpeggiator ignored the pattern while sequencing.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { type NoteSelector, type StepType, defaultStep, withArpPatternParams } from '../../models/ArpPattern';
import { type MidiEvent, type MidiEventKind, type TransportInfo } from '../../models/MidiEvent';
import { type YeastProcessorProjectionItem } from '../../models/YeastProcessorProjection';
import { type MidiProcessor } from '../MidiProcessor';
import { MidiRack } from '../MidiRack';
import { createProcessor } from '../processorFactory';
import { Arpeggiator } from '../processors/Arpeggiator';

import type { ProcessorType } from '../../models/ProcessorCatalog';

const ARP_ID = 'arpeggiator-1';

type NoteOnEvent = MidiEvent & { kind: Extract<MidiEventKind, { type: 'noteOn' }> };

function isNoteOn(event: MidiEvent): event is NoteOnEvent {
    return event.kind.type === 'noteOn';
}

/** Durable arpeggiator params exactly as `setYeastArpPattern` writes them into the store. */
function createArpProjection(params: Record<string, number>): YeastProcessorProjectionItem[] {
    return [{ id: ARP_ID, type: 'arpeggiator', bypassed: false, params }];
}

describe('arp pattern projection channel', () => {
    let rack: MidiRack;
    let created: Arpeggiator[];
    let transport: TransportInfo;

    const capturingFactory = (type: ProcessorType, id: string): MidiProcessor => {
        const processor = createProcessor(type, id);
        if (processor instanceof Arpeggiator) {
            created.push(processor);
        }
        return processor;
    };

    /** Hold a chord, then run the pattern forward and collect the pitches the rack emitted. */
    const soundPitches = (notes: readonly number[] = [60]): number[] => {
        rack.processBlock(
            notes.map((note) => ({
                timeSamples: 0,
                kind: { type: 'noteOn' as const, channel: 0, note, velocity: 100 },
            })),
            0,
            128,
            transport,
            'track-a'
        );
        const output = rack.processBlock([], 0, 25000, { ...transport, ppqPosition: 1.1 }, 'track-a');
        return output.filter(isNoteOn).map((event) => event.kind.note);
    };

    beforeEach(() => {
        rack = new MidiRack();
        created = [];
        transport = {
            isPlaying: true,
            ppqPosition: 0,
            bpm: 120,
            sampleRate: 44100,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        };
    });

    it('carries a stored pattern to the Worker Arpeggiator and changes what it sounds', () => {
        // mode 7 is Pattern. The single step is transposed one octave up, so
        // every note the rack emits is the pattern's doing and nothing else's.
        const params = withArpPatternParams({ mode: 7, rate_denom: 8 }, [{ ...defaultStep(), octaveOffset: 1 }]);
        rack.replaceProjection(createArpProjection(params), capturingFactory);

        const pitches = soundPitches();

        expect(pitches.length).toBeGreaterThan(0);
        expect(new Set(pitches)).toEqual(new Set([72]));
        expect(created[0]?.getPattern()).toEqual([{ ...defaultStep(), octaveOffset: 1 }]);
    });

    it('sounds the default pattern for a projection saved before the pattern channel existed', () => {
        rack.replaceProjection(createArpProjection({ mode: 7, rate_denom: 8 }), capturingFactory);

        const pitches = soundPitches();

        expect(pitches.length).toBeGreaterThan(0);
        expect(new Set(pitches)).toEqual(new Set([60]));
        expect(created[0]?.getPattern()).toHaveLength(8);
    });

    it('replaces the live pattern when a later projection edits it', () => {
        rack.replaceProjection(
            createArpProjection(withArpPatternParams({ mode: 7, rate_denom: 8 }, [{ ...defaultStep() }])),
            capturingFactory
        );
        expect(soundPitches()).not.toContain(72);

        rack.replaceProjection(
            createArpProjection(
                withArpPatternParams({ mode: 7, rate_denom: 8 }, [{ ...defaultStep(), octaveOffset: 1 }])
            ),
            capturingFactory
        );

        // Same processor instance — a projection that only changes params must
        // not rebuild the chain, so this proves the edit reached the live object.
        expect(created).toHaveLength(1);
        expect(new Set(soundPitches())).toEqual(new Set([72]));
    });

    it('drops steps a shortened pattern no longer carries', () => {
        const longPattern = [{ ...defaultStep() }, { ...defaultStep() }, { ...defaultStep(), octaveOffset: 1 }];
        rack.replaceProjection(createArpProjection(withArpPatternParams({ mode: 7 }, longPattern)), capturingFactory);
        expect(created[0]?.getPattern()).toHaveLength(3);

        rack.replaceProjection(
            createArpProjection(withArpPatternParams({ mode: 7 }, longPattern.slice(0, 2))),
            capturingFactory
        );

        expect(created[0]?.getPattern()).toEqual([{ ...defaultStep() }, { ...defaultStep() }]);
    });

    it('leaves the live pattern and the running sequence alone when only a scalar changes', () => {
        // `MidiRack.replaceProjection` calls `replaceParams` on every processor
        // on every projection write, and a knob drag projects once per tick. A
        // re-decode there would rebuild the step array under a sounding
        // sequence on every tick of an edit that never touched the pattern.
        const pattern = [{ ...defaultStep(), octaveOffset: 1 }, { ...defaultStep() }];
        rack.replaceProjection(
            createArpProjection(withArpPatternParams({ mode: 7, rate_denom: 8, gate: 0.8 }, pattern)),
            capturingFactory
        );
        const arp = created[0]!;
        // `getPattern()` copies the outer array but not the step objects, so
        // step identity is exactly "was this decoded again?".
        const patternBefore = arp.getPattern()[0];

        soundPitches();
        const stepBefore = arp.getCurrentStep();

        // Ten ticks of a gate drag: same pattern subset, moving scalar.
        for (let tick = 0; tick < 10; tick++) {
            rack.replaceProjection(
                createArpProjection(withArpPatternParams({ mode: 7, rate_denom: 8, gate: 0.5 + tick * 0.01 }, pattern)),
                capturingFactory
            );
        }

        expect(arp.getPattern()[0]).toBe(patternBefore);
        expect(arp.getCurrentStep()).toBe(stepBefore);
        expect(created).toHaveLength(1);
    });

    it('still decodes when the pattern subset itself changes', () => {
        const params = withArpPatternParams({ mode: 7, rate_denom: 8 }, [{ ...defaultStep() }]);
        rack.replaceProjection(createArpProjection(params), capturingFactory);
        const arp = created[0]!;
        // `getPattern()` copies the outer array but not the step objects, so
        // step identity is exactly "was this decoded again?".
        const patternBefore = arp.getPattern()[0];

        rack.replaceProjection(
            createArpProjection(
                withArpPatternParams({ mode: 7, rate_denom: 8 }, [{ ...defaultStep(), octaveOffset: 1 }])
            ),
            capturingFactory
        );

        expect(arp.getPattern()[0]).not.toBe(patternBefore);
        expect(arp.getPattern()).toEqual([{ ...defaultStep(), octaveOffset: 1 }]);
    });

    describe('per-step note selection', () => {
        const CHORD = [60, 64, 67];

        const soundWithSelector = (selector: NoteSelector): number[] => {
            rack = new MidiRack();
            created = [];
            rack.replaceProjection(
                createArpProjection(
                    withArpPatternParams({ mode: 7, rate_denom: 8 }, [{ ...defaultStep(), noteSelector: selector }])
                ),
                capturingFactory
            );
            return soundPitches(CHORD);
        };

        it('takes the lowest held note when the step selects lowest', () => {
            expect(new Set(soundWithSelector({ type: 'lowest' }))).toEqual(new Set([60]));
        });

        it('takes the highest held note when the step selects highest', () => {
            expect(new Set(soundWithSelector({ type: 'highest' }))).toEqual(new Set([67]));
        });

        it('takes the addressed note when the step selects an index', () => {
            expect(new Set(soundWithSelector({ type: 'index', index: 1 }))).toEqual(new Set([64]));
        });

        it('changes the emitted pitch when the selector is edited', () => {
            // The discriminating pair: same pattern, same chord, different selector.
            expect(soundWithSelector({ type: 'lowest' })).not.toEqual(soundWithSelector({ type: 'highest' }));
        });

        it('makes a random step differ from a plain note step under the same pinned seed', () => {
            const soundWithType = (stepType: StepType): number[] => {
                rack = new MidiRack();
                created = [];
                rack.replaceProjection(
                    createArpProjection(
                        withArpPatternParams({ mode: 7, rate_denom: 8 }, [
                            { ...defaultStep(), stepType },
                            { ...defaultStep(), stepType },
                            { ...defaultStep(), stepType },
                            { ...defaultStep(), stepType },
                        ])
                    ),
                    capturingFactory
                );
                return soundPitches(CHORD);
            };

            const plain = soundWithType('note');
            const random = soundWithType('random');

            expect(random).not.toEqual(plain);
            // Deterministic per seed: a fresh rack replays the same draw.
            expect(soundWithType('random')).toEqual(random);
        });
    });
});
