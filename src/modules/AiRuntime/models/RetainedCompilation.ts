/**
 * One command an application compiler lowered into the batch: its own key, the emitting step, the
 * catalog operation and arguments, the batch-local binding it mints (or `null`), and the keys of the
 * earlier commands of the same compilation it depends on. The declarative transform compiler
 * produces this shape, and recipe expansion lowers to the same one, so adoption has a single path.
 */
export type RetainedCommand = {
    key: string;
    stepId: string;
    operation: string;
    arguments: Readonly<Record<string, unknown>>;
    reason: string;
    expectedEffect: string;
    binding: string | null;
    dependencyKeys: readonly string[];
};

/** What grounding and materialization read of any compilation a proposal adopts. */
export type RetainedCommandSet = {
    callId: string;
    revision: string;
    commands: readonly RetainedCommand[];
};

/** Which recipe a batch adopted and what it was adopted for: the provenance an approval shows. */
export type AdoptedRecipe = {
    recipeId: string;
    title: string;
    targetId: string;
};

/**
 * What a successful application compiler call leaves behind for a later `command.batch.propose` to
 * adopt by call id through `compiledCallIds`. A transform document and a recipe expansion both
 * lower to ordinary catalog commands the application emitted, so one reference list names either
 * and the kind only says which compiler's revision and provenance the entry carries.
 */
export type RetainedCompilation = RetainedCommandSet &
    ({ kind: 'transform' } | { kind: 'recipe'; recipe: AdoptedRecipe });
