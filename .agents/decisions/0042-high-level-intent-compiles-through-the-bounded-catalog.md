---
type: adr
id: 0042
title: A high-level request compiles through the bounded catalog or declines
status: accepted
date: 2026-09-03
owner: The Sourdaw team
sources:
    - src/modules/AiRuntime/useCases/agentReference/bridgeGroundedLlmToolCalls.ts
    - src/modules/AiRuntime/useCases/agentToolCatalog.ts
    - src/modules/AiRuntime/useCases/applicationOwnedToolLoop.ts
    - src/modules/AiRuntime/useCases/compileArbitraryCommandList.ts
    - src/modules/AiRuntime/useCases/parsePromptToActions.ts
    - src/modules/AiRuntime/models/PlanningOutcome.ts
    - src/modules/AiRuntime/models/SemanticCommandList.ts
    - src/modules/AiRuntime/transformers/llmActionBridge.ts
    - src/modules/AiRuntime/transformers/promptParser/hasHighLevelCreationEvidence.ts
    - src/modules/Command/useCases/executableAppActionRegistry.ts
    - src/utils/midiNoteBatchLimits.ts
    - .agents/decisions/0041-llm-batch-local-track-and-clip-bindings.md
    - https://github.com/jcosta33/sourdaw/issues/3276
---

# 0042 - A high-level request compiles through the bounded catalog or declines

## Context

[ADR 0041](0041-llm-batch-local-track-and-clip-bindings.md) made track, clip and note creation
expressible as one atomic plan. What it did not settle is what the application does with a request
that is _musical_ rather than _operational_ — a request that names an intent instead of the commands
that satisfy it.

Two failure modes were available to such a request and both are unacceptable. The provider could
invent a route the application never disclosed, which the catalog exists to prevent. Or it could
return nothing, which the user reads as the feature being broken, with no way to tell an ambiguous
request apart from a capability the product does not have.

A high-level request also raises a budget question the operational path never had to answer. An
operational request creates what the user named; a musical one creates as much as the provider
decides it needs, and every created object is something a musician must inspect and undo.

## Decision

A request that the application cannot satisfy from one disclosed command is compiled, not guessed.
The provider searches the command index for the capabilities the request needs, discovers the exact
canonical schemas those searches returned, and returns one ordinary `command.batch.propose`. There
is no separate creative route: the batch that a musical request produces is the same batch an
operational one produces, and it meets every gate that already stands in front of a mutation.

A run that produces no batch says which kind of nothing it produced. `command.batch.decline` is a
terminal call carrying a bounded `kind`, a `reason`, and up to four questions. `clarify` means the
request is ambiguous about authority, target or scope, and it is refused unless it carries at least
one question — a clarification that asks nothing is indistinguishable from a refusal. `unsupported`
means no command exists for a required capability, and it is refused unless the run actually
searched the command index, because a provider that declines over vocabulary it never looked up is
guessing about the product's capabilities. A decline may not ride alongside a call that produces a
batch: the outcome of a turn is either a proposal or a refusal, never both.

Every planner result therefore classifies itself. `PlanningOutcome` is that classification, and one
transformer turns it into the sentence a user reads, so the prompt bar and the chat panel can never
phrase the same decline two different ways.

Creation carries its own budget, separate from the list and command budgets. The bound is on
expanded commands rather than authored items, so a `repeat` cannot smuggle a wider creation batch
past an item budget that counts the loop once.

`addNotes` becomes discoverable, because a plan that creates a clip and cannot fill it is not worth
compiling. Its note count is bounded by one shared constant read by the schema the provider is
shown, the bridge that admits a provider call, and the owner that validates materialized arguments.
Three readers of one constant is the point: a bound that only one route enforces is a bound the
other routes will disagree about.

The numeric budgets reach the provider by interpolation from the constants that enforce them. A
prompt that states a limit as a literal is wrong the first time the limit moves, and it fails
silently, because a provider that respects a stale number simply proposes less than it may.

## Plan-created object evidence

Grounding admits a command only against vocabulary the request actually used. A musical request never
names the track, the clip or the beats a plan invents, so that evidence cannot exist for a created
object, and requiring it would refuse every high-level request by construction.

The authority per-action evidence protects is authority over things that already exist. A command
that touches only objects the same batch creates therefore takes a separate route, admitted when the
request carries creation evidence, the batch arrived as a normalized plan, and every target the
command names resolves to a batch-local binding this batch produced. On that route the per-action
intent phrase, the literal name and the explicit beat range are replaced by structural bounds: a
provider-chosen name must be a safe project name, and a clip span may not exceed the batch clip span
budget.

The route never admits authority over the project itself. A command naming any existing object keeps
the ordinary rules, and so does every value that reaches beyond the created objects — tempo, time
signature and routing to buses the user already has. A creative request that never states a tempo
therefore still cannot set one.

Creation evidence is read from the user request and from nothing else. Project data must never reach
that text: a stored track named like a creative request would otherwise buy a waiver the user never
asked for, which turns a project field into an authority escalation.

## Consequences

A musician can ask for music. The request reaches the same command catalog, the same compiler, the
same preflight and the same undo entry as any other request, so nothing about the batch is special
by the time it mutates the project.

Refusal becomes a product surface rather than an absence. The cost is that two decline kinds are now
part of the provider contract and must stay honest: each one is admitted only against evidence the
application holds — a question for `clarify`, a command-index receipt for `unsupported` — rather
than against the provider's own claim about itself.

The creation budget is deliberately small. It bounds what one accepted proposal can put in front of
a musician to review, not what the product can build; a larger arrangement is more than one
accepted batch.

This decision extends ADR 0041. It does not supersede it.
