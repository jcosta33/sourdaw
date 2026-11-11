---
type: adr
id: 0057
title: Fresh review draws stay within the economy and standard tiers
status: accepted
date: 2026-11-11
owner: The Sourdaw team
sources:
    - .agents/decisions/0054-proportional-machine-checked-review-floor.md
    - scripts/reviewerModelDiversity.ts
    - scripts/reviewStructuralAdmission.ts
    - https://github.com/jcosta33/sourdaw/pull/5699
    - https://github.com/jcosta33/sourdaw/pull/6132
---

# 0057 - Fresh review draws stay within the economy and standard tiers

## Context

ADR 0054 required one `strongest` draw for a `realtime-audio`, `native-security`, or `undo` plan.
On 2026-10-25 the owner restricted reviewers to low-cost models (#5699): a fresh publication refuses
any draw whose declared tier is not `economy` or `standard`, so that requirement can no longer be
met. On 2026-11-03 the model-name allowlist that enforced the ceiling was removed (#6132) because it
refused every model the fleet runs; the tier rule and the author-diversity rule stayed.

## Decision

This supersedes only the `strongest`-draw sentence of ADR 0054. A fresh reviewer publication on any
plan, specialist classes included, needs every draw at `economy` or `standard` tier; a `strongest`
draw refuses it. Specialist plans keep their earned stances and the draw floor of ADR 0054.
Historical records that carry `strongest` stay readable and replay unchanged.

`review:publish` checks each draw's declared tier and refuses a reviewer model that matches an
authoring model without `modelExhaustion`. It does not compare model names with the review cost
ceiling: choosing a permitted model for each draw is the orchestrator's duty under AGENTS.md
Review.

## Consequence

Real-time audio, security and undo changes get their depth from independent stances and
discriminating probes, not from a stronger review model. A draw declared at an allowed tier on a
frontier model passes the script, so the model choice is a reviewed orchestrator obligation rather
than a machine-checked one.
