import { getPluginById } from '../models/DeviceParameter';
import { quantiseDeviceParameterValue } from '../models/DeviceParameterLaw';
import { type PluginDescriptor } from '../models/DeviceParameterTypes';
import { getPresetContractVersion } from '../models/GetPresetContractVersion';
import {
    MIX_RECIPE_DESCRIPTOR_EFFECTS,
    MIX_RECIPE_DESCRIPTOR_TERMS,
    MIX_RECIPE_DESCRIPTORS,
    MIX_RECIPE_ROLES,
    type MixRecipe,
    type MixRecipeDescriptor,
    type MixRecipeParameterTarget,
    type MixRecipeRole,
    type MixRecipeStep,
} from '../models/MixRecipe';
import { type DevicePreset, type SoundPreset } from '../models/SoundPreset';

function normalizeTag(tag: string): string {
    return tag.toLowerCase().trim().replaceAll(/\s+/g, ' ');
}

/**
 * The descriptors a preset's tags name. A corrective descriptor names a fault removed from a
 * source, which no preset's character tag claims, so a tag never resolves to one.
 */
function resolveDescriptors(tags: ReadonlySet<string>): MixRecipeDescriptor[] {
    return MIX_RECIPE_DESCRIPTORS.filter(
        (descriptor) =>
            MIX_RECIPE_DESCRIPTOR_EFFECTS[descriptor] === 'produces' &&
            MIX_RECIPE_DESCRIPTOR_TERMS[descriptor].some((term) => tags.has(term))
    );
}

/** The roles a preset names, by its category or by a tag that is itself a role. */
function resolveRoles(category: string, tags: ReadonlySet<string>): MixRecipeRole[] {
    return MIX_RECIPE_ROLES.filter((role) => role === category || tags.has(role));
}

/**
 * One parameter the preset stores, as a window that holds exactly that value. Null when the device
 * declares no such parameter, the value lies outside what the parameter declares, or the parameter
 * would snap the value to another setting, because that value could not be written as stored.
 */
function toParameterTarget(
    descriptor: PluginDescriptor,
    paramId: string,
    value: number
): MixRecipeParameterTarget | null {
    const declared = descriptor.parameters.find((parameter) => parameter.id === paramId);
    if (
        declared === undefined ||
        !Number.isFinite(value) ||
        value < declared.minValue ||
        value > declared.maxValue ||
        quantiseDeviceParameterValue({ deviceType: descriptor.id, paramId, value }) !== value
    ) {
        return null;
    }
    return { paramId, minimum: value, maximum: value };
}

/** Null when the device is not an effect, or any stored value cannot be represented. */
function toInsertStep(device: DevicePreset): MixRecipeStep | null {
    const descriptor = getPluginById(device.type);
    if (descriptor === undefined || (descriptor.category !== 'effect' && descriptor.category !== 'utility')) {
        return null;
    }
    const parameters: MixRecipeParameterTarget[] = [];
    for (const [paramId, value] of Object.entries(device.parameterValues)) {
        const target = toParameterTarget(descriptor, paramId, value);
        if (target === null) {
            return null;
        }
        parameters.push(target);
    }
    return { kind: 'insert', deviceType: device.type, parameters };
}

function toInsertSteps(preset: SoundPreset): MixRecipeStep[] | null {
    const steps: MixRecipeStep[] = [];
    for (const device of preset.devices) {
        const step = toInsertStep(device);
        if (step === null) {
            return null;
        }
        steps.push(step);
    }
    return steps.length === 0 ? null : steps;
}

function describeSource(preset: SoundPreset, descriptor: MixRecipeDescriptor): string {
    return `Factory preset "${preset.name}" (${preset.id}). Its ${descriptor} descriptor and roles are read from the preset's authored tags and category, not measured. A character tag records what the preset's author intended and is not proof of the algorithm any device in the chain runs. Each parameter is the value the preset stores.`;
}

/**
 * Publishes factory presets that are effect chains as recipes of the catalog's own shape.
 *
 * Each device becomes an `insert` step in chain order and each stored parameter becomes a window
 * whose minimum equals its maximum, so expanding the recipe writes the stored values and nothing
 * the preset did not author. A preset is published only when every device is an effect, every stored
 * value is one its parameter declares, its tags name at least one produced descriptor, and its
 * category or tags name at least one role; otherwise nothing is guessed and it is not published. A
 * preset naming several descriptors yields one recipe for each. Prerequisites, contraindications and
 * metrics stay empty, because the catalog defines them per recipe and not per descriptor.
 */
export function buildPresetMixRecipes(presets: readonly SoundPreset[]): MixRecipe[] {
    return presets.flatMap((preset): MixRecipe[] => {
        const tags = new Set(preset.tags.map(normalizeTag));
        const descriptors = resolveDescriptors(tags);
        const roles = resolveRoles(preset.category, tags);
        if (descriptors.length === 0 || roles.length === 0) {
            return [];
        }
        const steps = toInsertSteps(preset);
        if (steps === null) {
            return [];
        }
        const presetVersion = getPresetContractVersion(preset);
        return descriptors.map((descriptor) => ({
            id: `preset:${preset.id}:${descriptor}`,
            origin: { kind: 'preset', presetId: preset.id, presetVersion, tags: [...preset.tags] },
            descriptor,
            roles,
            title: `Factory preset "${preset.name}", authored as ${descriptor}`,
            steps,
            prerequisites: [],
            contraindications: [],
            metrics: [],
            source: describeSource(preset, descriptor),
        }));
    });
}
