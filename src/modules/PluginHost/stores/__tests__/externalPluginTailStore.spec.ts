import { beforeEach, describe, expect, it } from 'vitest';

import {
    externalPluginTailStore,
    resetExternalPluginTails,
    reviseExternalPluginTail,
    writeExternalPluginTail,
} from '../externalPluginTailStore';

function tailOf(instanceId: string): number | undefined {
    return externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId];
}

// The sequence rule on its own, below the use cases: the host numbers every
// figure it reports, and a figure at or below the highest applied is older.
describe('external plugin tail store sequence rule', () => {
    beforeEach(() => {
        resetExternalPluginTails();
    });

    it('applies a figure with a larger sequence over one already applied', () => {
        writeExternalPluginTail('inst-1', { tailSamples: 96_000, sequence: 1 });

        reviseExternalPluginTail('inst-1', { tailSamples: 240_000, sequence: 5 });
        reviseExternalPluginTail('inst-1', { tailSamples: 300_000, sequence: 6 });

        expect(tailOf('inst-1')).toBe(300_000);
    });

    it('ignores a second figure that carries the same sequence as the one applied', () => {
        writeExternalPluginTail('inst-1', { tailSamples: 96_000, sequence: 1 });

        reviseExternalPluginTail('inst-1', { tailSamples: 240_000, sequence: 5 });
        reviseExternalPluginTail('inst-1', { tailSamples: 300_000, sequence: 5 });

        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('ignores a figure the previous load of the same instance id published after the successor seeded', () => {
        writeExternalPluginTail('inst-1', { tailSamples: 96_000, sequence: 1 });
        reviseExternalPluginTail('inst-1', { tailSamples: 240_000, sequence: 9 });

        // The successor's load read took sequence 12; the predecessor's event, numbered 10, is still in flight.
        writeExternalPluginTail('inst-1', { tailSamples: 50_000, sequence: 12 });
        reviseExternalPluginTail('inst-1', { tailSamples: 300_000, sequence: 10 });

        expect(tailOf('inst-1')).toBe(50_000);
    });

    it('applies a figure numbered after the successor load read', () => {
        writeExternalPluginTail('inst-1', { tailSamples: 96_000, sequence: 12 });
        reviseExternalPluginTail('inst-1', { tailSamples: 300_000, sequence: 13 });

        expect(tailOf('inst-1')).toBe(300_000);
    });

    it('ignores a figure numbered at the load read itself', () => {
        writeExternalPluginTail('inst-1', { tailSamples: 96_000, sequence: 12 });
        reviseExternalPluginTail('inst-1', { tailSamples: 300_000, sequence: 12 });

        expect(tailOf('inst-1')).toBe(96_000);
    });
});
