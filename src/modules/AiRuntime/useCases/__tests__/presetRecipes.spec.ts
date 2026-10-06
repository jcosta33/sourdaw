import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    getAgentPresetDiscoveryManifest,
    getFactoryPresets,
    getMixRecipeCatalog,
} from '#/modules/Arrangement/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { querySemanticProject } from '#/modules/Project/useCases';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { executeRecipeExpansion } from '../executeRecipeExpansion';
import { getProjectContext } from '../getProjectContext';

import { createTrack } from './trackFixture';

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    querySemanticProject: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return { ...original, getMixRecipeCatalog: vi.fn(original.getMixRecipeCatalog) };
});

type SoundPreset = ReturnType<typeof getFactoryPresets>[number];
type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];

type DiscoveryCandidate = {
    id: string;
    origin?: { kind: string; presetId: string; presetVersion: string; tags: string[] };
    roles: string[];
    steps: {
        kind: string;
        deviceType: string;
        parameters: { paramId: string; minimum: number; maximum: number }[];
        existingDevices: { id: string; bypassed: boolean }[];
    }[];
};
type DiscoveryData = { total: number; candidates: DiscoveryCandidate[] };

type ExpansionData = {
    recipeId: string;
    commands: { name: string; arguments: Record<string, unknown> }[];
    values: { step: number; paramId: string; value: number; minimum: number; maximum: number; source: string }[];
};

/** One device of a chain and the values it stores, in the order the chain stores them. */
type ChainDevice = { deviceType: string; values: readonly (readonly [string, number])[] };

const REVISION = 'revision-preset-recipes';

function factoryPreset(id: string): SoundPreset {
    const preset = getFactoryPresets().find((candidate) => candidate.id === id);
    if (preset === undefined) {
        throw new Error(`factory preset ${id} is not in the library`);
    }
    return preset;
}

function chainOf(preset: SoundPreset): ChainDevice[] {
    return preset.devices.map((device) => ({
        deviceType: device.type,
        values: Object.entries(device.parameterValues),
    }));
}

/** A two-device vocal chain the factory library does not hold, so the ordering rows read a known shape. */
const TWO_DEVICE_CHAIN: readonly ChainDevice[] = [
    {
        deviceType: 'builtin-eq',
        values: [
            ['eq-low-gain', 2],
            ['eq-low-freq', 150],
        ],
    },
    {
        deviceType: 'builtin-compressor',
        values: [
            ['comp-threshold', -18],
            ['comp-ratio', 3],
        ],
    },
];

/** A preset-origin recipe holding the chain as exact windows, the shape the owner publishes. */
function presetRecipeOf(id: string, chain: readonly ChainDevice[]): MixRecipe {
    return {
        id,
        origin: { kind: 'preset', presetId: id, presetVersion: 'preset-v1:00000000', tags: ['vocal', 'glue'] },
        descriptor: 'glued',
        roles: ['vocal'],
        title: 'Test preset chain',
        steps: chain.map((device) => ({
            kind: 'insert',
            deviceType: device.deviceType,
            parameters: device.values.map(([paramId, value]) => ({ paramId, minimum: value, maximum: value })),
        })),
        prerequisites: [],
        contraindications: [],
        metrics: [],
        source: 'test',
    };
}

function offerRecipes(...extra: MixRecipe[]): void {
    const catalog = getMixRecipeCatalog();
    vi.mocked(getMixRecipeCatalog).mockReturnValue({ ...catalog, recipes: [...catalog.recipes, ...extra] });
}

function installedDevice(id: string, type: string): Track['devices'][number] {
    return { id, name: type, type, bypassed: false, parameterValues: {} };
}

function setTracks(tracks: Track[]): void {
    trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
}

function setLeadVocal(devices: Track['devices'] = []): void {
    setTracks([createTrack({ id: 'lead-vocal-1', name: 'Lead Vocal', devices })]);
}

function recipeExpansionTool(): NonNullable<Parameters<typeof runApplicationOwnedToolLoop>[0]['recipe']> {
    return {
        toolName: 'recipe.expand',
        revision: REVISION,
        execute: (call: ToolCallResult, context) =>
            executeRecipeExpansion({
                call,
                callId: context.callId,
                turn: context.turn,
                ordinal: context.ordinal,
                context: getProjectContext(),
                revision: REVISION,
            }),
    };
}

async function runTool(
    loopId: string,
    name: 'recipe.discover' | 'recipe.expand',
    args: Record<string, unknown>
): Promise<ApplicationToolReceipt> {
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({ status: 'complete' as const, toolCalls: [{ id: 'call-1', name, arguments: args }] })
        .mockResolvedValueOnce({ status: 'complete' as const, toolCalls: [] });
    const result = await runApplicationOwnedToolLoop({
        loopId,
        terminalToolNames: new Set(['setTempo']),
        requestTurn,
        recipe: recipeExpansionTool(),
    });
    if (result.status !== 'complete') {
        throw new Error(`Expected the loop to complete, got: ${result.reason}`);
    }
    const receipt = result.receipts.find((entry) => entry.callId === 'call-1');
    if (!receipt) {
        throw new Error(`${name} receipt was not recorded`);
    }
    return receipt;
}

async function discover(loopId: string, args: Record<string, unknown>): Promise<DiscoveryData> {
    const receipt = await runTool(loopId, 'recipe.discover', { limit: 8, ...args });
    expect(receipt.status).toBe('success');
    return receipt.data as DiscoveryData;
}

async function expand(loopId: string, args: Record<string, unknown>): Promise<ApplicationToolReceipt> {
    return runTool(loopId, 'recipe.expand', args);
}

function readExpansion(receipt: ApplicationToolReceipt): ExpansionData {
    expect(receipt.status).toBe('success');
    return receipt.data as ExpansionData;
}

/** The commands a stored chain must lower to on `lead-vocal-1`, written out from the chain itself. */
function expectedCommands(chain: readonly ChainDevice[], afterDeviceId: string | null) {
    const commands: { name: string; arguments: Record<string, unknown> }[] = [];
    for (const [index, device] of chain.entries()) {
        const binding = `recipe-1-${String(index)}`;
        const after = index === 0 ? afterDeviceId : `$recipe-1-${String(index - 1)}`;
        const addArguments: Record<string, unknown> = { trackId: 'lead-vocal-1', deviceType: device.deviceType };
        if (after !== null) {
            addArguments.afterDeviceId = after;
        }
        addArguments.binding = binding;
        commands.push({ name: 'addDevice', arguments: addArguments });
        for (const [paramId, value] of device.values) {
            commands.push({ name: 'setDeviceParameter', arguments: { deviceId: `$${binding}`, paramId, value } });
        }
    }
    return commands;
}

describe('preset recipes', () => {
    beforeEach(() => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] },
            revisionToken: 'revision-1',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 0 },
            items: [],
            nextCursor: null,
            warnings: [],
        });
        setTracks([]);
    });

    afterEach(() => {
        vi.mocked(getMixRecipeCatalog).mockRestore();
        setTracks([]);
        projectStore.set(structuredClone(defaultProjectStoreState));
    });

    describe('recipe.discover', () => {
        // Red when factory chain presets stop reaching the catalog the planner searches.
        it('offers a tagged vocal chain preset under its descriptor term and role, showing its origin', async () => {
            const preset = factoryPreset('fx-comp-vocal-glue');
            const manifestEntry = getAgentPresetDiscoveryManifest().find((entry) => entry.id === preset.id);

            const data = await discover('loop-vocal-preset', { descriptors: ['glue'], role: 'vocal' });

            const candidate = data.candidates.find((entry) => entry.id === 'preset:fx-comp-vocal-glue:glued');
            expect(candidate).toBeDefined();
            expect(candidate?.origin).toEqual({
                kind: 'preset',
                presetId: preset.id,
                presetVersion: manifestEntry?.version,
                tags: preset.tags,
            });
            expect(candidate?.roles).toContain('vocal');
            expect(candidate?.steps.map((step) => step.deviceType)).toEqual(
                preset.devices.map((device) => device.type)
            );
            expect(candidate?.steps.flatMap((step) => step.parameters)).toEqual(
                chainOf(preset).flatMap((device) =>
                    device.values.map(([paramId, value]) => ({ paramId, minimum: value, maximum: value }))
                )
            );
        });

        it('keeps a preset recipe to the roles its tags and category name', async () => {
            const wrongRole = await discover('loop-preset-wrong-role', { descriptors: ['glue'], role: 'drums' });
            const rightRole = await discover('loop-preset-right-role', { descriptors: ['punch'], role: 'drums' });

            expect(wrongRole.candidates.map((entry) => entry.id)).not.toContain('preset:fx-comp-vocal-glue:glued');
            expect(rightRole.candidates.map((entry) => entry.id)).toContain('preset:fx-comp-drum-bus:punchy');
        });

        it('resolves the role from a target track and offers a preset whose devices the chain already holds', async () => {
            setLeadVocal([installedDevice('device-comp-1', 'builtin-compressor')]);

            const data = await discover('loop-preset-target', { descriptors: ['glue'], targetId: 'lead-vocal-1' });

            const candidate = data.candidates.find((entry) => entry.id === 'preset:fx-comp-vocal-glue:glued');
            expect(candidate?.steps[0]?.existingDevices).toEqual([{ id: 'device-comp-1', bypassed: false }]);
        });

        // Red when the page limit stops applying to preset recipes beside authored ones.
        it('applies the limit across authored and preset recipes, authored first', async () => {
            const page = await discover('loop-preset-limit', { descriptors: ['glue'], role: 'vocal', limit: 1 });

            expect(page.total).toBeGreaterThan(1);
            expect(page.candidates).toHaveLength(1);
            expect(page.candidates[0]?.origin).toBeUndefined();
        });

        // Red when a preset the expander would refuse for size is still offered to the planner.
        it('withholds a preset recipe that expands past the batch ceiling and says so', async () => {
            const receipt = await runTool('loop-preset-oversize', 'recipe.discover', {
                descriptors: ['warm'],
                role: 'guitar',
                limit: 8,
            });

            const data = receipt.data as DiscoveryData;
            expect(data.candidates.map((entry) => entry.id)).not.toContain('preset:fx-chain-guitar-clean:warm');
            expect(receipt.warnings.join(' ')).toContain('withheld');
        });
    });

    describe('recipe.expand', () => {
        // Red when a preset recipe stops lowering to the stored chain, in order, through recipe.expand.
        it('lowers a multi-device chain to one addDevice per device in order and the stored values', async () => {
            offerRecipes(presetRecipeOf('preset:two-device:glued', TWO_DEVICE_CHAIN));
            setLeadVocal([installedDevice('device-existing-1', 'builtin-limiter')]);

            const data = readExpansion(
                await expand('loop-expand-chain', { recipeId: 'preset:two-device:glued', targetId: 'lead-vocal-1' })
            );

            expect(data.commands).toEqual(expectedCommands(TWO_DEVICE_CHAIN, 'device-existing-1'));
            expect(data.values.every((entry) => entry.source === 'midpoint')).toBe(true);
            expect(data.values.every((entry) => entry.minimum === entry.value && entry.maximum === entry.value)).toBe(
                true
            );
        });

        // Red when an exact window is rounded to the midpoint's precision, so a published value is refused.
        it('offers a preset storing more than twelve significant digits and expands it to exactly that value', async () => {
            const stored = 20 * Math.log10(0.5);
            const chain: ChainDevice[] = [{ deviceType: 'builtin-compressor', values: [['comp-threshold', stored]] }];
            offerRecipes(presetRecipeOf('preset:long-precision:glued', chain));
            setLeadVocal();

            const offered = await discover('loop-long-precision-discover', { descriptors: ['glue'], role: 'vocal' });
            const data = readExpansion(
                await expand('loop-long-precision-expand', {
                    recipeId: 'preset:long-precision:glued',
                    targetId: 'lead-vocal-1',
                })
            );

            expect(stored.toPrecision(17)).not.toBe(Number(stored.toPrecision(12)).toPrecision(17));
            expect(offered.candidates.map((entry) => entry.id)).toContain('preset:long-precision:glued');
            expect(data.commands).toEqual(expectedCommands(chain, null));
            expect(data.values[0]?.value).toBe(stored);
        });

        it('lowers a factory preset to the values it stores', async () => {
            const chain = chainOf(factoryPreset('fx-comp-vocal-glue'));
            setLeadVocal();

            const data = readExpansion(
                await expand('loop-expand-factory', {
                    recipeId: 'preset:fx-comp-vocal-glue:glued',
                    targetId: 'lead-vocal-1',
                })
            );

            expect(data.commands).toEqual(expectedCommands(chain, null));
        });

        // Red when a preset recipe gets its own expansion path: the same chain, authored, must lower identically.
        it('lowers a preset recipe exactly as it lowers the same steps held by an authored recipe', async () => {
            const preset = presetRecipeOf('preset:two-device:glued', TWO_DEVICE_CHAIN);
            const handBuilt = {
                id: 'hand-built-vocal-chain',
                descriptor: preset.descriptor,
                roles: preset.roles,
                title: preset.title,
                steps: preset.steps,
                prerequisites: preset.prerequisites,
                contraindications: preset.contraindications,
                metrics: preset.metrics,
                source: preset.source,
            };
            offerRecipes(preset, handBuilt);
            setLeadVocal();

            const fromPreset = readExpansion(
                await expand('loop-same-path-preset', { recipeId: preset.id, targetId: 'lead-vocal-1' })
            );
            const fromHandBuilt = readExpansion(
                await expand('loop-same-path-hand', { recipeId: handBuilt.id, targetId: 'lead-vocal-1' })
            );

            expect(fromPreset.commands).toEqual(fromHandBuilt.commands);
            expect(fromPreset.values).toEqual(fromHandBuilt.values);
        });

        it('refuses a supplied value that is not the one the preset stores', async () => {
            setLeadVocal();

            const receipt = await expand('loop-expand-supplied', {
                recipeId: 'preset:fx-comp-vocal-glue:glued',
                targetId: 'lead-vocal-1',
                values: [{ step: 0, paramId: 'comp-ratio', value: 7.5 }],
            });

            expect(receipt.status).toBe('failure');
            expect(receipt.error?.safeMessage).toContain('outside its window');
        });

        // Red when a stored value the parameter cannot hold is written as a different setting instead of refused.
        it('refuses a stored value its stepped parameter cannot represent', async () => {
            offerRecipes(
                presetRecipeOf('preset:unrepresentable:glued', [
                    { deviceType: 'builtin-bitcrusher', values: [['crush-bits', 1.4]] },
                ])
            );
            setLeadVocal();

            const receipt = await expand('loop-expand-unrepresentable', {
                recipeId: 'preset:unrepresentable:glued',
                targetId: 'lead-vocal-1',
            });

            expect(receipt.status).toBe('failure');
            expect(receipt.error?.safeMessage).toContain('no legal setting');
        });

        it('refuses a preset that expands past the batch ceiling with the ordinary size refusal', async () => {
            setTracks([createTrack({ id: 'guitar-1', name: 'Guitar' })]);

            const receipt = await expand('loop-expand-oversize', {
                recipeId: 'preset:fx-chain-guitar-clean:warm',
                targetId: 'guitar-1',
                role: 'guitar',
            });

            expect(receipt.status).toBe('failure');
            expect(receipt.error?.safeMessage).toContain('24 commands');
        });
    });

    describe('presets that name no descriptor or no role, or are not effect chains', () => {
        // Red when a preset is published although its tags name no descriptor, nothing names a role, or it is an instrument.
        it.each([
            ['fx-chain-vocal-strip', 'tagged for a vocal but names no descriptor'],
            ['fx-eq-high-cut', 'names descriptors but no role'],
            ['factory-bass-bitcrushed', 'names a descriptor and a role but loads an instrument'],
        ])('keeps %s out of the catalog: it %s', async (presetId) => {
            const preset = factoryPreset(presetId);
            const published = getMixRecipeCatalog().recipes.filter((recipe) => recipe.origin?.presetId === presetId);
            const discovered = await discover(`loop-absent-${presetId}`, {
                descriptors: ['warm', 'dark', 'lo-fi', 'bright'],
            });

            expect(preset.tags.length).toBeGreaterThan(0);
            expect(published).toEqual([]);
            expect(discovered.candidates.filter((entry) => entry.origin?.presetId === presetId)).toEqual([]);
        });

        it('refuses to expand a preset the catalog does not publish', async () => {
            setLeadVocal();

            const receipt = await expand('loop-absent-expand', {
                recipeId: 'preset:fx-chain-vocal-strip:glued',
                targetId: 'lead-vocal-1',
            });

            expect(receipt.status).toBe('failure');
            expect(receipt.error?.safeMessage).toContain('is not a recipe in the catalog');
        });
    });

    describe('preset version', () => {
        // Red when a changed preset keeps the version its recipe published before.
        it('changes when the preset changes, and the expansion carries the changed value', async () => {
            const preset = factoryPreset('fx-comp-vocal-glue');
            const device = preset.devices[0]!;
            const originalEntries = Object.entries(device.parameterValues);
            const changedValue = device.parameterValues['comp-threshold']! + 6;
            setLeadVocal();

            try {
                const before = await discover('loop-version-before', { descriptors: ['glue'], role: 'vocal' });
                device.parameterValues['comp-threshold'] = changedValue;
                const after = await discover('loop-version-after', { descriptors: ['glue'], role: 'vocal' });
                const expanded = readExpansion(
                    await expand('loop-version-expand', {
                        recipeId: 'preset:fx-comp-vocal-glue:glued',
                        targetId: 'lead-vocal-1',
                    })
                );

                const versionOf = (data: DiscoveryData) =>
                    data.candidates.find((entry) => entry.origin?.presetId === preset.id)?.origin?.presetVersion;
                expect(versionOf(before)).toMatch(/^preset-v1:/);
                expect(versionOf(after)).toMatch(/^preset-v1:/);
                expect(versionOf(after)).not.toBe(versionOf(before));
                expect(expanded.values.find((entry) => entry.paramId === 'comp-threshold')?.value).toBe(changedValue);
            } finally {
                device.parameterValues = Object.fromEntries(originalEntries);
            }
        });
    });

    describe('authored recipes', () => {
        // Red when an authored candidate gains an origin or loses its place ahead of the preset recipes.
        it('are discovered as before, with no origin, ahead of the preset recipes', async () => {
            const data = await discover('loop-authored', { descriptors: ['warmer', 'glue'], role: 'vocal' });

            const authoredIds = getMixRecipeCatalog()
                .recipes.filter(
                    (recipe) =>
                        recipe.origin === undefined &&
                        (recipe.descriptor === 'warm' || recipe.descriptor === 'glued') &&
                        recipe.roles.includes('vocal')
                )
                .map((recipe) => recipe.id);
            const authored = data.candidates.filter((entry) => entry.origin === undefined);
            const presetPositions = data.candidates.flatMap((entry, index) =>
                entry.origin === undefined ? [] : [index]
            );

            expect(authored.map((entry) => entry.id)).toEqual(authoredIds);
            expect(Math.min(...presetPositions)).toBeGreaterThanOrEqual(authored.length);
            for (const candidate of authored) {
                expect(candidate).not.toHaveProperty('origin');
            }
        });
    });
});
