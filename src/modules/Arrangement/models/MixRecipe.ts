/**
 * Versioned mixing-recipe vocabulary: what a perceptual request means in terms
 * of devices, parameter ranges, and the measurements the change should move.
 *
 * The application owns this knowledge. A recipe is authored data, not a model
 * completion: it names ordered device work, the native-unit window each
 * parameter should land in, the conditions under which it applies, and the
 * objective metrics that ought to move if it worked. A planner reads the
 * catalog and adapts a recipe to one concrete source; it never invents the
 * mixing move itself.
 *
 * Parameter windows are expressed in the parameter's own unit — dB, Hz, ms,
 * ratio, unit interval, or a `choice` index — so a reader can compare a recipe
 * against a device descriptor without a conversion step.
 */

/**
 * The perceptual words a request can carry.
 *
 * Eleven of them name a quality to add. Two are corrective and name the fault
 * being removed rather than the quality being added: a `muddy` recipe makes a
 * source *less* muddy, and a `thin` recipe makes a source *less* thin. Reading
 * either as an instruction to add the fault inverts the recipe.
 */
export const MIX_RECIPE_DESCRIPTORS = [
    'warm',
    'bright',
    'tight',
    'punchy',
    'wide',
    'intimate',
    'dark',
    'airy',
    'muddy',
    'thin',
    'glued',
    'lo-fi',
    'vintage',
] as const;

export type MixRecipeDescriptor = (typeof MIX_RECIPE_DESCRIPTORS)[number];

/** The kind of source a recipe was authored against. */
export const MIX_RECIPE_ROLES = ['vocal', 'drums', 'bass', 'guitar', 'keys', 'bus', 'master'] as const;

export type MixRecipeRole = (typeof MIX_RECIPE_ROLES)[number];

/**
 * The objective measurements recipes in this catalog claim to move.
 *
 * Every entry is also an AudioAnalysis objective metric id. The list is
 * restated here rather than imported because Arrangement does not depend on
 * AudioAnalysis; the catalog spec holds the two lists together.
 */
export const MIX_RECIPE_METRIC_IDS = [
    'integratedLoudness',
    'shortTermLoudnessMax',
    'truePeak',
    'rms',
    'crestFactor',
    'dynamicRangeEstimate',
    'spectralCentroid',
    'spectralRolloff',
    'frequencyBandEnergy',
    'stereoCorrelation',
    'sideEnergyFraction',
    'lowFrequencyStereoContent',
    'transientDensity',
    'interTrackMasking',
    'busHeadroom',
] as const;

export type MixRecipeMetricId = (typeof MIX_RECIPE_METRIC_IDS)[number];

/** Spectral bands a band-resolved metric expectation can name. */
export const MIX_RECIPE_BANDS = ['sub', 'bass', 'low-mid', 'mid', 'high-mid', 'presence', 'air'] as const;

export type MixRecipeBand = (typeof MIX_RECIPE_BANDS)[number];

/**
 * One measurable consequence of applying a recipe.
 *
 * `band` resolves a band-wise metric to the band the recipe acts on and is
 * meaningful only for `frequencyBandEnergy`. `hold` states that the recipe is
 * expected to leave the metric where it was, which is a claim a planner can
 * falsify just as readily as a direction.
 */
export type MixRecipeMetricExpectation = {
    metric: MixRecipeMetricId;
    band?: MixRecipeBand;
    direction: 'increase' | 'decrease' | 'hold';
};

/** The window a parameter should land in, in that parameter's native unit. */
export type MixRecipeParameterTarget = {
    paramId: string;
    minimum: number;
    maximum: number;
};

/**
 * One ordered piece of device work.
 *
 * `insert` adds a device of `deviceType` after the chain's current contents, or
 * after the step before it when a recipe inserts more than one. `edit` retunes
 * a device of `deviceType` that the chain already holds, so a recipe carrying
 * an `edit` step states that requirement in its prerequisites.
 */
export type MixRecipeStep = {
    kind: 'insert' | 'edit';
    deviceType: string;
    parameters: readonly MixRecipeParameterTarget[];
};

/**
 * One authored mixing move.
 *
 * `prerequisites` are the conditions the source must already satisfy,
 * `contraindications` the conditions under which the move makes the mix worse,
 * and `source` the engineering rationale for the windows chosen.
 */
export type MixRecipe = {
    id: string;
    descriptor: MixRecipeDescriptor;
    roles: readonly MixRecipeRole[];
    title: string;
    steps: readonly MixRecipeStep[];
    prerequisites: readonly string[];
    contraindications: readonly string[];
    metrics: readonly MixRecipeMetricExpectation[];
    source: string;
};

/**
 * Catalog schema version.
 *
 * A reader that does not recognise the version must decline the catalog rather
 * than guess at the shape behind it.
 */
export const MIX_RECIPE_CATALOG_VERSION = 1;

export type MixRecipeCatalog = {
    version: typeof MIX_RECIPE_CATALOG_VERSION;
    descriptors: readonly MixRecipeDescriptor[];
    roles: readonly MixRecipeRole[];
    recipes: readonly MixRecipe[];
};
