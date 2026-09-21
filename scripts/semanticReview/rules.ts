/**
 * The atomic question set, the versioned policy, and the budget profiles.
 *
 * Questions and configuration come from trusted code. Each rule states one property, the evidence it
 * needs, what a yes and a no mean, and the counterexamples that must not be read as a yes — so that
 * the disposition below is a mechanical consequence of the rule set rather than a second judgement
 * laid over the model's.
 *
 * Every rule asks one property. A question that bundles two judgements returns one number that means
 * neither of them, and no threshold can recover what the bundling hid: the earlier revision asked six
 * compound questions per changed file, and this set replaces them with one yes/no question each. The
 * band between `clear` and `investigate` is where the answer is neither, which is a policy in code
 * rather than a third answer the model has to learn.
 *
 * These are proposed assessment tasks, not claims of demonstrated accuracy. Every threshold here is
 * provisional advisory policy, not proven calibration, and `rulesDigest` covers the declarative parts
 * of the set so a wording or evidence change invalidates the responses it shaped.
 */

import { e2eSpecPattern, specFilePattern } from '../vitestCollectionPatterns.ts';

import { semanticDigest } from './contracts.ts';

/**
 * The disposition vocabulary. It is derived in code from a Noul probability rather than answered by
 * the model, so the three names survive the move to atomic questions unchanged.
 */
export const SCAN_OUTCOMES = ['signal', 'no_signal', 'insufficient_context'] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

/**
 * The one threshold that turns a probability into a disposition: at or above it the concern is
 * flagged, below it the question is not raised.
 *
 * There is deliberately no second edge. The provider's own verifier gates on a single fire
 * threshold, and its published per-field values sit at 0.02-0.16 on correct work against 0.85-0.95 on
 * a real error, with a genuinely ambiguous head at 0.58 left unflagged — so a value below the
 * threshold is an ordinary no, not a third state. `insufficient_context` is reserved for evidence the
 * application knows it did not send, which is a fact rather than a probability.
 */
export type RuleThresholds = {
    readonly fire: number;
};

export type RuleInvestigationCategory =
    'test-validity' | 'project-integrity' | 'realtime' | 'security-platform' | 'architecture-integration';

export type SemanticRuleId =
    | 'assertion_deleted'
    | 'observable_assertion_removed'
    | 'observable_replaced_by_internal'
    | 'assertion_condition_loosened'
    | 'real_collaborator_mocked'
    | 'conditional_admission_added'
    | 'test_skipped_or_excluded'
    | 'production_path_no_longer_reached'
    | 'admission_branch_completes_without_asserting'
    | 'coverage_moved_to_weaker_tier'
    | 'persisted_shape_changed_without_migration'
    | 'mutation_outside_undo_path'
    | 'silent_data_loss_possible'
    | 'stated_invariant_contradicted'
    | 'audio_thread_allocation'
    | 'timing_semantics_changed'
    | 'public_contract_widened_silently'
    | 'forbidden_dependency_direction'
    | 'duplicates_existing_mechanism'
    | 'gate_weakened'
    | 'advisory_result_claims_authority';

export type SemanticRule = {
    readonly id: SemanticRuleId;
    readonly version: string;
    /** The plain statement of what the question is for, so a reader can audit the wording. */
    readonly purpose: string;
    /** Path prefixes a change must touch for the rule to be applicable; part of the rules digest. */
    readonly applicabilityPaths: readonly string[];
    readonly appliesTo: (path: string) => boolean;
    readonly requiredEvidence: readonly string[];
    /** The one yes/no question. The model answers it about the supplied state, nothing else. */
    readonly instructions: string;
    readonly criteria: { readonly true: string; readonly false: string };
    readonly counterexamples: readonly string[];
    readonly investigationCategory: RuleInvestigationCategory;
    readonly thresholds: RuleThresholds;
};

/** One bounded question per rule, all answered over the same evidence. */
export type SemanticQuestion = {
    readonly type: 'noul';
    readonly instructions: string;
    readonly criteria: { readonly true: string; readonly false: string };
};

export const SEVERITY_DISPOSITION_TIMELINE: readonly RuleInvestigationCategory[] = [
    'security-platform',
    'realtime',
    'project-integrity',
];

const TEST_PATHS = ['**/__tests__/', '**/*.spec.*', '**/*.test.*'] as const;
const PROJECT_PATHS = ['src/modules/Project/', 'src/modules/Crdt/', 'src/modules/History/', 'src/app/'] as const;
const REALTIME_PATHS = ['crates/daw-dsp/', 'src/modules/AudioEngine/', 'public/wasm/'] as const;
const BOUNDARY_PATHS = ['src/modules/', 'src/infra/', 'src/helpers/', 'src/utils/', 'scripts/', 'electron/'] as const;
const GATE_PATHS = ['.github/', 'scripts/healthGate', 'scripts/semanticReview', 'package.json'] as const;
const MODULE_AND_APP_PATHS = ['src/modules/', 'src/app/'] as const;

/**
 * The code extensions the wider `__tests__/`-resident test applicability below uses. Collection itself
 * is decided by the shared runner pattern in `checkVitestCollectionScope.ts`, so the two can no longer
 * drift apart; this set remains because applicability also admits an assertion-carrying code file
 * without a runner suffix.
 */
const CODE_EXTENSION_SET = '(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)';
const CODE_EXTENSIONS = new RegExp(`\\.${CODE_EXTENSION_SET}$`, 'u');

/**
 * Whether some runner executes this path as a test.
 *
 * The suffix and code-extension test comes from the runner pattern `checkVitestCollectionScope.ts`
 * already computes, and the `**\/*.e2e.spec.*` exclusion Vitest declares is applied from that same
 * module rather than restated here. `tests/e2e` stays collected because Playwright runs it and
 * `server/__tests__` because node:test runs it — neither is inside Vitest's collectable roots, so
 * reusing that module's Vitest-only predicate would newly drop both.
 */
export function isCollectedSpec(path: string): boolean {
    if (!specFilePattern.test(path)) {
        return false;
    }
    // The exclusion removes the path from Vitest's root; outside `tests/e2e` no other runner collects
    // it, so the file is not executed as a test anywhere.
    if (e2eSpecPattern.test(path) && !path.startsWith('tests/e2e/')) {
        return false;
    }
    return true;
}

/**
 * Whether a path holds test material for rule applicability, decided by suffix alone or by living
 * under `__tests__/` with a code extension.
 *
 * This is deliberately broader than `isCollectedSpec`, and the two predicates answer different
 * questions. Collection is decided by the runner's suffix and code extensions, and that is what
 * excludes implementation evidence. Applicability is wider because the repository also keeps
 * assertion-carrying suites in `__tests__/` without a runner suffix: `providerProtocolConformance.ts`
 * is a conformance suite three contract specs import and execute, and `expectExternalProjectLink.ts`
 * is an assertion helper three specs import. Classifying those as implementation dropped the whole
 * test-validity family from them.
 *
 * The honest trade-off: a `.ts` fixture or dummy directly inside `__tests__/` is now test material, so
 * a test-validity question may be asked about a file that carries no assertion. That costs a wasted
 * question that answers low; the opposite choice silently removes the whole test-validity family from
 * real shared suites, which is the family this tool exists to ask. The extension gate is what keeps a
 * false positive out: `scripts/__tests__/fixtures/health-gate-workflows.snapshot.json` is a JSON pin
 * whose content holds shell `if` statements, and reading every `__tests__/` file as a test fired two
 * test-validity signals on it at 0.83 and 0.78.
 */
export function isTestPath(path: string): boolean {
    if (isCollectedSpec(path)) {
        return true;
    }
    return /(?:^|\/)__tests__\//u.test(path) && CODE_EXTENSIONS.test(path);
}

function matchesAny(path: string, prefixes: readonly string[]): boolean {
    return prefixes.some((prefix) => path.startsWith(prefix));
}

/**
 * A provisional band. `investigate`/`clear` are the same two numbers wherever a false yes costs what
 * a false no costs; the severe categories widen the band because acting on a wrong yes there is the
 * expensive direction, and the middle is reported unresolved rather than guessed at.
 */
const FIRE = { fire: 0.7 } as const;
const SEVERE_FIRE = { fire: 0.8 } as const;

const TEST_RULE = {
    applicabilityPaths: TEST_PATHS,
    appliesTo: isTestPath,
    requiredEvidence: ['before test source', 'after test source'],
    thresholds: FIRE,
    investigationCategory: 'test-validity',
} as const;

export const SEMANTIC_RULES: readonly SemanticRule[] = [
    {
        ...TEST_RULE,
        id: 'assertion_deleted',
        version: '1',
        purpose: 'Whether the change removes an assertion the test previously made.',
        instructions:
            'Does `before` contain an assertion that no assertion in `after` replaces? An assertion moved to another supplied region is replaced; an assertion whose expectation changed is not deleted.',
        criteria: {
            true: 'An assertion present in `before` has no counterpart in `after`, and nothing in `after` checks the same thing.',
            false: 'Every assertion in `before` is still made in `after`, possibly reworded, moved, or strengthened.',
        },
        counterexamples: [
            'An assertion reworded or split across two assertions that together check the same thing',
            'An assertion moved to another supplied region',
            'An assertion replaced by a stronger assertion of the same behaviour',
        ],
    },
    {
        ...TEST_RULE,
        id: 'observable_assertion_removed',
        version: '1',
        purpose: 'Whether an assertion on an observable outcome is gone.',
        instructions:
            'Does the change remove an assertion on an outcome a caller could observe — a returned value, persisted state, an emitted event, or a rendered result — without replacing it with another such assertion?',
        criteria: {
            true: 'An assertion on a caller-observable outcome is absent from `after` and no other supplied assertion covers that outcome.',
            false: 'Every observable outcome the test checked is still checked, or the removed assertion was about an internal detail rather than an outcome.',
        },
        counterexamples: [
            'An assertion on a log line or private field rather than an observable outcome',
            'An assertion replaced by an end-to-end check of the same outcome elsewhere',
        ],
    },
    {
        ...TEST_RULE,
        id: 'observable_replaced_by_internal',
        version: '1',
        purpose: 'Whether verification of behaviour became verification of implementation.',
        instructions:
            'Where `before` asserted an observable outcome, does `after` assert an internal call, invocation count, private field, or log line instead?',
        criteria: {
            true: 'The same behaviour is now checked through an implementation detail rather than through its observable result.',
            false: 'The assertion still concerns an observable outcome, or the implementation detail is checked in addition to the outcome.',
        },
        counterexamples: [
            'An assertion on an observable outcome that was tightened rather than replaced',
            'A new spy assertion added beside an unchanged outcome assertion',
        ],
    },
    {
        ...TEST_RULE,
        id: 'assertion_condition_loosened',
        version: '1',
        purpose: 'Whether an assertion accepts strictly more than it did.',
        instructions:
            'Does any assertion in `after` accept a strictly wider set of values or states than the corresponding assertion in `before` — an exact value becoming a truthiness or non-null check, a specific error becoming any error, a range widening?',
        criteria: {
            true: 'A concrete expectation was replaced by a weaker one that a wrong result could also satisfy.',
            false: 'Expectations are unchanged, or they became more specific rather than less.',
        },
        counterexamples: [
            'A matcher whose meaning is unchanged, such as `toEqual` to `toStrictEqual`',
            'A tolerance added for a floating-point comparison that was previously exact',
        ],
    },
    {
        ...TEST_RULE,
        id: 'real_collaborator_mocked',
        version: '1',
        purpose: 'Whether a real collaborator was replaced by a stub.',
        instructions:
            'Does `after` introduce a mock, stub, or fake in place of a real collaborator the test previously exercised, so the behaviour under test is no longer reached?',
        criteria: {
            true: 'A collaborator that previously ran for real is replaced by a stand-in inside this test.',
            false: 'No collaborator was replaced, or the replacement is at a boundary the test never intended to exercise.',
        },
        counterexamples: [
            'A stand-in that already existed in `before`',
            'A test double for a network or device boundary that was always faked',
        ],
    },
    {
        ...TEST_RULE,
        id: 'conditional_admission_added',
        version: '1',
        purpose: 'Whether a new condition lets the case reach its end without asserting.',
        instructions:
            'Does `after` wrap part or all of the case in a condition — a visibility, availability, or support check with a silent fallback — so the case can complete green without having asserted anything?',
        criteria: {
            true: 'There is an input, state, or environment in which the case runs to completion without executing an assertion.',
            false: 'Every path through the case executes at least one assertion, or the condition throws instead of passing silently.',
        },
        counterexamples: [
            'A guard that throws or fails when the entry point is absent',
            'A condition around setup whose assertions run in all branches',
        ],
    },
    {
        ...TEST_RULE,
        id: 'test_skipped_or_excluded',
        version: '1',
        purpose: 'Whether a test stopped running.',
        instructions:
            'Does the change mark a test skipped, focused, or excluded from collection, or add it to an ignore list?',
        criteria: {
            true: 'A previously running test no longer runs on the default path.',
            false: 'No test was skipped, focused, or excluded, or an exclusion was removed.',
        },
        counterexamples: [
            'A test that remains run and gained a narrower name',
            'A conditional skip that already existed',
        ],
    },
    {
        ...TEST_RULE,
        // This is the one test rule that reads something outside the test, because "the test still
        // reaches the production path" is a claim about the implementation as well.
        requiredEvidence: ['before test source', 'after test source', 'after implementation source'],
        id: 'production_path_no_longer_reached',
        version: '1',
        purpose: 'Whether the test still reaches the production code it names.',
        instructions:
            'Comparing `before`, `after`, and `after implementation source`: does the test now exercise a stub, an admission branch, or a fixture instead of the production path it previously reached?',
        criteria: {
            true: 'The production path the test asserted through is no longer on the test’s execution path, and the assertions still pass.',
            false: 'The test still reaches the production implementation it names, or the supplied implementation source shows the path unchanged.',
        },
        counterexamples: [
            'A test that legitimately exercises a boundary adapter instead of the engine',
            'A production path that was renamed while remaining the path under test',
        ],
    },
    {
        ...TEST_RULE,
        id: 'admission_branch_completes_without_asserting',
        version: '1',
        purpose: 'Whether a new branch in the case asserts nothing.',
        instructions:
            'Does `after` add a branch whose body contains no assertion and does not fail — an early return, a `catch` that swallows, or an alternative path that simply ends?',
        criteria: {
            true: 'At least one new branch can complete without asserting and without failing the case.',
            false: 'Every branch asserts, fails, or throws.',
        },
        counterexamples: ['A branch that calls a shared assertion helper', 'A catch that rethrows or fails the test'],
    },
    {
        ...TEST_RULE,
        id: 'coverage_moved_to_weaker_tier',
        version: '1',
        purpose: 'Whether the same behaviour is now covered only by a weaker check.',
        instructions:
            'Does `after` remove coverage at this tier while the behaviour is collected only by a slower, broader, or less specific check — a smoke set, a snapshot, or a manual step?',
        criteria: {
            true: 'The behaviour lost its focused check and the remaining coverage is materially weaker or conditional.',
            false: 'The behaviour is still covered at this tier, or the replacement check is at least as strong.',
        },
        counterexamples: ['Coverage moved to another unit test', 'A duplicate removed where an equal check remains'],
    },
    {
        id: 'persisted_shape_changed_without_migration',
        version: '1',
        purpose: 'Whether a persisted shape changed without a migration.',
        applicabilityPaths: PROJECT_PATHS,
        appliesTo: (path) => matchesAny(path, PROJECT_PATHS),
        requiredEvidence: ['before source', 'after source', 'migration or version contract'],
        instructions:
            'Does the change alter the shape of persisted project data — a field added, removed, renamed, or reinterpreted — without a migration, version bump, or reader that accepts both shapes?',
        criteria: {
            true: 'Data written before the change would be read incorrectly, dropped, or rejected after it.',
            false: 'The shape is unchanged, or a supplied migration or versioned reader handles the old shape.',
        },
        counterexamples: [
            'An additive optional field that older readers ignore',
            'A change to an in-memory shape that is never persisted',
        ],
        investigationCategory: 'project-integrity',
        thresholds: SEVERE_FIRE,
    },
    {
        id: 'mutation_outside_undo_path',
        version: '1',
        purpose: 'Whether project state can now change without an undo record.',
        applicabilityPaths: PROJECT_PATHS,
        appliesTo: (path) => matchesAny(path, PROJECT_PATHS),
        requiredEvidence: ['before source', 'after source', 'undo contract'],
        instructions:
            'Does the change write project state through a path that does not record an undo entry — a direct store write, a mutation in a view, or an action that bypasses the recorded command path?',
        criteria: {
            true: 'A new write reaches project truth without producing an undo step.',
            false: 'Every new write goes through the recorded path, or the write is ephemeral view state.',
        },
        counterexamples: [
            'A projection or derived value rebuilt from the document',
            'A write to state that is deliberately session-scoped and never persisted',
        ],
        investigationCategory: 'project-integrity',
        thresholds: SEVERE_FIRE,
    },
    {
        id: 'silent_data_loss_possible',
        version: '1',
        purpose: 'Whether user data can be lost without surfacing anything.',
        applicabilityPaths: PROJECT_PATHS,
        appliesTo: (path) => matchesAny(path, PROJECT_PATHS),
        requiredEvidence: ['before source', 'after source'],
        instructions:
            'Can the change drop, overwrite, or fail to persist user data while reporting success — a swallowed error, a truncation, a default that replaces a stored value, or a write that discards its failure?',
        criteria: {
            true: 'There is an input or state in which user data is lost and no error, warning, or failed result reaches the caller.',
            false: 'Failures surface to the caller, or nothing is dropped.',
        },
        counterexamples: [
            'A failed parse that reports an error and leaves the previous state intact',
            'A deliberate discard of derived, rebuildable state',
        ],
        investigationCategory: 'project-integrity',
        thresholds: SEVERE_FIRE,
    },
    {
        id: 'stated_invariant_contradicted',
        version: '1',
        purpose: 'Whether the change contradicts an invariant the repository states.',
        applicabilityPaths: MODULE_AND_APP_PATHS,
        appliesTo: (path) => matchesAny(path, MODULE_AND_APP_PATHS),
        requiredEvidence: ['before source', 'after source', 'decision or documented invariant'],
        instructions:
            'Does the change contradict an invariant, rule, or documented reason stated in the supplied contracts, decisions, or the source comments themselves?',
        criteria: {
            true: 'A statement the repository relies on is now false, or the change relies on behaviour a stated rule forbids.',
            false: 'The stated rules and invariants still hold, or the change updates them coherently.',
        },
        counterexamples: [
            'A comment that was already stale before this change',
            'A change that updates the documented invariant together with the code',
        ],
        investigationCategory: 'project-integrity',
        thresholds: FIRE,
    },
    {
        id: 'audio_thread_allocation',
        version: '1',
        purpose: 'Whether the audio thread can now allocate, lock, or block.',
        applicabilityPaths: REALTIME_PATHS,
        appliesTo: (path) => matchesAny(path, REALTIME_PATHS),
        requiredEvidence: ['before source', 'after source'],
        instructions:
            'Does the change introduce, on a path that runs while audio is being processed, an allocation, a lock, a blocking call, a filesystem or network access, or a promise awaiting work?',
        criteria: {
            true: 'Realtime code can now take an unbounded or blocking action where it previously did not.',
            false: 'The new code is on a control, preparation, or teardown path rather than the processing path.',
        },
        counterexamples: [
            'A bounded pre-allocated buffer reused per block',
            'Work moved to a worker or a non-realtime preparation pass',
        ],
        investigationCategory: 'realtime',
        thresholds: SEVERE_FIRE,
    },
    {
        id: 'timing_semantics_changed',
        version: '1',
        purpose: 'Whether timing, latency, or scheduling semantics moved.',
        applicabilityPaths: REALTIME_PATHS,
        appliesTo: (path) => matchesAny(path, REALTIME_PATHS),
        requiredEvidence: ['before source', 'after source', 'scheduling call-site'],
        instructions:
            'Does the change alter when audio events occur or how they are compensated — a scheduling order, a look-ahead, a sample offset, a latency compensation, or a clock source — without a corresponding test or contract update?',
        criteria: {
            true: 'Timing behaviour changes for some input or configuration and nothing supplied pins the new behaviour.',
            false: 'Timing semantics are unchanged, or the change is covered by an updated contract or test.',
        },
        counterexamples: [
            'A refactor that preserves the computed event times',
            'A change behind a flag that is off by default',
        ],
        investigationCategory: 'realtime',
        thresholds: SEVERE_FIRE,
    },
    {
        id: 'public_contract_widened_silently',
        version: '1',
        purpose: 'Whether a public contract grew without its callers or version.',
        applicabilityPaths: BOUNDARY_PATHS,
        appliesTo: (path) => matchesAny(path, BOUNDARY_PATHS),
        requiredEvidence: ['before source', 'after source', 'caller or contract'],
        instructions:
            'Does the change add, widen, or reinterpret an exported type, function signature, event, or IPC payload without updating the callers or the version that identifies it?',
        criteria: {
            true: 'A caller outside the changed file can now observe a different contract while the change compiles and no version moved.',
            false: 'The contract is unchanged, or the change is internal to one module and its callers.',
        },
        counterexamples: [
            'An additive optional field on a type whose readers tolerate it',
            'A purely internal helper that is not exported',
        ],
        investigationCategory: 'architecture-integration',
        thresholds: FIRE,
    },
    {
        id: 'forbidden_dependency_direction',
        version: '1',
        purpose: 'Whether the change introduces a dependency the architecture forbids.',
        applicabilityPaths: BOUNDARY_PATHS,
        appliesTo: (path) => matchesAny(path, BOUNDARY_PATHS),
        requiredEvidence: ['before source', 'after source'],
        instructions:
            'Does the change introduce an import or call that runs against the repository’s stated direction — a presentation reaching a store or I/O, an infrastructure module importing a domain module, a worklet reaching the app layer?',
        criteria: {
            true: 'A new dependency points the wrong way for the layer the file belongs to.',
            false: 'All new dependencies follow the direction the layer allows.',
        },
        counterexamples: [
            'A type-only import from a contract barrel the layer may read',
            'A dependency that already existed in the changed file',
        ],
        investigationCategory: 'architecture-integration',
        thresholds: FIRE,
    },
    {
        id: 'duplicates_existing_mechanism',
        version: '1',
        purpose: 'Whether the change adds something the repository already provides.',
        applicabilityPaths: MODULE_AND_APP_PATHS,
        appliesTo: (path) => matchesAny(path, MODULE_AND_APP_PATHS),
        requiredEvidence: ['after source', 'related existing source'],
        instructions:
            'Does the change add a helper, store, registry, or pipeline that duplicates a mechanism already present in the supplied related source, so that two owners now hold the same responsibility?',
        criteria: {
            true: 'An existing mechanism already provides this behaviour and the change adds a second one.',
            false: 'No supplied existing mechanism covers this behaviour, or the change extends the existing one.',
        },
        counterexamples: [
            'A second implementation deliberately replacing the first in the same change',
            'Two similar-looking tables keyed by genuinely different domains',
        ],
        investigationCategory: 'architecture-integration',
        thresholds: FIRE,
    },
    {
        id: 'gate_weakened',
        version: '1',
        purpose: 'Whether a check, its trigger, or its pinning was weakened.',
        applicabilityPaths: GATE_PATHS,
        appliesTo: (path) => matchesAny(path, GATE_PATHS),
        requiredEvidence: ['before source', 'after source'],
        instructions:
            'Does the change remove or soften a check, narrow a trigger so it stops covering this change, mark a job or step as non-blocking, or widen a permission?',
        criteria: {
            true: 'A gate that previously ran and could fail for this change no longer can.',
            false: 'The gates still run and still fail on a real failure, or the change strengthens one.',
        },
        counterexamples: [
            'A check moved to another workflow that still answers the same event',
            'A step made conditional only for events that never reached it before',
        ],
        investigationCategory: 'security-platform',
        thresholds: SEVERE_FIRE,
    },
    {
        id: 'advisory_result_claims_authority',
        version: '1',
        purpose: 'Whether a non-deterministic result gained authority.',
        applicabilityPaths: GATE_PATHS,
        appliesTo: (path) => matchesAny(path, GATE_PATHS),
        requiredEvidence: ['before source', 'after source'],
        instructions:
            'Can the change let a probabilistic or model-produced result approve, request changes, resolve a thread, waive a check, or merge — or be counted as a reviewer draw?',
        criteria: {
            true: 'Something other than a deterministic check or a person can now hold merge authority.',
            false: 'The result stays advisory and no gate depends on it.',
        },
        counterexamples: [
            'A model result recorded as evidence a reviewer reads',
            'A non-required check that reports delivery rather than a verdict',
        ],
        investigationCategory: 'security-platform',
        thresholds: SEVERE_FIRE,
    },
];

export function isSemanticRuleId(value: unknown): value is SemanticRuleId {
    return typeof value === 'string' && SEMANTIC_RULES.some((rule) => rule.id === value);
}

export function semanticRule(id: SemanticRuleId): SemanticRule {
    const rule = SEMANTIC_RULES.find((candidate) => candidate.id === id);
    if (rule === undefined) {
        throw new Error(`unknown semantic rule ${id}`);
    }
    return rule;
}

/** The rules whose applicability predicate admits at least one of the changed paths. */
export function applicableRules(paths: readonly string[]): SemanticRule[] {
    return SEMANTIC_RULES.filter((rule) => paths.some((path) => rule.appliesTo(path)));
}

/**
 * Thresholds applied when a candidate finding is assessed. They live here, with the rest of the
 * policy, so they are covered by `computePolicyDigest` and a verification report can identify the
 * policy that produced it. Verification still asks its own three-way Choice questions, because
 * "supported, contradicted, or undecidable from the supplied evidence" is one genuine three-valued
 * judgement rather than three properties bundled together.
 */
export const VERIFICATION_SUPPORT_THRESHOLD = 0.8;
export const VERIFICATION_ATTRIBUTION_THRESHOLD = 0.8;
export const VERIFICATION_KIND_THRESHOLD = 0.8;

/**
 * How far a returned distribution may sit from 1 before it is refused. It is policy, not plumbing: at
 * a tighter tolerance the identical answer is refused and the finding goes unassessed, so a report
 * that omitted it could name the same policy for two different outcomes.
 */
export const PROBABILITY_SUM_TOLERANCE = 0.05;

/**
 * The categories whose disputes stay visible instead of being silently discarded. Changing this set
 * changes a recorded `escalate`, so it belongs to the policy identity for the same reason.
 */
export const SEVERE_INVESTIGATION_CATEGORIES = ['security-platform', 'realtime', 'project-integrity'] as const;

/**
 * The identity of the *questions*: everything a model reads. Deliberately excludes thresholds, so a
 * threshold-only change can reinterpret a stored response without a new assessment, while any change
 * to what the model was actually asked invalidates it.
 */
export function computeRulesDigest(): string {
    return semanticDigest(
        SEMANTIC_RULES.map((rule) => ({
            id: rule.id,
            version: rule.version,
            purpose: rule.purpose,
            applicabilityPaths: [...rule.applicabilityPaths],
            requiredEvidence: [...rule.requiredEvidence],
            instructions: rule.instructions,
            criteria: { true: rule.criteria.true, false: rule.criteria.false },
            counterexamples: [...rule.counterexamples],
            investigationCategory: rule.investigationCategory,
        }))
    );
}

/**
 * The identity of the *policy*: every threshold that turns a returned probability into a disposition.
 * Recorded on every report so a stored assessment names the policy that produced it, including the
 * verification thresholds, which are absent from the question identity by design.
 */
export function computePolicyDigest(overrides: Partial<Record<SemanticRuleId, RuleThresholds>> = {}): string {
    return semanticDigest({
        rules: SEMANTIC_RULES.map((rule) => {
            const thresholds = overrides[rule.id] ?? rule.thresholds;
            return {
                id: rule.id,
                thresholds: { fire: thresholds.fire },
            };
        }),
        verification: {
            support: VERIFICATION_SUPPORT_THRESHOLD,
            attribution: VERIFICATION_ATTRIBUTION_THRESHOLD,
            kind: VERIFICATION_KIND_THRESHOLD,
        },
        probabilitySumTolerance: PROBABILITY_SUM_TOLERANCE,
        severeCategories: [...SEVERE_INVESTIGATION_CATEGORIES],
    });
}

export type SemanticProfileName = 'ci' | 'local';

/**
 * Application controls, not provider guarantees. The byte limits are conservative proxies for model
 * tokens, never a claim that the two are interchangeable.
 */
export type SemanticBudgetProfile = {
    readonly name: SemanticProfileName;
    readonly concurrentRequests: number;
    readonly maxAttempts: number;
    readonly maxRetriesPerRequest: number;
    readonly attemptTimeoutMs: number;
    readonly overallDeadlineMs: number;
    readonly maxRequestBytes: number;
    readonly maxStatePlusQuestionBytes: number;
    readonly maxTotalSubmittedBytes: number;
    readonly contextExpansionPasses: number;
};

export const SEMANTIC_BUDGET_PROFILES: Readonly<Record<SemanticProfileName, SemanticBudgetProfile>> = {
    ci: {
        name: 'ci',
        concurrentRequests: 4,
        maxAttempts: 40,
        maxRetriesPerRequest: 1,
        attemptTimeoutMs: 5_000,
        overallDeadlineMs: 120_000,
        maxRequestBytes: 48 * 1024,
        maxStatePlusQuestionBytes: 24 * 1024,
        maxTotalSubmittedBytes: 1024 * 1024,
        contextExpansionPasses: 1,
    },
    local: {
        name: 'local',
        concurrentRequests: 2,
        maxAttempts: 4,
        maxRetriesPerRequest: 0,
        attemptTimeoutMs: 3_000,
        overallDeadlineMs: 8_000,
        maxRequestBytes: 32 * 1024,
        maxStatePlusQuestionBytes: 16 * 1024,
        maxTotalSubmittedBytes: 96 * 1024,
        contextExpansionPasses: 0,
    },
};

export function assertBudgetProfile(profile: SemanticBudgetProfile): void {
    const positive = [
        profile.concurrentRequests,
        profile.maxAttempts,
        profile.attemptTimeoutMs,
        profile.overallDeadlineMs,
        profile.maxRequestBytes,
        profile.maxStatePlusQuestionBytes,
        profile.maxTotalSubmittedBytes,
    ];
    if (positive.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
        throw new Error(`budget profile ${profile.name} has a non-positive limit`);
    }
    if (!Number.isSafeInteger(profile.maxRetriesPerRequest) || profile.maxRetriesPerRequest < 0) {
        throw new Error(`budget profile ${profile.name} maxRetriesPerRequest must be zero or more`);
    }
    if (!Number.isSafeInteger(profile.contextExpansionPasses) || profile.contextExpansionPasses < 0) {
        throw new Error(`budget profile ${profile.name} contextExpansionPasses must be zero or more`);
    }
    if (profile.maxRequestBytes > profile.maxTotalSubmittedBytes) {
        throw new Error(`budget profile ${profile.name} allows one request larger than its total budget`);
    }
}
