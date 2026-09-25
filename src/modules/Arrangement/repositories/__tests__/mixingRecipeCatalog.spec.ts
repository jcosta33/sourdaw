import { describe, expect, it } from 'vitest';

import { BUILTIN_PLUGINS, type DeviceParameter } from '#/modules/Arrangement/models/DeviceParameter';
import {
    MIX_RECIPE_BANDS,
    MIX_RECIPE_CATALOG_VERSION,
    MIX_RECIPE_DESCRIPTOR_EFFECTS,
    MIX_RECIPE_DESCRIPTOR_TERMS,
    MIX_RECIPE_DESCRIPTORS,
    MIX_RECIPE_METRIC_IDS,
    MIX_RECIPE_ROLES,
    type MixRecipeMetricExpectation,
    type MixRecipeParameterTarget,
    type MixRecipeStep,
} from '#/modules/Arrangement/models/MixRecipe';
import { buildMixRecipeCatalog } from '#/modules/Arrangement/repositories/mixRecipes/mixRecipeCatalog';

const catalog = buildMixRecipeCatalog();

const THIRD_PARTY_MARKS = /\b(1176|la-?2a|pultec|ssl|neve|fairchild|urei|dbx|api)\b/i;

const descriptorsByDeviceType = new Map(BUILTIN_PLUGINS.map((descriptor) => [descriptor.id, descriptor]));

function textFieldsOf(recipe: (typeof catalog.recipes)[number]): string[] {
    return [recipe.title, recipe.source, ...recipe.prerequisites, ...recipe.contraindications];
}

function parameterOf(step: MixRecipeStep, paramId: string): DeviceParameter | undefined {
    return descriptorsByDeviceType.get(step.deviceType)?.parameters.find((entry) => entry.id === paramId);
}

function isWindowOutsideBounds(step: MixRecipeStep, target: MixRecipeParameterTarget): boolean {
    const parameter = parameterOf(step, target.paramId);
    if (!parameter) {
        return false;
    }
    if (target.minimum < parameter.minValue || target.maximum > parameter.maxValue) {
        return true;
    }
    if (target.minimum > target.maximum) {
        return true;
    }
    const stepped = parameter.type === 'choice' || parameter.type === 'bool';
    return !stepped && target.minimum === target.maximum;
}

function hasMisplacedBand(entry: MixRecipeMetricExpectation, declaredBands: ReadonlySet<string>): boolean {
    if (entry.metric !== 'frequencyBandEnergy') {
        return entry.band !== undefined;
    }
    return entry.band === undefined || !declaredBands.has(entry.band);
}

describe('mixingRecipeCatalog', () => {
    it('publishes the declared version and vocabulary', () => {
        expect(MIX_RECIPE_CATALOG_VERSION).toBe(2);
        expect(catalog.version).toBe(MIX_RECIPE_CATALOG_VERSION);
        expect(catalog.descriptors).toEqual([...MIX_RECIPE_DESCRIPTORS]);
        expect(catalog.roles).toEqual([...MIX_RECIPE_ROLES]);
        expect(catalog.descriptorTerms).toEqual(MIX_RECIPE_DESCRIPTOR_TERMS);
        expect(catalog.descriptorEffects).toEqual(MIX_RECIPE_DESCRIPTOR_EFFECTS);
    });

    it('gives every descriptor a produces or removes effect, marking only muddy and thin as removes', () => {
        const missing = MIX_RECIPE_DESCRIPTORS.filter(
            (descriptor) =>
                catalog.descriptorEffects[descriptor] !== 'produces' &&
                catalog.descriptorEffects[descriptor] !== 'removes'
        );
        const removing = MIX_RECIPE_DESCRIPTORS.filter(
            (descriptor) => catalog.descriptorEffects[descriptor] === 'removes'
        );

        expect(missing).toEqual([]);
        expect(removing.sort()).toEqual(['muddy', 'thin']);
    });

    it('lists every descriptor among its own terms, each lowercase, trimmed, and single-spaced', () => {
        const missingOwnId = MIX_RECIPE_DESCRIPTORS.filter(
            (descriptor) => !MIX_RECIPE_DESCRIPTOR_TERMS[descriptor].includes(descriptor)
        );
        const malformed = MIX_RECIPE_DESCRIPTORS.flatMap((descriptor) =>
            MIX_RECIPE_DESCRIPTOR_TERMS[descriptor]
                .filter((term) => term !== term.toLowerCase().trim() || /\s{2,}/.test(term))
                .map((term) => `${descriptor}:${term}`)
        );

        expect(missingOwnId).toEqual([]);
        expect(malformed).toEqual([]);
    });

    it('never lists the same term under two descriptors', () => {
        const owners = new Map<string, string[]>();
        for (const descriptor of MIX_RECIPE_DESCRIPTORS) {
            for (const term of MIX_RECIPE_DESCRIPTOR_TERMS[descriptor]) {
                const existingOwners = owners.get(term) ?? [];
                owners.set(term, [...existingOwners, descriptor]);
            }
        }
        const duplicated = Array.from(owners.entries()).filter(([, descriptors]) => descriptors.length > 1);

        expect(duplicated).toEqual([]);
    });

    it('covers every descriptor and role pair', () => {
        const covered = new Set(
            catalog.recipes.flatMap((recipe) => recipe.roles.map((role) => `${recipe.descriptor}/${role}`))
        );
        const missing = MIX_RECIPE_DESCRIPTORS.flatMap((descriptor) =>
            MIX_RECIPE_ROLES.filter((role) => !covered.has(`${descriptor}/${role}`)).map(
                (role) => `${descriptor}/${role}`
            )
        );

        expect(missing).toEqual([]);
    });

    it('gives every recipe a unique id and a complete body', () => {
        const ids = catalog.recipes.map((recipe) => recipe.id);
        const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
        const incomplete = catalog.recipes
            .filter(
                (recipe) =>
                    recipe.title.trim() === '' ||
                    recipe.source.trim() === '' ||
                    recipe.steps.length === 0 ||
                    recipe.metrics.length === 0 ||
                    recipe.prerequisites.length === 0 ||
                    recipe.contraindications.length === 0 ||
                    recipe.roles.length === 0
            )
            .map((recipe) => recipe.id);

        expect(duplicated).toEqual([]);
        expect(incomplete).toEqual([]);
    });

    it('names only processing devices and parameters that exist on them', () => {
        const unknownDevices = catalog.recipes.flatMap((recipe) =>
            recipe.steps
                .filter((step) => {
                    const descriptor = descriptorsByDeviceType.get(step.deviceType);
                    return (
                        descriptor === undefined ||
                        (descriptor.category !== 'effect' && descriptor.category !== 'utility')
                    );
                })
                .map((step) => `${recipe.id}:${step.deviceType}`)
        );
        const unknownParameters = catalog.recipes.flatMap((recipe) =>
            recipe.steps.flatMap((step) =>
                step.parameters
                    .filter((target) => parameterOf(step, target.paramId) === undefined)
                    .map((target) => `${recipe.id}:${step.deviceType}:${target.paramId}`)
            )
        );

        expect(unknownDevices).toEqual([]);
        expect(unknownParameters).toEqual([]);
    });

    it('keeps every parameter window inside the declared bounds', () => {
        const offending = catalog.recipes.flatMap((recipe) =>
            recipe.steps.flatMap((step) =>
                step.parameters
                    .filter((target) => isWindowOutsideBounds(step, target))
                    .map((target) => `${recipe.id}:${step.deviceType}:${target.paramId}`)
            )
        );

        expect(offending).toEqual([]);
    });

    it('cites only declared metrics, with bands only where a band applies', () => {
        const declaredMetrics = new Set<string>(MIX_RECIPE_METRIC_IDS);
        const declaredBands = new Set<string>(MIX_RECIPE_BANDS);

        const unknownCitedMetrics = catalog.recipes.flatMap((recipe) =>
            recipe.metrics
                .filter((entry) => !declaredMetrics.has(entry.metric))
                .map((entry) => `${recipe.id}:${entry.metric}`)
        );
        const misplacedBands = catalog.recipes.flatMap((recipe) =>
            recipe.metrics
                .filter((entry) => hasMisplacedBand(entry, declaredBands))
                .map((entry) => `${recipe.id}:${entry.metric}:${String(entry.band)}`)
        );

        expect(unknownCitedMetrics).toEqual([]);
        expect(misplacedBands).toEqual([]);
    });

    it('keeps third-party equipment marks out of every recipe text field and every descriptor term', () => {
        const offendingFields = catalog.recipes.flatMap((recipe) =>
            textFieldsOf(recipe)
                .filter((field) => THIRD_PARTY_MARKS.test(field))
                .map((field) => `${recipe.id}:${field}`)
        );
        const offendingTerms = MIX_RECIPE_DESCRIPTORS.flatMap((descriptor) =>
            catalog.descriptorTerms[descriptor]
                .filter((term) => THIRD_PARTY_MARKS.test(term))
                .map((term) => `${descriptor}:${term}`)
        );

        expect(offendingFields).toEqual([]);
        expect(offendingTerms).toEqual([]);
    });
});
