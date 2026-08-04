import { describe, expect, it } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';

import { PROCESSOR_TYPES, type ProcessorType } from '../ProcessorCatalog';

/**
 * A `ProcessorType` is not a `PluginDescriptor.id`.
 *
 * `applyAutomation`'s MIDI-FX branch passes `fx.type` — a `ProcessorType` — to
 * Arrangement's device-parameter laws, which key on `PluginDescriptor.id`. That
 * makes those lookups structurally unresolvable rather than merely unpopulated,
 * which is why the branch delivers unquantised and says so in as many words
 * instead of carrying a quantise call that can never fire.
 *
 * This is the assertion that keeps that comment honest. The moment somebody adds
 * a descriptor keyed by a processor type — the right way to close the gap — this
 * reds, and the MIDI-FX branch has to be revisited rather than silently
 * continuing to skip a law that now exists.
 *
 * Deliberately not a text census over the source: a `grep` for the identifier
 * stays green when the call is deleted and the import survives, and green for a
 * call that runs and decides nothing. This runs the lookup.
 */
describe('ProcessorCatalog', () => {
    it('shares no id with the device plugin registry', () => {
        const collisions = PROCESSOR_TYPES.filter((entry) => getPluginById(entry.type) !== undefined).map(
            (entry) => entry.type
        );

        expect(collisions).toEqual([]);
    });

    it('lists every processor type the union declares', () => {
        // Without this the check above passes vacuously if `PROCESSOR_TYPES`
        // drifts from the union — a type absent from the array is a type nobody
        // checked for a descriptor collision.
        const declared: ProcessorType[] = [
            'arpeggiator',
            'chord',
            'chordMemory',
            'scale',
            'harmonizer',
            'repeater',
            'velocity',
            'humanizer',
            'filter',
            'transposer',
            'groove',
            'ccGenerator',
            'euclidean',
            'markov',
            'mutation',
        ];
        const listed = PROCESSOR_TYPES.map((entry) => entry.type);

        expect([...listed].sort()).toEqual([...declared].sort());
    });
});
