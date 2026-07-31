import { describe, expect, it } from 'vitest';

import { createDefaultKit } from '../ToasterKit';
import { fromToasterKitState, toToasterKitState, TOASTER_KIT_STATE_VERSION } from '../ToasterKitState';

/**
 * The kit chunk is wire format. Its reader has to survive anything the document can
 * hand it — a chunk written by a newer build, a hand-edited project file, a
 * half-written payload from a peer — and always return a structurally complete kit,
 * because the sequencer, the engine projection and the panel all index into it
 * directly and a missing pad or pattern is a crash rather than a wrong sound.
 */
describe('toasterKitState codec', () => {
    it('round-trips the fields parameterValues cannot hold', () => {
        const kit = createDefaultKit();
        kit.name = 'Sourdough Breaks';
        kit.pads[3]!.name = 'Rimshot';
        kit.pads[3]!.muted = true;
        kit.pads[3]!.engineType = 'rimshot';
        kit.pads[5]!.soloed = true;
        kit.patterns[0]!.tracks[3]!.steps[5]!.active = true;
        kit.patterns[0]!.tracks[3]!.steps[5]!.condition = 'fill';

        const restored = fromToasterKitState(toToasterKitState(kit));

        expect(restored.name).toBe('Sourdough Breaks');
        expect(restored.pads[3]?.name).toBe('Rimshot');
        expect(restored.pads[3]?.muted).toBe(true);
        expect(restored.pads[3]?.engineType).toBe('rimshot');
        expect(restored.pads[5]?.soloed).toBe(true);
        expect(restored.patterns[0]?.tracks[3]?.steps[5]?.active).toBe(true);
        expect(restored.patterns[0]?.tracks[3]?.steps[5]?.condition).toBe('fill');
        expect(restored.patterns[0]?.tracks[3]?.steps[4]?.active).toBe(false);
    });

    it('stamps the envelope version so a later reader can identify the payload', () => {
        expect(toToasterKitState(createDefaultKit()).version).toBe(TOASTER_KIT_STATE_VERSION);
    });

    it.each([
        [
            'a version this build does not know',
            { version: TOASTER_KIT_STATE_VERSION + 1, data: { kit: { name: 'X' } } },
        ],
        ['a chunk with no version', { data: { kit: { name: 'X' } } }],
        ['a chunk with no kit', { version: TOASTER_KIT_STATE_VERSION, data: {} }],
        ['a kit that is not a container', { version: TOASTER_KIT_STATE_VERSION, data: { kit: 'X' } }],
        ['a junk scalar', 7],
        ['null', null],
    ])('degrades %s to the default kit rather than throwing', (_label, chunk) => {
        const restored = fromToasterKitState(chunk);
        const fallback = createDefaultKit();

        expect(restored.name).toBe(fallback.name);
        expect(restored.pads).toHaveLength(fallback.pads.length);
        expect(restored.patterns[0]?.tracks[0]?.steps).toHaveLength(fallback.patterns[0]!.tracks[0]!.steps.length);
    });

    it('replaces only the malformed pad, keeping the good ones around it', () => {
        const kit = createDefaultKit();
        kit.pads[0]!.name = 'Kick';
        kit.pads[2]!.name = 'Snare';
        const chunk = toToasterKitState(kit);
        const storedKit = chunk.data.kit as Record<string, unknown>;
        (storedKit.pads as unknown[])[1] = 'not a pad';

        const restored = fromToasterKitState(chunk);

        expect(restored.pads[0]?.name).toBe('Kick');
        expect(restored.pads[1]?.name).toBe(createDefaultKit().pads[1]?.name);
        expect(restored.pads[2]?.name).toBe('Snare');
    });

    it('drops an activePatternId that names no surviving pattern', () => {
        const kit = createDefaultKit();
        const chunk = toToasterKitState(kit);
        (chunk.data.kit as Record<string, unknown>).activePatternId = 'B7';

        const restored = fromToasterKitState(chunk);

        // Left pointing at a pattern that is not there, the sequencer and the pattern
        // exporter both read `undefined` and silently play nothing.
        expect(restored.patterns.some((pattern) => pattern.id === restored.activePatternId)).toBe(true);
    });

    it('ignores a non-finite number rather than storing it in the kit', () => {
        const kit = createDefaultKit();
        const chunk = toToasterKitState(kit);
        (chunk.data.kit as Record<string, unknown>).swing = 'a lot';

        const restored = fromToasterKitState(chunk);

        expect(restored.swing).toBe(createDefaultKit().swing);
    });
});
