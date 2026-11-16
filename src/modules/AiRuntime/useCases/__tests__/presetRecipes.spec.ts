import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    getAddedDeviceParameterValues,
    getAgentPresetDiscoveryManifest,
    getFactoryPresets,
    getMixRecipeCatalog,
    getPluginById,
    quantiseDeviceParameterValue,
} from '#/modules/Arrangement/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { querySemanticProject } from '#/modules/Project/useCases';

import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { RECIPE_EXPANSION_MAX_COMMANDS } from '../../models/RecipeExpansionLimits';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { countRecipeExpansionCommands } from '../countRecipeExpansionCommands';
import { discoverMixRecipes } from '../discoverMixRecipes';
import { executeRecipeExpansion } from '../executeRecipeExpansion';
import { getProjectContext } from '../getProjectContext';

import { createTrack } from './trackFixture';

registerDeviceEnginePorts();

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    querySemanticProject: vi.fn(),
}));

/**
 * Presets a census case adds to the factory preset source the Arrangement use-case barrel publishes,
 * the one source this module reads presets from; each case that injects clears it again. Tests may
 * mock only a foreign module's contract barrel, and the catalogue reads presets inside Arrangement,
 * so a case that needs the catalogue to publish an injected preset offers that recipe itself.
 */
const injectedPresetSource = vi.hoisted(() => ({ presets: [] as SoundPreset[] }));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const original = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...original,
        getFactoryPresets: () => [...original.getFactoryPresets(), ...injectedPresetSource.presets],
        getMixRecipeCatalog: vi.fn(original.getMixRecipeCatalog),
    };
});

type SoundPreset = ReturnType<typeof getFactoryPresets>[number];
type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];

type DiscoveryCandidate = {
    id: string;
    descriptor: string | null;
    effect: string | null;
    metrics: unknown[];
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

/** The values a device of this type holds the moment `addDevice` writes it, read from the owner. */
function addedValues(deviceType: string): Readonly<Record<string, number>> {
    const values = getAddedDeviceParameterValues(deviceType);
    if (values === null) {
        throw new Error(`${deviceType} is not a device addDevice can write`);
    }
    return values;
}

/**
 * The commands a stored chain must lower to on one track, written out from the chain itself: a write
 * is left out when its value is exactly the one the device `addDevice` writes already holds.
 */
function expectedCommands(chain: readonly ChainDevice[], afterDeviceId: string | null, trackId = 'lead-vocal-1') {
    const commands: { name: string; arguments: Record<string, unknown> }[] = [];
    for (const [index, device] of chain.entries()) {
        const binding = `recipe-1-${String(index)}`;
        const after = index === 0 ? afterDeviceId : `$recipe-1-${String(index - 1)}`;
        const addArguments: Record<string, unknown> = { trackId, deviceType: device.deviceType };
        if (after !== null) {
            addArguments.afterDeviceId = after;
        }
        addArguments.binding = binding;
        commands.push({ name: 'addDevice', arguments: addArguments });
        const held = addedValues(device.deviceType);
        for (const [paramId, value] of device.values) {
            if (Object.is(held[paramId], value)) {
                continue;
            }
            commands.push({ name: 'setDeviceParameter', arguments: { deviceId: `$${binding}`, paramId, value } });
        }
    }
    return commands;
}

/** Every recipe the catalog publishes from one preset. */
function publishedFrom(presetId: string): MixRecipe[] {
    return getMixRecipeCatalog().recipes.filter((recipe) => recipe.origin?.presetId === presetId);
}

/** Discovery read directly with a page as wide as the catalog, so a census sees every match, not one page. */
function discoverAll(
    descriptors: readonly string[],
    role: string | null,
    targetId: string | null = null,
    presetTerms: readonly string[] = []
) {
    const result = discoverMixRecipes({
        descriptors,
        presetTerms,
        targetId,
        role,
        limit: getMixRecipeCatalog().recipes.length,
    });
    if (result.status !== 'ok') {
        throw new Error(`discovery refused target ${String(targetId)}`);
    }
    return result;
}

function discoveredIds(
    descriptors: readonly string[],
    role: string | null,
    targetId: string | null = null,
    presetTerms: readonly string[] = []
) {
    return discoverAll(descriptors, role, targetId, presetTerms).data.candidates.map((candidate) => candidate.id);
}

/** A chain preset holds effect or utility devices only; any other device is an instrument. */
function isChainPreset(preset: SoundPreset): boolean {
    return preset.devices.every((device) => {
        const category = getPluginById(device.type)?.category;
        return category === 'effect' || category === 'utility';
    });
}

function storesUnwritableValue(preset: SoundPreset): boolean {
    return preset.devices.some((device) =>
        Object.entries(device.parameterValues).some(([paramId, value]) => {
            const declared = getPluginById(device.type)?.parameters.find((parameter) => parameter.id === paramId);
            return (
                declared === undefined ||
                value < declared.minValue ||
                value > declared.maxValue ||
                quantiseDeviceParameterValue({ deviceType: device.type, paramId, value }) !== value
            );
        })
    );
}

/** The recipe roles a recipe with no authored role serves: every source, never a bus or the master. */
const SOURCE_ROLES = ['vocal', 'drums', 'bass', 'guitar', 'keys'] as const;

const UNWRITABLE_VALUE = 'stores a value its parameter cannot hold';
const OVERSIZE = 'expands past the batch ceiling even without redundant writes';

/**
 * Every chain preset discovery does not offer, and why. A stored value its parameter cannot hold
 * would be written as another setting, so that chain is refused rather than published approximately.
 * A chain that expands past the batch ceiling cannot be adopted whole, and the ceiling is never
 * bypassed, so discovery withholds it with a warning. Every other chain preset is offered, by its
 * descriptor when its tags name one and always by its authored name and tags.
 */
const CHAIN_PRESET_EXCLUSIONS: Readonly<Record<string, string>> = {
    'fx-chain-guitar-clean': OVERSIZE,
    'fx-chain-drum-punch': OVERSIZE,
    'fx-chain-vocal-strip': OVERSIZE,
};

/**
 * The chain presets whose tags name no perceptual descriptor, each with the terms of its own
 * authored name and tags and the role that finds it, so no perceptual word is invented for it. A
 * term of several words is matched word by word against the name and tags.
 */
const DESCRIPTOR_LESS_PRESET_QUERIES: readonly (readonly [string, readonly string[], string | null])[] = [
    ['fx-eq-vocal-presence', ['presence'], 'vocal'],
    ['fx-eq-bass-scoop', ['scoop'], 'bass'],
    ['fx-eq-mid-forward', ['forward'], null],
    ['fx-comp-parallel-crush', ['parallel'], null],
    ['fx-comp-sidechain-pump', ['sidechain'], null],
    ['fx-rev-large-hall', ['large'], null],
    ['fx-rev-ambient-wash', ['dreamy'], null],
    ['fx-rev-gated-80s', ['gated'], 'drums'],
    ['fx-conv-cathedral', ['cathedral'], null],
    ['fx-conv-warehouse', ['warehouse'], null],
    ['fx-delay-slapback', ['slapback'], 'vocal'],
    ['fx-delay-dotted-eighth', ['dotted'], 'guitar'],
    ['fx-delay-dub-echo', ['reggae'], null],
    ['fx-chorus-slow-shimmer', ['slow shimmer'], null],
    ['fx-phaser-slow-sweep', ['psychedelic'], null],
    ['fx-flanger-jet', ['flanger'], null],
    ['fx-leslie-sim', ['leslie'], null],
    ['fx-dist-fuzz', ['fuzz'], 'guitar'],
    ['fx-creative-space-echo', ['echo wash'], null],
    ['fx-creative-shimmer', ['shimmer reverb'], null],
    ['fx-creative-industrial', ['industrial crush'], null],
    ['factory-faust-1176-vocal-control', ['smooth'], 'vocal'],
    ['factory-faust-1176-drum-smash', ['smash'], 'drums'],
    ['factory-faust-zita-huge-hall', ['huge'], null],
    ['factory-faust-tape-space-echo', ['space echo'], null],
];

/**
 * The recipes a preset publishes once its tags carry what its own description states, with the
 * roles each serves in catalog order.
 */
const DESCRIBED_PRESET_RECIPES: readonly (readonly [string, string, readonly string[]])[] = [
    ['fx-comp-drum-bus', 'preset:fx-comp-drum-bus:glued', ['drums', 'bus']],
    ['fx-rev-plate', 'preset:fx-rev-plate:bright', ['vocal', 'drums']],
    ['fx-rev-spring', 'preset:fx-rev-spring:bright', ['guitar']],
    ['fx-conv-studio-room', 'preset:fx-conv-studio-room:tight', ['vocal', 'drums']],
    ['fx-comp-gentle-mix', 'preset:fx-comp-gentle-mix:glued', ['master']],
    ['factory-faust-zita-vocal-plate', 'preset:factory-faust-zita-vocal-plate:bright', ['vocal']],
    ['factory-faust-tape-slapback', 'preset:factory-faust-tape-slapback:vintage', ['vocal', 'guitar']],
    ['fx-chain-master-bus', 'preset:fx-chain-master-bus:glued', ['bus', 'master']],
    ['fx-lofi-vinyl', 'preset:fx-lofi-vinyl:lo-fi', []],
    ['fx-lofi-vinyl', 'preset:fx-lofi-vinyl:vintage', []],
    ['fx-lofi-retro-radio', 'preset:fx-lofi-retro-radio:lo-fi', []],
    ['fx-lofi-retro-radio', 'preset:fx-lofi-retro-radio:vintage', []],
];

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

        // Red when discovery counts a write the added device already holds, or the recipe drops a stated value.
        it('offers a chain that fits the ceiling only once writes the added devices already hold are left out', () => {
            const recipe = publishedFrom('fx-chain-master-bus').find(
                (entry) => entry.id === 'preset:fx-chain-master-bus:glued'
            );
            const stated = chainOf(factoryPreset('fx-chain-master-bus'));

            expect(recipe?.steps.flatMap((step) => step.parameters)).toEqual(
                stated.flatMap((device) =>
                    device.values.map(([paramId, value]) => ({ paramId, minimum: value, maximum: value }))
                )
            );
            expect(stated.length + stated.flatMap((device) => device.values).length).toBeGreaterThan(
                RECIPE_EXPANSION_MAX_COMMANDS
            );
            expect(recipe === undefined ? null : countRecipeExpansionCommands(recipe)).toBe(
                expectedCommands(stated, null).length
            );
            expect(expectedCommands(stated, null).length).toBeLessThanOrEqual(RECIPE_EXPANSION_MAX_COMMANDS);
            expect(discoveredIds(['glue'], 'bus')).toContain('preset:fx-chain-master-bus:glued');
        });
    });

    describe('a chain preset whose tags name no perceptual descriptor', () => {
        const PRESET_IDS = DESCRIPTOR_LESS_PRESET_QUERIES.map(([presetId]) => presetId);

        function descriptorLessRecipeId(presetId: string): string {
            return `preset:${presetId}`;
        }

        /** The same chain built by hand as an authored recipe, from the stored chain and not from the preset recipe. */
        function handBuiltRecipe(chain: readonly ChainDevice[], roles: MixRecipe['roles']): MixRecipe {
            return {
                id: 'hand-built-chain',
                descriptor: 'glued',
                roles,
                title: 'Hand built chain',
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

        // Red when the table drifts from the catalogue: an adoptable chain publishing no descriptor must be queried here.
        it('is listed here exactly when the catalogue publishes it without a descriptor and it fits the ceiling', () => {
            const descriptorless = getMixRecipeCatalog().recipes.filter(
                (recipe) => recipe.origin !== undefined && recipe.descriptor === null
            );
            const fitting = descriptorless.filter(
                (recipe) => countRecipeExpansionCommands(recipe) <= RECIPE_EXPANSION_MAX_COMMANDS
            );
            const adoptable = fitting.map((recipe) => recipe.id).sort();

            expect(adoptable).toEqual(PRESET_IDS.map(descriptorLessRecipeId).sort());
        });

        // Red when a chain stops being found by its own name or tags, or is published with a perceptual claim.
        it.each(DESCRIPTOR_LESS_PRESET_QUERIES)(
            '%s is found by %j in role %s as a recipe with no descriptor and its exact stored values',
            async (presetId, presetTerms, role) => {
                const preset = factoryPreset(presetId);

                const data = await discover(
                    `loop-less-${presetId}`,
                    role === null ? { presetTerms } : { presetTerms, role }
                );

                const candidate = data.candidates.find((entry) => entry.id === descriptorLessRecipeId(presetId));
                expect(candidate?.descriptor).toBeNull();
                expect(candidate?.effect).toBeNull();
                expect(candidate?.metrics).toEqual([]);
                expect(candidate?.origin?.presetId).toBe(presetId);
                expect(candidate?.steps.map((step) => step.deviceType)).toEqual(
                    preset.devices.map((device) => device.type)
                );
                expect(candidate?.steps.flatMap((step) => step.parameters)).toEqual(
                    chainOf(preset).flatMap((device) =>
                        device.values.map(([paramId, value]) => ({ paramId, minimum: value, maximum: value }))
                    )
                );
            }
        );

        // Red when a descriptor-less recipe is expanded by a path of its own, or a value is added or dropped.
        it.each(DESCRIPTOR_LESS_PRESET_QUERIES)(
            '%s expands to the commands of the same chain built by hand',
            async (presetId) => {
                const chain = chainOf(factoryPreset(presetId));
                const recipe = publishedFrom(presetId).find((entry) => entry.id === descriptorLessRecipeId(presetId));
                const roles = recipe?.roles ?? [];
                offerRecipes(handBuiltRecipe(chain, roles));
                setTracks([createTrack({ id: 'source-1', name: 'FX Return' })]);
                const roleArgument = roles[0] === undefined ? {} : { role: roles[0] };

                const fromPreset = readExpansion(
                    await expand(`loop-less-preset-${presetId}`, {
                        recipeId: descriptorLessRecipeId(presetId),
                        targetId: 'source-1',
                        ...roleArgument,
                    })
                );
                const fromHandBuilt = readExpansion(
                    await expand(`loop-less-hand-${presetId}`, {
                        recipeId: 'hand-built-chain',
                        targetId: 'source-1',
                        ...roleArgument,
                    })
                );

                expect(fromPreset.commands).toEqual(fromHandBuilt.commands);
                expect(fromPreset.values).toEqual(fromHandBuilt.values);
                expect(fromPreset.commands).toEqual(expectedCommands(chain, null, 'source-1'));
            }
        );

        // Red when an expansion of a descriptor-less recipe retains a metric expectation the approval could promise.
        it('derives no metric expectation to promise, where an authored recipe retains its own', () => {
            setTracks([createTrack({ id: 'source-1', name: 'FX Return' })]);
            const authored = {
                ...handBuiltRecipe(chainOf(factoryPreset('fx-eq-mid-forward')), []),
                metrics: [{ metric: 'spectralCentroid', direction: 'increase' }],
            } as MixRecipe;
            offerRecipes(authored);
            const expandRecipe = (recipeId: string) =>
                executeRecipeExpansion({
                    call: { id: 'call-1', name: 'recipe.expand', arguments: { recipeId, targetId: 'source-1' } },
                    callId: 'call-1',
                    turn: 1,
                    ordinal: 1,
                    context: getProjectContext(),
                    revision: REVISION,
                });

            const fromPreset = expandRecipe(descriptorLessRecipeId('fx-eq-mid-forward'));
            const fromAuthored = expandRecipe('hand-built-chain');

            expect(fromPreset.receipt.status).toBe('success');
            expect(fromPreset.metricRecipe).toBeUndefined();
            expect(fromAuthored.metricRecipe?.expectations).toEqual([
                { metric: 'spectralCentroid', band: null, direction: 'increase' },
            ]);
        });

        // Red when a target alone stops browsing the preset recipes serving the target's own role.
        it('lists preset recipes serving the role of a target named alone', () => {
            setLeadVocal();

            const listed = discoverAll([], null, 'lead-vocal-1').data.candidates;

            expect(listed.map((entry) => entry.id)).toContain('preset:fx-eq-vocal-presence');
            expect(listed.every((entry) => entry.origin !== undefined)).toBe(true);
            expect(listed.every((entry) => entry.roles.length === 0 || entry.roles.includes('vocal'))).toBe(true);
        });

        it('is matched case-insensitively and by a word of a hyphenated tag', () => {
            expect(discoveredIds([], null, null, ['CATHEDRAL'])).toContain('preset:fx-conv-cathedral');
            expect(discoveredIds([], null, null, ['cut'])).toContain('preset:fx-eq-mid-forward');
        });

        // Red when a role-only call stops listing the presets of that role, or lists an authored recipe.
        it('is listed by role alone among the preset recipes serving that role, never an authored recipe', () => {
            const listed = discoverAll([], 'drums').data.candidates;

            expect(listed.map((entry) => entry.id)).toEqual(
                expect.arrayContaining(['preset:fx-rev-gated-80s', 'preset:fx-comp-drum-bus:glued'])
            );
            expect(listed.every((entry) => entry.origin !== undefined)).toBe(true);
            expect(listed.map((entry) => entry.id)).not.toContain('preset:fx-eq-vocal-presence');
        });

        it('names a preset term no factory preset carries', () => {
            const result = discoverAll([], null, null, ['no-such-preset-word']);

            expect(result.data.candidates).toEqual([]);
            expect(result.warnings.join(' ')).toContain('No factory preset name or tag matches: no-such-preset-word');
        });

        // Red when a preset term also selects authored recipes, or reads as a descriptor.
        it('selects only preset recipes, even for a word that is also a descriptor term', () => {
            const listed = discoverAll([], null, null, ['warm']).data.candidates;

            expect(listed.length).toBeGreaterThan(0);
            expect(listed.every((entry) => entry.origin !== undefined)).toBe(true);
            expect(discoverAll([], null, null, ['warm']).data.candidates).not.toEqual(
                discoverAll(['warm'], null).data.candidates
            );
        });

        // Red when a chain too large to adopt whole is offered through its name instead of its descriptor.
        it.each([
            ['fx-chain-guitar-clean', 'clean', 'guitar'],
            ['fx-chain-drum-punch', 'punch', 'drums'],
            ['fx-chain-vocal-strip', 'channel-strip', 'vocal'],
        ])('withholds %s found by the term %s, as it does by descriptor', async (presetId, term, role) => {
            const receipt = await runTool(`loop-oversize-${presetId}`, 'recipe.discover', {
                presetTerms: [term],
                role,
                limit: 8,
            });

            const data = receipt.data as DiscoveryData;
            expect(publishedFrom(presetId).length).toBeGreaterThan(0);
            expect(data.candidates.filter((entry) => entry.origin?.presetId === presetId)).toEqual([]);
            expect(receipt.warnings.join(' ')).toContain('withheld');
        });
    });

    describe('presets whose own description names their descriptor or role', () => {
        // Red when a tag the preset's description states is dropped, or a recipe stops reaching discovery.
        it.each(DESCRIBED_PRESET_RECIPES)('%s publishes %s for its described roles', (presetId, recipeId, roles) => {
            const recipe = publishedFrom(presetId).find((entry) => entry.id === recipeId);

            expect(recipe?.roles).toEqual(roles);
            for (const role of roles) {
                expect(discoveredIds([recipe?.descriptor ?? ''], role)).toContain(recipeId);
            }
        });
    });

    describe('a preset recipe naming no role serves any source', () => {
        const ROLE_LESS = 'preset:fx-eq-high-cut:dark';

        it('is published with no role', () => {
            expect(publishedFrom('fx-eq-high-cut').map((recipe) => [recipe.id, recipe.roles])).toEqual([
                ['preset:fx-eq-high-cut:warm', []],
                ['preset:fx-eq-high-cut:dark', []],
            ]);
        });

        // Red when a role-less recipe is dropped for a source role, or offered for a bus or the master.
        it('is discovered for every source role and with no role, never for a bus or the master', () => {
            for (const role of [...SOURCE_ROLES, null]) {
                expect(discoveredIds(['dark'], role)).toContain(ROLE_LESS);
            }
            expect(discoveredIds(['dark'], 'bus')).not.toContain(ROLE_LESS);
            expect(discoveredIds(['dark'], 'master')).not.toContain(ROLE_LESS);
        });

        // Red when a track whose canonical role names no recipe role stops seeing the recipes that need none.
        it('is discovered on a track whose role names no recipe role, beside the warning for the rest', () => {
            setTracks([createTrack({ id: 'fx-return-1', name: 'FX Return' })]);

            const result = discoverAll(['dark'], null, 'fx-return-1');

            expect(result.data.candidates.map((entry) => entry.id)).toContain(ROLE_LESS);
            expect(result.data.candidates.every((entry) => entry.roles.length === 0)).toBe(true);
            expect(result.warnings.join(' ')).toContain('has no recipe role');
        });

        it('is not discovered on a bus or the master', () => {
            setTracks([
                createTrack({ id: 'bus-1', name: 'Drum Bus', kind: 'bus' }),
                createTrack({ id: 'master-1', name: 'Master', kind: 'master' }),
            ]);

            expect(discoveredIds(['dark'], null, 'bus-1')).not.toContain(ROLE_LESS);
            expect(discoveredIds(['dark'], null, 'master-1')).not.toContain(ROLE_LESS);
        });

        // Red when the expander refuses a role-less recipe on a source track, with or without a role.
        it.each([
            ['an audio track of no recipe role', createTrack({ id: 'source-1', name: 'FX Return' }), null],
            ['a MIDI track', createTrack({ id: 'source-1', name: 'Track 2', kind: 'midi' }), null],
            ['a guitar track', createTrack({ id: 'source-1', name: 'Guitar' }), 'guitar'],
        ])('expands on %s', async (_label, track, role) => {
            setTracks([track]);
            const chain = chainOf(factoryPreset('fx-eq-high-cut'));

            const target = { recipeId: ROLE_LESS, targetId: 'source-1' };
            const data = readExpansion(
                await expand(
                    `loop-role-less-${String(role)}-${track.kind}`,
                    role === null ? target : { ...target, role }
                )
            );

            expect(data.commands).toEqual(expectedCommands(chain, null, 'source-1'));
        });

        // Red when a role-less recipe is applied to a bus, the master or a folder.
        it.each([
            ['a bus', createTrack({ id: 'scope-1', name: 'Drum Bus', kind: 'bus' }), 'serves source tracks'],
            ['the master', createTrack({ id: 'scope-1', name: 'Master', kind: 'master' }), 'serves source tracks'],
            ['a folder', createTrack({ id: 'scope-1', name: 'Vocals', kind: 'folder' }), 'folder'],
        ])('refuses to expand on %s', async (_label, track, reason) => {
            setTracks([track]);

            const receipt = await expand(`loop-role-less-refused-${track.kind}`, {
                recipeId: ROLE_LESS,
                targetId: 'scope-1',
            });

            expect(receipt.status).toBe('failure');
            expect(receipt.error?.safeMessage).toContain(reason);
        });

        it('refuses to expand on a source track argued as a bus', async () => {
            setTracks([createTrack({ id: 'source-1', name: 'Guitar' })]);

            const receipt = await expand('loop-role-less-argued-bus', {
                recipeId: ROLE_LESS,
                targetId: 'source-1',
                role: 'bus',
            });

            expect(receipt.status).toBe('failure');
            expect(receipt.error?.safeMessage).toContain('serves source tracks');
        });
    });

    describe('every chain preset in the library', () => {
        /**
         * The chain presets of a list that discovery does not offer both under each descriptor they
         * publish and by their first authored tag, with the ones `CHAIN_PRESET_EXCLUSIONS` does not account for, and the listed ids
         * that are no undiscovered chain preset of the list. Discoverability is read through the
         * catalogue and discovery, so a preset counts as offered only when the live catalogue
         * publishes it.
         */
        function censusChainPresets(presets: readonly SoundPreset[]) {
            const undiscovered = presets.filter(isChainPreset).filter((preset) => {
                const published = publishedFrom(preset.id);
                const byTag = discoveredIds([], null, null, [preset.tags[0] ?? preset.name]);
                return (
                    published.length === 0 ||
                    published.some(
                        (recipe) =>
                            !byTag.includes(recipe.id) ||
                            (recipe.descriptor !== null &&
                                !discoveredIds([recipe.descriptor], null).includes(recipe.id))
                    )
                );
            });
            const undiscoveredIds = new Set(undiscovered.map((preset) => preset.id));
            return {
                undiscovered,
                unaccounted: Array.from(undiscoveredIds)
                    .filter((id) => !Object.hasOwn(CHAIN_PRESET_EXCLUSIONS, id))
                    .sort(),
                staleExclusions: Object.keys(CHAIN_PRESET_EXCLUSIONS)
                    .filter((id) => !undiscoveredIds.has(id))
                    .sort(),
            };
        }

        /** A chain preset of the library's own shape, under a new id and the given tags. */
        function chainPresetLike(id: string, tags: string[]): SoundPreset {
            return { ...structuredClone(factoryPreset('fx-eq-vocal-presence')), id, name: id, tags };
        }

        afterEach(() => {
            injectedPresetSource.presets = [];
        });

        // Red when a chain preset is neither offered by discovery nor excluded with a reason that holds.
        it('is discovered by its descriptors and its authored tag, or excluded for a reason that holds', () => {
            const { undiscovered, unaccounted, staleExclusions } = censusChainPresets(getFactoryPresets());

            // Compared as id sets: an undiscovered preset the table does not list must fail here.
            expect({ unaccounted, staleExclusions }).toEqual({ unaccounted: [], staleExclusions: [] });
            for (const preset of undiscovered) {
                const reason = CHAIN_PRESET_EXCLUSIONS[preset.id];
                const published = publishedFrom(preset.id);
                if (reason === UNWRITABLE_VALUE) {
                    expect([preset.id, storesUnwritableValue(preset), published]).toEqual([preset.id, true, []]);
                } else {
                    expect([preset.id, published.length > 0]).toEqual([preset.id, true]);
                    expect(published.map((recipe) => countRecipeExpansionCommands(recipe))).toEqual(
                        published.map(() => expectedCommands(chainOf(preset), null).length)
                    );
                    expect(
                        published.every(
                            (recipe) => countRecipeExpansionCommands(recipe) > RECIPE_EXPANSION_MAX_COMMANDS
                        )
                    ).toBe(true);
                }
            }
        });

        // Red when the census stops reading the live preset source: a new chain preset no table lists
        // and discovery cannot offer must be reported, and one the catalogue publishes must not be.
        it('reports a chain preset added to the live source that is neither discoverable nor listed', () => {
            const warm = chainPresetLike('injected-warm-chain', ['warm']);
            injectedPresetSource.presets = [chainPresetLike('injected-unlisted-chain', ['eq']), warm];
            const warmRecipe = presetRecipeOf('preset:injected-warm-chain:warm', chainOf(warm));
            offerRecipes({
                ...warmRecipe,
                origin: { kind: 'preset', presetId: warm.id, presetVersion: 'preset-v1:00000000', tags: warm.tags },
                descriptor: 'warm',
            });

            const census = censusChainPresets(getFactoryPresets());

            expect(getFactoryPresets().map((preset) => preset.id)).toContain('injected-unlisted-chain');
            expect(discoveredIds(['warm'], null)).toContain('preset:injected-warm-chain:warm');
            expect({ unaccounted: census.unaccounted, staleExclusions: census.staleExclusions }).toEqual({
                unaccounted: ['injected-unlisted-chain'],
                staleExclusions: [],
            });
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
            if (preset.descriptor === null) {
                throw new TypeError('The test preset recipe must carry a descriptor an authored recipe can hold.');
            }
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

            const expected = expectedCommands(chainOf(factoryPreset('fx-chain-guitar-clean')), null, 'guitar-1').length;
            expect(receipt.status).toBe('failure');
            expect(receipt.error?.safeMessage).toContain(
                `expands to ${String(expected)} commands, above the ${String(RECIPE_EXPANSION_MAX_COMMANDS)}`
            );
        });

        // Red when a write the added device already holds is emitted, or its value leaves the expansion's values.
        it('leaves out a write the added device already holds and keeps every stated value', async () => {
            const heldLowGain = addedValues('builtin-eq')['eq-low-gain'];
            if (heldLowGain === undefined || addedValues('builtin-eq')['eq-low-freq'] === 150) {
                throw new Error('the fixture needs one held and one changed EQ value');
            }
            const chain: ChainDevice[] = [
                {
                    deviceType: 'builtin-eq',
                    values: [
                        ['eq-low-gain', heldLowGain],
                        ['eq-low-freq', 150],
                    ],
                },
            ];
            offerRecipes(presetRecipeOf('preset:held-value:glued', chain));
            setLeadVocal();

            const data = readExpansion(
                await expand('loop-held-value', { recipeId: 'preset:held-value:glued', targetId: 'lead-vocal-1' })
            );

            expect(data.commands).toEqual([
                {
                    name: 'addDevice',
                    arguments: { trackId: 'lead-vocal-1', deviceType: 'builtin-eq', binding: 'recipe-1-0' },
                },
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: '$recipe-1-0', paramId: 'eq-low-freq', value: 150 },
                },
            ]);
            expect(data.values.map((entry) => [entry.paramId, entry.value])).toEqual([
                ['eq-low-gain', heldLowGain],
                ['eq-low-freq', 150],
            ]);
        });

        // Red when a retune of an existing device drops a write because the value equals a new device's.
        it('writes every value of an edit step, whatever a newly added device would hold', async () => {
            const heldThreshold = addedValues('builtin-compressor')['comp-threshold'];
            if (heldThreshold === undefined) {
                throw new Error('the compressor declares no threshold');
            }
            offerRecipes({
                id: 'hand-built-retune',
                descriptor: 'glued',
                roles: ['vocal'],
                title: 'Retune the compressor',
                steps: [
                    {
                        kind: 'edit',
                        deviceType: 'builtin-compressor',
                        parameters: [{ paramId: 'comp-threshold', minimum: heldThreshold, maximum: heldThreshold }],
                    },
                ],
                prerequisites: [],
                contraindications: [],
                metrics: [],
                source: 'test',
            });
            setLeadVocal([
                {
                    ...installedDevice('device-comp-1', 'builtin-compressor'),
                    parameterValues: { 'comp-threshold': heldThreshold - 6 },
                },
            ]);

            const data = readExpansion(
                await expand('loop-retune-held', { recipeId: 'hand-built-retune', targetId: 'lead-vocal-1' })
            );

            expect(data.commands).toEqual([
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: 'device-comp-1', paramId: 'comp-threshold', value: heldThreshold },
                },
            ]);
        });
    });

    describe('presets that are not effect chains, or that the catalog does not publish', () => {
        // Red when a preset that loads an instrument is published as a mix chain.
        it.each([['factory-bass-bitcrushed', 'names a descriptor and a role but loads an instrument']])(
            'keeps %s out of the catalog: it %s',
            async (presetId) => {
                const preset = factoryPreset(presetId);
                const published = getMixRecipeCatalog().recipes.filter(
                    (recipe) => recipe.origin?.presetId === presetId
                );
                const discovered = await discover(`loop-absent-${presetId}`, {
                    descriptors: ['warm', 'dark', 'lo-fi', 'bright'],
                });

                expect(preset.tags.length).toBeGreaterThan(0);
                expect(isChainPreset(preset)).toBe(false);
                expect(published).toEqual([]);
                expect(discovered.candidates.filter((entry) => entry.origin?.presetId === presetId)).toEqual([]);
            }
        );

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
