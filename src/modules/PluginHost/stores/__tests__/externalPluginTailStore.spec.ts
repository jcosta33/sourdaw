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
        writeExternalPluginTail('inst-1', 96_000);

        reviseExternalPluginTail('inst-1', { tailSamples: 240_000, sequence: 5 });
        reviseExternalPluginTail('inst-1', { tailSamples: 300_000, sequence: 6 });

        expect(tailOf('inst-1')).toBe(300_000);
    });

    it('ignores a second figure that carries the same sequence as the one applied', () => {
        writeExternalPluginTail('inst-1', 96_000);

        reviseExternalPluginTail('inst-1', { tailSamples: 240_000, sequence: 5 });
        reviseExternalPluginTail('inst-1', { tailSamples: 300_000, sequence: 5 });

        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('lets a figure with a lower sequence land after the instance is seeded again', () => {
        writeExternalPluginTail('inst-1', 96_000);
        reviseExternalPluginTail('inst-1', { tailSamples: 240_000, sequence: 9 });

        // A fresh load of the instance: the load's own figure outranks nothing the host sends next.
        writeExternalPluginTail('inst-1', 50_000);
        reviseExternalPluginTail('inst-1', { tailSamples: 300_000, sequence: 4 });

        expect(tailOf('inst-1')).toBe(300_000);
    });
});
