/**
 * The device engine ports answer exactly what the device module answers, and
 * no port answers anything before the composition root registers it.
 *
 * Every case loads a fresh module graph, because each port holds its
 * registration in module state for the life of the realm.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadFreshModules() {
    vi.resetModules();
    const [arrangement, audioEngine, transport, fermenter, app] = await Promise.all([
        import('#/modules/Arrangement/useCases'),
        import('#/modules/AudioEngine/useCases'),
        import('#/modules/Transport/useCases'),
        import('#/modules/Fermenter/useCases'),
        import('../registerDeviceEnginePorts'),
    ]);
    return { arrangement, audioEngine, transport, fermenter, app };
}

type FreshModules = Awaited<ReturnType<typeof loadFreshModules>>;

let modules: FreshModules;

// The first load transforms four whole module barrels, which can outlast the
// default hook timeout on a cold cache; each later fresh load reuses that work.
const WARM_UP_TIMEOUT_MS = 60_000;

beforeAll(async () => {
    await loadFreshModules();
}, WARM_UP_TIMEOUT_MS);

beforeEach(async () => {
    modules = await loadFreshModules();
});

describe('registerDeviceEnginePorts before registration', () => {
    it('refuses every port read and names the function that registers it', () => {
        const { arrangement, audioEngine, transport } = modules;

        expect(() => audioEngine.nativeBodyVocabularyRegistry.read('vocabularyCaller', 'fermenter')).toThrow(
            /^vocabularyCaller: .*registerDeviceEnginePorts\(\) from #\/app\/registerDeviceEnginePorts/
        );
        expect(() => transport.deviceRuntimeParameterWriters.read('writerCaller', 'fermenter')).toThrow(
            /^writerCaller: .*registerDeviceEnginePorts\(\) from #\/app\/registerDeviceEnginePorts/
        );
        expect(() => arrangement.deviceFactoryPresetSources.read('presetCaller')).toThrow(
            /^presetCaller: .*registerDeviceEnginePorts\(\) from #\/app\/registerDeviceEnginePorts/
        );
    });

    it('refuses the preset library rather than listing it without the device presets', () => {
        expect(() => modules.arrangement.getFactoryPresets()).toThrow(/^getFactoryPresets: .*not registered/);
    });
});

describe('registerDeviceEnginePorts after registration', () => {
    beforeEach(() => {
        modules.app.registerDeviceEnginePorts();
    });

    it("answers Fermenter's native body vocabulary exactly as Fermenter's own mapping does", () => {
        const { audioEngine, fermenter } = modules;
        const vocabulary = audioEngine.nativeBodyVocabularyRegistry.read('spec', 'fermenter');
        if (vocabulary === null) {
            throw new Error('no Fermenter vocabulary registered');
        }

        expect(fermenter.FERMENTER_PARAMS.length).toBeGreaterThan(0);
        for (const param of fermenter.FERMENTER_PARAMS) {
            expect(vocabulary.parameterName(param.id)).toBe(
                fermenter.mapFermenterParamToDspParam({ paramId: param.id })
            );
            expect(vocabulary.addressesParameter(param.id)).toBe(true);
        }
        // Macro slots live in one `macros` array, never as keyed values, and a
        // persisted non-parameter entry is no parameter at all.
        expect(vocabulary.addressesParameter('macro0')).toBe(false);
        expect(vocabulary.addressesParameter('presetName')).toBe(false);

        const values: Record<string, unknown> = {
            ...Object.fromEntries(fermenter.FERMENTER_PARAMS.map((param, index) => [param.id, param.min + index])),
            macros: [0.25, 0.5, 0.75],
            presetName: 'Not a parameter',
        };
        const projected = vocabulary.projectPatch(values);
        expect(projected[fermenter.mapFermenterParamToDspParam({ paramId: 'macro2' })]).toBe(0.75);
        expect(projected).not.toHaveProperty('presetName');
        expect(projected).toEqual(fermenter.mapFermenterPatchToDspPatch({ patch: values }));
    });

    it("answers Fermenter's automation writer with Fermenter's runtime write and engine names", () => {
        const { transport, fermenter } = modules;
        const writer = transport.deviceRuntimeParameterWriters.read('spec', 'fermenter');
        if (writer === null) {
            throw new Error('no Fermenter runtime writer registered');
        }

        expect(writer.write).toBe(fermenter.applyFermenterRuntimeParam);
        for (const param of fermenter.FERMENTER_PARAMS) {
            expect(writer.engineParameterName(param.id)).toBe(
                fermenter.mapFermenterParamToDspParam({ paramId: param.id })
            );
        }
    });

    it('answers no vocabulary and no writer for a device type no module registered', () => {
        expect(modules.audioEngine.nativeBodyVocabularyRegistry.read('spec', 'grand-boule')).toBeNull();
        expect(modules.transport.deviceRuntimeParameterWriters.read('spec', 'grand-boule')).toBeNull();
    });

    it("lists Fermenter's factory presets, in Fermenter's order, inside the preset library", () => {
        const { arrangement, fermenter } = modules;
        const expected = fermenter.getFermenterFactoryPresets();

        expect(expected.length).toBeGreaterThan(0);
        expect(arrangement.deviceFactoryPresetSources.read('spec').flatMap((source) => source.presets())).toEqual(
            expected
        );

        const fermenterIds = new Set(expected.map((preset) => preset.id));
        const libraryFermenterPresets = arrangement.getFactoryPresets().filter((preset) => fermenterIds.has(preset.id));
        expect(libraryFermenterPresets).toEqual(expected);
    });

    it('treats a repeated registration as a no-op', () => {
        const { arrangement, audioEngine, transport, app } = modules;
        const vocabulary = audioEngine.nativeBodyVocabularyRegistry.read('spec', 'fermenter');
        const writer = transport.deviceRuntimeParameterWriters.read('spec', 'fermenter');
        const sources = arrangement.deviceFactoryPresetSources.read('spec');

        expect(() => app.registerDeviceEnginePorts()).not.toThrow();

        expect(audioEngine.nativeBodyVocabularyRegistry.read('spec', 'fermenter')).toBe(vocabulary);
        expect(transport.deviceRuntimeParameterWriters.read('spec', 'fermenter')).toBe(writer);
        expect(arrangement.deviceFactoryPresetSources.read('spec')).toEqual(sources);
    });

    it('refuses a registration that differs from the registered one', () => {
        const { arrangement, audioEngine, transport, fermenter } = modules;

        expect(() =>
            audioEngine.nativeBodyVocabularyRegistry.configure({
                fermenter: {
                    parameterName: (paramId) => paramId,
                    projectPatch: () => ({}),
                    addressesParameter: () => true,
                },
            })
        ).toThrow(/vocabulary for 'fermenter' differs/);
        expect(() =>
            transport.deviceRuntimeParameterWriters.configure({
                fermenter: {
                    write: fermenter.applyFermenterRuntimeParam,
                    engineParameterName: (paramId) => paramId,
                },
            })
        ).toThrow(/writer for 'fermenter' differs/);
        expect(() =>
            arrangement.deviceFactoryPresetSources.configure([
                { module: 'Fermenter', presets: fermenter.getFermenterFactoryPresets },
            ])
        ).toThrow(/source 'Fermenter' differs/);
    });
});
