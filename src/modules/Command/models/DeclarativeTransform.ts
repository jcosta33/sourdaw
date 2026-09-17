/**
 * The contract for a declarative transform document: a versioned, seeded, bounded description of
 * project edits that the command compiler lowers into ordinary commands before anything executes.
 *
 * Command owns the contract because the compiler reads it and emits envelopes this module already
 * defines. A document carries no script, no callback and no free iteration: every loop is a selector
 * with a declared limit, every arithmetic value carries a unit, and every emitted command names an
 * operation the executable registry already publishes.
 */

import { MIDI_TRANSFORM_MAX_SEED } from './MidiTransform';

export const DECLARATIVE_TRANSFORM_SCHEMA_VERSION = 1 as const;

/** The most items one selector may yield, so a document cannot walk an unbounded project. */
export const DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT = 64;

/** The most commands one compilation may produce, whatever nesting the steps declare. */
export const DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS = 128;

export const DECLARATIVE_TRANSFORM_MAX_VARIABLES = 32;

export const DECLARATIVE_TRANSFORM_MAX_EXPRESSION_DEPTH = 8;

export const DECLARATIVE_TRANSFORM_MAX_STEP_DEPTH = 4;

/** Seeds share the MIDI transform bounds: the same 32-bit generator state backs both. */
export const DECLARATIVE_TRANSFORM_MIN_SEED = 0;
export const DECLARATIVE_TRANSFORM_MAX_SEED = MIDI_TRANSFORM_MAX_SEED;

export const DECLARATIVE_TRANSFORM_UNITS = ['beats', 'seconds', 'semitones', 'db', 'ratio', 'count', 'bpm'] as const;

export type DeclarativeTransformUnit = (typeof DECLARATIVE_TRANSFORM_UNITS)[number];

/** The units a scaling factor may carry: multiplying beats by beats is not a musical quantity. */
export const DECLARATIVE_TRANSFORM_SCALING_UNITS: readonly DeclarativeTransformUnit[] = ['count', 'ratio'];

/**
 * The catalog commands whose emitted command may mint a batch-local `$binding`
 * ([ADR 0041](../../../.agents/decisions/0041-llm-batch-local-track-and-clip-bindings.md)).
 * `addDevice` mints an identity for its own replay but stays off the binding grammar, because a
 * device is addressable only inside an owner that already exists.
 */
export const DECLARATIVE_TRANSFORM_BINDING_PRODUCERS = ['createBus', 'addTrack', 'addClip'] as const;

export type TransformQuantity = { unit: DeclarativeTransformUnit; value: number };

export type TransformSnapshotClip = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
};

export type TransformSnapshotTrack = {
    id: string;
    name: string;
    contentType: 'audio' | 'midi' | null;
    clips: readonly TransformSnapshotClip[];
};

/**
 * The whole of the project a compilation may read. It is Command-owned and immutable: the caller
 * projects its own read model into this shape, so the compiler depends on no store and two runs over
 * the same snapshot cannot disagree.
 */
export type TransformSnapshot = {
    revision: string;
    tempo: number;
    timeSignature: readonly [number, number];
    tracks: readonly TransformSnapshotTrack[];
};

export type TransformItemTarget = 'track' | 'clip';

export type TransformExpression =
    | { node: 'const'; quantity: TransformQuantity }
    | { node: 'var'; name: string }
    | { node: 'add'; left: TransformExpression; right: TransformExpression }
    | { node: 'sub'; left: TransformExpression; right: TransformExpression }
    | { node: 'mul'; left: TransformExpression; right: TransformExpression }
    | { node: 'div'; left: TransformExpression; right: TransformExpression }
    | { node: 'random'; min: TransformExpression; max: TransformExpression }
    | { node: 'field'; item: string; field: 'startBeat' | 'endBeat' | 'length' }
    | { node: 'index'; item: string }
    | { node: 'secondsToBeats'; value: TransformExpression }
    | { node: 'beatsToSeconds'; value: TransformExpression };

export type TransformSelectorFilter = {
    contentType?: 'audio' | 'midi' | null;
    nameIncludes?: string;
    trackId?: string;
    startsAtOrAfterBeat?: number;
    endsAtOrBeforeBeat?: number;
};

/** `limit` is required: a selector without a declared ceiling is unbounded iteration. */
export type TransformSelector = {
    target: TransformItemTarget;
    where?: TransformSelectorFilter;
    limit: number;
};

export type TransformComparison = 'lt' | 'le' | 'eq' | 'ge' | 'gt';

export type TransformCondition =
    | { cmp: TransformComparison; left: TransformExpression; right: TransformExpression }
    | { all: readonly TransformCondition[] }
    | { any: readonly TransformCondition[] };

export type TransformArgument =
    TransformExpression | { literal: string | number | boolean } | { itemId: string } | { bindingRef: string };

export type TransformStep =
    | { id: string; kind: 'each'; selector: string; as: string; body: readonly TransformStep[] }
    | { id: string; kind: 'when'; condition: TransformCondition; then: readonly TransformStep[] }
    | {
          id: string;
          kind: 'emit';
          operation: string;
          arguments: Readonly<Record<string, TransformArgument>>;
          binding?: string;
          dependsOn?: readonly string[];
      };

export type TransformAssertion = { condition: TransformCondition; message: string };

export type DeclarativeTransformDocument = {
    schemaVersion: number;
    name: string;
    seed: number;
    variables: Readonly<Record<string, TransformExpression>>;
    selectors: Readonly<Record<string, TransformSelector>>;
    steps: readonly TransformStep[];
    assertions: readonly TransformAssertion[];
};

/**
 * One lowered command. `binding` names the batch-local identity this command mints, and
 * `dependencyStepIds` names the emitted steps it must follow — both the steps it declared and the
 * ones its `$binding` arguments read.
 */
export type CompiledTransformCommand = {
    stepId: string;
    operation: string;
    arguments: Readonly<Record<string, unknown>>;
    reason: string;
    expectedEffect: string;
    binding: string | null;
    dependencyStepIds: readonly string[];
};

export type DeclarativeTransformCompilation =
    { status: 'compiled'; commands: readonly CompiledTransformCommand[] } | { status: 'rejected'; reason: string };

/** One resolved selector item, with the span a `field` expression reads. A track has no span. */
export type TransformItemBinding = {
    index: number;
    id: string;
    name: string;
    target: TransformItemTarget;
    span: { startBeat: number; endBeat: number } | null;
};
