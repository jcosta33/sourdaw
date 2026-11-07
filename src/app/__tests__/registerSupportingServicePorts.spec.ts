/**
 * The supporting service ports answer exactly what the supporting module
 * answers, and no port answers anything before the composition root
 * registers it.
 *
 * Every case loads a fresh module graph, because each port holds its
 * registration in module state for the life of the realm.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadFreshModules() {
    vi.resetModules();
    const [
        arrangement,
        browserAi,
        collaboration,
        collaborationStores,
        commandInterface,
        controlSurface,
        controlSurfaceStores,
        cvGateStores,
        midi,
        midiStores,
        onboarding,
        project,
        sampleLibrary,
        sampleLibraryStores,
        app,
    ] = await Promise.all([
        import('#/modules/Arrangement/useCases'),
        import('#/modules/BrowserAi/useCases'),
        import('#/modules/Collaboration/useCases'),
        import('#/modules/Collaboration/stores'),
        import('#/modules/CommandInterface/useCases'),
        import('#/modules/ControlSurface/useCases'),
        import('#/modules/ControlSurface/stores'),
        import('#/modules/CvGate/stores'),
        import('#/modules/MIDI/useCases'),
        import('#/modules/MIDI/stores'),
        import('#/modules/Onboarding/useCases'),
        import('#/modules/Project/useCases'),
        import('#/modules/SampleLibrary/useCases'),
        import('#/modules/SampleLibrary/stores'),
        import('../registerSupportingServicePorts'),
    ]);
    return {
        arrangement,
        browserAi,
        collaboration,
        collaborationStores,
        commandInterface,
        controlSurface,
        controlSurfaceStores,
        cvGateStores,
        midi,
        midiStores,
        onboarding,
        project,
        sampleLibrary,
        sampleLibraryStores,
        app,
    };
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

describe('registerSupportingServicePorts before registration', () => {
    it('refuses every port read and names the function that registers it', () => {
        const { arrangement, browserAi, commandInterface, midi, project } = modules;
        const reads: [string, () => unknown][] = [
            ['transferCaller', () => arrangement.collaborationAssetTransfer.read('transferCaller')],
            ['learnCaller', () => midi.midiLearnRouting.read('learnCaller')],
            ['projectionCaller', () => project.midiLearnProjection.read('projectionCaller')],
            ['cvGateCaller', () => project.cvGateProjection.read('cvGateCaller')],
            ['noteEditCaller', () => browserAi.midiNoteEditSource.read('noteEditCaller')],
            ['tourCaller', () => commandInterface.onboardingTourLauncher.read('tourCaller')],
            ['discoveryCaller', () => project.sampleDiscoverySource.read('discoveryCaller')],
        ];

        for (const [caller, read] of reads) {
            expect(read).toThrow(
                new RegExp(
                    `^${caller}: .*registerSupportingServicePorts\\(\\) from #/app/registerSupportingServicePorts`
                )
            );
        }
    });
});

describe('registerSupportingServicePorts after registration', () => {
    beforeEach(() => {
        modules.app.registerSupportingServicePorts();
    });

    it("hands imports and playback Collaboration's own asset runtime", () => {
        const { arrangement, collaboration } = modules;
        const transfer = arrangement.collaborationAssetTransfer.read('spec');

        expect(transfer.current).toBe(collaboration.getAssetTransfer);
    });

    it('reports a session only while Collaboration has one enabled', () => {
        const { arrangement, collaborationStores } = modules;
        const transfer = arrangement.collaborationAssetTransfer.read('spec');
        const idle = collaborationStores.collaborationStore.value;
        if (!idle) {
            throw new Error('the collaboration store starts with its initial state');
        }

        expect(transfer.isSessionActive()).toBe(false);
        collaborationStores.collaborationStore.set({ ...idle, isEnabled: true });
        expect(transfer.isSessionActive()).toBe(true);
        collaborationStores.collaborationStore.set(null);
        expect(transfer.isSessionActive()).toBe(false);
    });

    it("routes live controller messages through ControlSurface's own MIDI learn", () => {
        const { controlSurface, midi } = modules;
        const routing = midi.midiLearnRouting.read('spec');

        expect(routing.getMidiLearnState).toBe(controlSurface.getMidiLearnState);
        expect(routing.completeMidiLearn).toBe(controlSurface.completeMidiLearn);
        expect(routing.applyMidiMappings).toBe(controlSurface.handleMidiMessage);
    });

    it("saves ControlSurface's live MIDI learn state", () => {
        const { controlSurfaceStores, project } = modules;
        const projection = project.midiLearnProjection.read('spec');
        const initial = controlSurfaceStores.midiLearnStore.value;
        if (!initial) {
            throw new Error('the MIDI learn store starts with its initial state');
        }

        expect(projection.readMidiLearn()).toBe(initial);
        const learned = { ...initial, mappings: [] };
        controlSurfaceStores.midiLearnStore.set(learned);
        expect(projection.readMidiLearn()).toBe(learned);
        controlSurfaceStores.midiLearnStore.set(null);
        expect(projection.readMidiLearn()).toBeNull();
    });

    it("saves CvGate's live CV/gate state", () => {
        const { cvGateStores, project } = modules;
        const projection = project.cvGateProjection.read('spec');
        const initial = cvGateStores.cvGateStore.value;

        expect(projection.readCvGate()).toBe(initial);
        const withOutput = { ...cvGateStores.defaultCvGateState, clockDivision: 4 };
        cvGateStores.cvGateStore.set(withOutput);
        expect(projection.readCvGate()).toBe(withOutput);
        cvGateStores.cvGateStore.set(null);
        expect(projection.readCvGate()).toBeNull();
    });

    it("hears every MIDI note state MIDI's own store publishes", () => {
        const { browserAi, midiStores } = modules;
        const source = browserAi.midiNoteEditSource.read('spec');
        const heard: unknown[] = [];

        const unsubscribe = source.subscribe((next) => heard.push(next));
        const edited = { ...midiStores.defaultMidiStoreState, notesByClipId: { clip: [] } };
        midiStores.midiStore.set(edited);
        const heardWhileSubscribed = [...heard];
        unsubscribe();
        midiStores.midiStore.set({ ...midiStores.defaultMidiStoreState, notesByClipId: {} });

        expect(heardWhileSubscribed.at(-1)).toBe(edited);
        expect(heard).toEqual(heardWhileSubscribed);
    });

    it("starts Onboarding's own tour from the palette", () => {
        const { commandInterface, onboarding } = modules;

        expect(commandInterface.onboardingTourLauncher.read('spec').startTour).toBe(onboarding.startOnboardingTour);
    });

    it("discovers samples through SampleLibrary's own library state and catalog search", () => {
        const { project, sampleLibrary, sampleLibraryStores } = modules;
        const source = project.sampleDiscoverySource.read('spec');

        expect(source.readLibrary()).toBe(sampleLibraryStores.libraryStore.value);
        expect(source.searchCatalog).toBe(sampleLibrary.searchAgentCatalog);
    });

    it('treats a repeated registration as a no-op', () => {
        const { arrangement, browserAi, commandInterface, midi, project, app } = modules;
        const transfer = arrangement.collaborationAssetTransfer.read('spec');
        const routing = midi.midiLearnRouting.read('spec');
        const projection = project.midiLearnProjection.read('spec');
        const cvGate = project.cvGateProjection.read('spec');
        const noteEdits = browserAi.midiNoteEditSource.read('spec');
        const tour = commandInterface.onboardingTourLauncher.read('spec');
        const source = project.sampleDiscoverySource.read('spec');

        expect(() => app.registerSupportingServicePorts()).not.toThrow();

        expect(arrangement.collaborationAssetTransfer.read('spec')).toBe(transfer);
        expect(midi.midiLearnRouting.read('spec')).toBe(routing);
        expect(project.midiLearnProjection.read('spec')).toBe(projection);
        expect(project.cvGateProjection.read('spec')).toBe(cvGate);
        expect(browserAi.midiNoteEditSource.read('spec')).toBe(noteEdits);
        expect(commandInterface.onboardingTourLauncher.read('spec')).toBe(tour);
        expect(project.sampleDiscoverySource.read('spec')).toBe(source);
    });

    it('refuses a registration that differs from the registered one', () => {
        const { arrangement, browserAi, commandInterface, midi, project } = modules;
        const transfer = arrangement.collaborationAssetTransfer.read('spec');
        const routing = midi.midiLearnRouting.read('spec');
        const projection = project.midiLearnProjection.read('spec');
        const cvGate = project.cvGateProjection.read('spec');
        const noteEdits = browserAi.midiNoteEditSource.read('spec');
        const tour = commandInterface.onboardingTourLauncher.read('spec');
        const source = project.sampleDiscoverySource.read('spec');

        expect(() =>
            arrangement.collaborationAssetTransfer.configure({ ...transfer, isSessionActive: () => true })
        ).toThrow(/collaborationAssetTransfer\.configure: .*differs/);
        expect(() => midi.midiLearnRouting.configure({ ...routing, applyMidiMappings: () => undefined })).toThrow(
            /midiLearnRouting\.configure: .*differs/
        );
        expect(() => project.midiLearnProjection.configure({ readMidiLearn: () => null })).toThrow(
            /midiLearnProjection\.configure: .*differs/
        );
        expect(() => project.cvGateProjection.configure({ readCvGate: () => null })).toThrow(
            /cvGateProjection\.configure: .*differs/
        );
        expect(() => browserAi.midiNoteEditSource.configure({ subscribe: () => () => undefined })).toThrow(
            /midiNoteEditSource\.configure: .*differs/
        );
        expect(() => commandInterface.onboardingTourLauncher.configure({ startTour: () => undefined })).toThrow(
            /onboardingTourLauncher\.configure: .*differs/
        );
        expect(() => project.sampleDiscoverySource.configure({ ...source, readLibrary: () => null })).toThrow(
            /sampleDiscoverySource\.configure: .*differs/
        );

        expect(arrangement.collaborationAssetTransfer.read('spec')).toBe(transfer);
        expect(midi.midiLearnRouting.read('spec')).toBe(routing);
        expect(project.midiLearnProjection.read('spec')).toBe(projection);
        expect(project.cvGateProjection.read('spec')).toBe(cvGate);
        expect(browserAi.midiNoteEditSource.read('spec')).toBe(noteEdits);
        expect(commandInterface.onboardingTourLauncher.read('spec')).toBe(tour);
        expect(project.sampleDiscoverySource.read('spec')).toBe(source);
    });
});
