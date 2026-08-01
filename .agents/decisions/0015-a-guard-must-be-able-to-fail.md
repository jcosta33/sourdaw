---
type: adr
id: 0015
title: A guard must be able to fail, and a census must enumerate from a registry
status: accepted
date: 2026-08-01
owner: The Sourdaw team
sources:
  - .agents/artifacts/sourdaw/SURVEY-ultracode-scope.md
---

# 0015 — A guard must be able to fail

## Context

Eleven findings in the whole-application survey are guards whose only reachable verdict is the one
they already have. They are not weak tests; they are tests that cannot fail. A sample:

- A census whose *selector* is the same allow-list whose regrowth it claims to prevent
  (`offlineAutomationCoverage.spec.ts:104-112`).
- A toolchain pin that compares a generated manifest against the constant that wrote it
  (`verify-wasm-artifacts.ts:57` vs `wasm-artifacts.ts:44`).
- A payload guard whose predicate names a field the payload does not have, so it can only ever
  return false (`validateActionPayload.ts:195`).
- Fifteen assertions in a renderer spec terminating in `expect(handles.draw).toHaveBeenCalled()`.

The pattern is older than this survey. A device-write census went blind and spent 41 commits
comparing an empty extraction against a four-element expectation. A conformance test exempted Grand
Boule from declaring a render tail on the grounds that "physical-model ring-out is bounded by its
note release" — a justification the exempted code disproves. A dropout counter reported zero for the
single worst outcome it existed to detect. Two tests were deleted during the last campaign because
no mutation could red them; one had survived twenty-one of twenty-one.

These are not isolated defects. They are one defect, and it compounds: a guard that cannot fail
makes the thing it guards *look* covered, which is worse than no guard at all, because it stops
anyone else from writing a real one.

## Decision

**Any check added or modified from now on must be able to fail, and that must be demonstrated.**

Four rules.

**1. A guard ships with the mutation that reds it.** State, in the PR, which assertion goes red and
what one-line change to the code under test makes it go red. A guard for which no such mutation
exists is decoration; delete it and say so, rather than keeping it because it is green.

**2. A census enumerates its population from a registry, not from a list.** It must (i) derive its
population from the same registry production uses, (ii) assert a verdict per member, (iii) carry
exemptions in a named, reason-bearing table, and (iv) ship with a deliberately broken fixture
proving it can go red. A census whose population and whose expectation come from the same place
tests nothing.

**3. A pin compares two independently-sourced values.** Comparing a generated artifact against the
constant that generated it is a tautology wearing a pin's clothes.

**4. An absence assertion requires a presence pin.** `expect(matches(text, /Foo|Bar/g)).toHaveLength(0)`
is satisfied forever by an extraction that has gone blind. Whatever the pattern looks for must be
asserted to exist somewhere, or renaming it silently disarms the check.

## Consequences

- **Positive.** The largest recurring defect class in this codebase gets a mechanical stop. Reviewers
  get one question that catches all four sub-shapes: *what makes this red?*
- **Negative.** Writing a guard costs more. A deliberately broken fixture is real work, and the
  mutation demonstration is a step people will want to skip when the change is small.
- **Not retroactive.** The eleven existing instances are survey findings with their own scheduling;
  this ADR does not require fixing them before other work. It requires not creating new ones — and
  it requires that any of the eleven that *is* touched comes out compliant rather than merely
  passing.
- **On deleting tests.** This ADR explicitly sanctions deleting a green test that cannot fail. That
  normally reads as reducing coverage, so the PR must say which guard was deleted, what mutation
  proved it inert, and what — if anything — now covers the property. A deleted decoration is an
  improvement; a quietly deleted real guard is not, and the difference is the mutation evidence.

## Non-goals

Not a coverage target. Not a requirement that every test be a mutation test. This governs *guards* —
checks whose purpose is to stop something regressing — not ordinary behavioural tests, though the
"what makes this red?" question is worth asking of those too.

## Status

accepted
