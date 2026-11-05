import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
function discoverAll(descriptors: readonly string[], role: string | null, targetId: string | null = null) {
    const result = discoverMixRecipes({ descriptors, targetId, role, limit: getMixRecipeCatalog().recipes.length });
    if (result.status !== 'ok') {
        throw new Error(`discovery refused target ${String(targetId)}`);
    }
    return result;
}

function discoveredIds(descriptors: readonly string[], role: string | null, targetId: string | null = null) {
    return discoverAll(descriptors, role, targetId).data.candidates.map((candidate) => candidate.id);
}

/** A chain preset holds effect or utility devices only; any other device is an instrument. */
function isChainPreset(preset: SoundPreset): boolean {
    return preset.devices.every((device) => {
        const category = getPluginById(device.type)?.category;
        return category === 'effect' || category === 'utility';
    });
}

function namesProducedDescriptor(preset: SoundPreset): boolean {
    const catalog = getMixRecipeCatalog();
    const tags = new Set(preset.tags.map((tag) => tag.toLowerCase().trim().replaceAll(/\s+/g, ' ')));
    return catalog.descriptors.some(
        (descriptor) =>
            catalog.descriptorEffects[descriptor] === 'produces' &&
            catalog.descriptorTerms[descriptor].some((term) => tags.has(term))
    );
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

const NO_DESCRIPTOR = 'names no perceptual descriptor';
const UNWRITABLE_VALUE = 'stores a value its parameter cannot hold';
const OVERSIZE = 'expands past the batch ceiling even without redundant writes';

/**
 * Every chain preset the catalog does not offer, and why. A chain naming no perceptual descriptor
 * could be found only by its role and authored character, which `recipe.discover` does not search,
 * so none is guessed for it. A stored value its parameter cannot hold would be written as another
 * setting, so that chain is refused rather than published approximately.
 */
const CHAIN_PRESET_EXCLUSIONS: Readonly<Record<string, string>> = {
    'fx-eq-vocal-presence': NO_DESCRIPTOR,
    'fx-eq-bass-scoop': NO_DESCRIPTOR,
    'fx-eq-mid-forward': NO_DESCRIPTOR,
    'fx-comp-parallel-crush': NO_DESCRIPTOR,
    'fx-comp-sidechain-pump': NO_DESCRIPTOR,
    'fx-rev-large-hall': NO_DESCRIPTOR,
    'fx-rev-ambient-wash': NO_DESCRIPTOR,
    'fx-rev-gated-80s': NO_DESCRIPTOR,
    'fx-conv-cathedral': NO_DESCRIPTOR,
    'fx-conv-warehouse': NO_DESCRIPTOR,
    'fx-delay-slapback': NO_DESCRIPTOR,
    'fx-delay-dotted-eighth': NO_DESCRIPTOR,
    'fx-delay-dub-echo': NO_DESCRIPTOR,
    'fx-chorus-slow-shimmer': NO_DESCRIPTOR,
    'fx-phaser-slow-sweep': NO_DESCRIPTOR,
    'fx-flanger-jet': NO_DESCRIPTOR,
    'fx-leslie-sim': NO_DESCRIPTOR,
    'fx-dist-fuzz': NO_DESCRIPTOR,
    'fx-chain-vocal-strip': NO_DESCRIPTOR,
    'fx-creative-space-echo': NO_DESCRIPTOR,
    'fx-creative-shimmer': NO_DESCRIPTOR,
    'fx-creative-industrial': NO_DESCRIPTOR,
    // It says it controls vocal dynamics, but only the source-backed authored recipes are `controlled`.
    'factory-faust-1176-vocal-control': NO_DESCRIPTOR,
    'factory-faust-1176-drum-smash': NO_DESCRIPTOR,
    'factory-faust-zita-huge-hall': NO_DESCRIPTOR,
    'factory-faust-tape-space-echo': NO_DESCRIPTOR,
    'fx-lofi-vinyl': UNWRITABLE_VALUE,
    'fx-lofi-retro-radio': UNWRITABLE_VALUE,
    'fx-chain-guitar-clean': OVERSIZE,
    'fx-chain-drum-punch': OVERSIZE,
};

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

            const data = readExpansion(
                await expand(`loop-role-less-${String(role)}-${track.kind}`, {
                    recipeId: ROLE_LESS,
                    targetId: 'source-1',
                    ...(role === null ? {} : { role }),
                })
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
        // Red when a chain preset is neither offered by discovery nor excluded with a reason that holds.
        it('is discovered under each descriptor it publishes, or excluded for a reason that holds', () => {
            const chains = getFactoryPresets().filter(isChainPreset);
            const undiscovered = chains.filter((preset) => {
                const published = publishedFrom(preset.id);
                return (
                    published.length === 0 ||
                    published.some((recipe) => !discoveredIds([recipe.descriptor], null).includes(recipe.id))
                );
            });

            expect(
                Object.fromEntries(undiscovered.map((preset) => [preset.id, CHAIN_PRESET_EXCLUSIONS[preset.id]]))
            ).toEqual(CHAIN_PRESET_EXCLUSIONS);
            for (const preset of undiscovered) {
                const reason = CHAIN_PRESET_EXCLUSIONS[preset.id];
                const published = publishedFrom(preset.id);
                if (reason === NO_DESCRIPTOR) {
                    expect([preset.id, namesProducedDescriptor(preset), published]).toEqual([preset.id, false, []]);
                } else if (reason === UNWRITABLE_VALUE) {
                    expect([
                        preset.id,
                        namesProducedDescriptor(preset),
                        storesUnwritableValue(preset),
                        published,
                    ]).toEqual([preset.id, true, true, []]);
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
