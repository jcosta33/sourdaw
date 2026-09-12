import { describe, expect, it } from 'vitest';

import { createDefaultKit, type ToasterKit } from '../../models/ToasterKit';
import { toToasterKitState } from '../../models/ToasterKitState';
import { projectToasterKitToNativePatch } from '../projectToasterKitToNativePatch';

/** `crates/sourdaw-native/src/commands/graph.rs`'s `builtin_named_parameter` shape. */
const ENGINE_PARAM_NAME_SHAPE = /^[A-Za-z0-9_]{1,40}$/;

function withPad2EngineType(engineType: ToasterKit['pads'][number]['engineType']): ToasterKit {
    const kit = createDefaultKit();
    return { ...kit, pads: kit.pads.map((pad, index) => (index === 2 ? { ...pad, engineType } : pad)) };
}

describe('projectToasterKitToNativePatch', () => {
    it("spells the kit's pad and global controls in the names ToasterBody addresses", () => {
        const kit = withPad2EngineType('kick-808');

        const patch = projectToasterKitToNativePatch({ deviceState: toToasterKitState(kit) });

        // `TOASTER_ENGINE_MAP['kick-808']`.
        expect(patch.pad2_engine_type).toBe(13);
        expect(patch.pad2_volume).toBe(0.8);
        expect(patch.master_gain).toBe(1);
        // Milliseconds, not seconds: the native door converts at its own door,
        // exactly as the worklet's `toEngineKitParamValue` does for the web path.
        expect(patch.delay_time).toBe(kit.delayTime);
    });

    it('produces only names the wire parameter carrier admits', () => {
        const patch = projectToasterKitToNativePatch({ deviceState: toToasterKitState(createDefaultKit()) });

        expect(Object.keys(patch).length).toBeGreaterThan(0);
        for (const name of Object.keys(patch)) {
            expect(name).toMatch(ENGINE_PARAM_NAME_SHAPE);
        }
    });

    // The longest name a default kit's projection ever produces, named so a
    // future field that pushes past it is caught here rather than by a batch
    // the native door silently refuses whole.
    it('keeps the longest name a default kit produces inside the wire limit', () => {
        const patch = projectToasterKitToNativePatch({ deviceState: toToasterKitState(createDefaultKit()) });

        const longest = Object.keys(patch).reduce((a, b) => (b.length > a.length ? b : a), '');

        expect(longest).toBe('pad10_filter_resonance');
        expect(longest.length).toBeLessThanOrEqual(40);
    });
});
