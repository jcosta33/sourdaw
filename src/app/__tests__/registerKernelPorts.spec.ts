/**
 * The kernel ports answer exactly what the core domain answers, and no port
 * answers anything before the composition root registers it.
 *
 * Every case loads a fresh module graph, because each port holds its
 * registration in module state for the life of the realm.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadFreshModules() {
    vi.resetModules();
    const [arrangement, automationStores, command, crdtDocument, transport, transportStores, app] = await Promise.all([
        import('#/modules/Arrangement/useCases'),
        import('#/modules/Automation/stores'),
        import('#/modules/Command/useCases'),
        import('#/modules/CrdtDocument/useCases'),
        import('#/modules/Transport/useCases'),
        import('#/modules/Transport/stores'),
        import('../registerKernelPorts'),
    ]);
    return { arrangement, automationStores, command, crdtDocument, transport, transportStores, app };
}

type FreshModules = Awaited<ReturnType<typeof loadFreshModules>>;

let modules: FreshModules;

// The first load transforms many whole module barrels, which can outlast the
// default hook timeout on a cold cache; each later fresh load reuses that work.
const WARM_UP_TIMEOUT_MS = 60_000;

beforeAll(async () => {
    await loadFreshModules();
}, WARM_UP_TIMEOUT_MS);

beforeEach(async () => {
    modules = await loadFreshModules();
});

describe('registerKernelPorts before registration', () => {
    it('refuses every port read and names the function that registers it', () => {
        const { command, crdtDocument } = modules;
        const reads: [string, () => unknown][] = [
            ['admissionCaller', () => command.legacyInverseReplayAdmission.read('admissionCaller')],
            ['macroCaller', () => command.macroCoreReads.read('macroCaller')],
            ['switchCaller', () => crdtDocument.branchSwitchTransport.read('switchCaller')],
        ];

        for (const [caller, read] of reads) {
            expect(read).toThrow(new RegExp(`^${caller}: .*registerKernelPorts\\(\\) from #/app/registerKernelPorts`));
        }
    });
});

describe('registerKernelPorts after registration', () => {
    beforeEach(() => {
        modules.app.registerKernelPorts();
    });

    it("admits recorded inverses through Arrangement's own legacy trim rule", () => {
        const { arrangement, command } = modules;

        expect(command.legacyInverseReplayAdmission.read('spec').getLegacyTrimInverseReplayFailure).toBe(
            arrangement.getLegacyTrimInverseReplayFailure
        );
    });

    it("reads tempo through Transport's own tempo reads", () => {
        const { command, transportStores } = modules;
        const reads = command.macroCoreReads.read('spec');

        expect(reads.readTempoAtBeat).toBe(transportStores.readTempoAtBeat);
        expect(reads.readTempoMapEditTargets).toBe(transportStores.readTempoMapEditTargets);
    });

    it("reads the automation lanes Automation's store holds now", () => {
        const { automationStores, command } = modules;
        const reads = command.macroCoreReads.read('spec');
        const lane = {
            id: 'lane-1',
            trackId: 'track-1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        };

        automationStores.automationStore.set({ lanes: [lane] });
        expect(reads.readAutomationLanes()).toEqual([lane]);
        automationStores.automationStore.set(null);
        expect(reads.readAutomationLanes()).toBeUndefined();
    });

    it("stops and checks the transport through Transport's own controls", () => {
        const { crdtDocument, transport } = modules;
        const switchTransport = crdtDocument.branchSwitchTransport.read('spec');

        expect(switchTransport.isIdle).toBe(transport.isTransportIdle);
        expect(switchTransport.stop).toBe(transport.stopPlayback);
    });

    it('treats a repeated registration as a no-op', () => {
        const { app, command, crdtDocument } = modules;
        const admission = command.legacyInverseReplayAdmission.read('spec');
        const reads = command.macroCoreReads.read('spec');
        const switchTransport = crdtDocument.branchSwitchTransport.read('spec');

        expect(() => app.registerKernelPorts()).not.toThrow();

        expect(command.legacyInverseReplayAdmission.read('spec')).toBe(admission);
        expect(command.macroCoreReads.read('spec')).toBe(reads);
        expect(crdtDocument.branchSwitchTransport.read('spec')).toBe(switchTransport);
    });

    it('refuses a registration that differs from the registered one', () => {
        const { command, crdtDocument } = modules;
        const admission = command.legacyInverseReplayAdmission.read('spec');
        const reads = command.macroCoreReads.read('spec');
        const switchTransport = crdtDocument.branchSwitchTransport.read('spec');

        expect(() =>
            command.legacyInverseReplayAdmission.configure({ getLegacyTrimInverseReplayFailure: () => null })
        ).toThrow(/legacyInverseReplayAdmission\.configure: .*differs/);
        expect(() => command.macroCoreReads.configure({ ...reads, readAutomationLanes: () => [] })).toThrow(
            /macroCoreReads\.configure: .*differ/
        );
        expect(() => crdtDocument.branchSwitchTransport.configure({ ...switchTransport, isIdle: () => true })).toThrow(
            /branchSwitchTransport\.configure: .*differs/
        );

        expect(command.legacyInverseReplayAdmission.read('spec')).toBe(admission);
        expect(command.macroCoreReads.read('spec')).toBe(reads);
        expect(crdtDocument.branchSwitchTransport.read('spec')).toBe(switchTransport);
    });
});
