---
name: write-audit
description: Load before creating or updating an audit file. Covers what an audit must contain, how to distinguish findings from current state, what makes an issue actionable, and when to create vs update.
---

# SKILL: write-audit

> **Superseded — spec/audit/research authoring moved to the Swarm workspace.** This repo adopted Swarm (`../sourdaw-hq`); specs, audits, research, reviews, and findings live there now, authored with the workspace guides in `../sourdaw-hq/.agents/skills/` (`write-audit`, `write-inventory`, `persona-auditor`). The craft guidance below still applies; only the paths and entry point changed. See the root `AGENTS.md` for the directory map.

## Purpose

Audits are honest reports on the current state of a codebase area relative to a goal. A good audit makes the next session's job clear without requiring that session to re-examine the same ground.

Canonical workspace audit guidance: whole-module maps live in `../sourdaw-hq/inventory/` (brownfield maps), and per-feature, observation-only audits are co-located as `../sourdaw-hq/specs/<feature>/audit.md`.

---

## Core rules

1. **Start with the goal.** The `## Goal` section defines what "good" looks like. Without it, "current state" has no meaning — there is no baseline to measure against.

2. **Current state describes reality, not aspiration.** Write what exists today, with file and line references. Do not describe planned changes or what you wish were true.

3. **Findings are observations, not issues.** `## Findings` captures patterns and structural insights that are not obvious from reading individual files. Issues are specific, numbered, and actionable. Do not conflate them.

4. **Adversarial Analysis (The Skeptic Persona).** When writing or updating an audit, your analysis must ALWAYS be adversarial. Do not trust that existing code works as intended. Actively hunt for architectural violations, edge cases, race conditions, and unhandled failures. Assume the codebase is trying to hide its flaws from you.

5. **Every open issue must have a "Needed".** An issue without a concrete resolution path is not an issue — it is a complaint. Each issue must state what concrete change would close it.

6. **Prioritise issues explicitly.** The `## Priorities` section should list issues in order of impact so the next session has a starting point, not a flat list.

7. **Risks belong in the audit.** If leaving issues unaddressed carries real risk — correctness, performance, maintainability — state it. Do not leave this implicit.

8. **Suggested approaches are not specs.** They provide direction and rationale. The spec is where implementation decisions are made. Keep suggested approaches high-level.

9. **Mark resolved issues.** The `## Resolved` section exists so future sessions do not re-investigate the same ground. Use it.

---

## Create vs update

**Update** an existing audit if:

- It covers the same area and its issues are stale
- Implementation during this session resolved or changed issues it tracks
- New issues were discovered in an area already audited

**Create** a new audit if:

- No audit exists for this area
- The existing audit covers a different scope or goal
- The area has changed enough that updating would require rewriting most of it

Do not create a second audit for the same area. Consolidate.

---

## Anti-patterns

- Writing an audit after implementation to justify decisions already made — audits precede implementation, they do not narrate it.
- Listing issues without representative files — specificity is the entire point.
- Leaving `## Risks` and `## Suggested approaches` empty — these are what make an audit actionable.
- Putting implementation plans in the audit — that belongs in the spec.
- Letting an audit go stale after changes land — mark resolved issues resolved.

---

## Adversarial review: deepening an existing audit

When re-walking a prior audit, your job is to verify, deepen, and challenge — not to rewrite.

1. **Verify every cited file:line** against the source as it stands today. If the cited code changed, move the issue to `## Resolved` (with the resolving commit, if discoverable) or update the citation.
2. **Deepen each issue:** root cause, blast radius, related call sites, repro hint, fix sketch. Vague "this is racy" descriptions are weaker than "two concurrent calls to X both observe `holder === null`, both run the init, last write wins; first writer's resource leaks until GC". Cite the exact lines that produce the race.
3. **Challenge severity** — promote issues that turn out to compound (e.g. a counter never ticks, so a downstream LRU never fires) and demote issues that read scary but cannot fire in practice (e.g. a typed-array `?? 0` that is only reached in dead branches).
4. **Hunt for missed findings.** Read the source once with the audit closed. If you find something not in the audit, add it as a new numbered issue. Do not silently merge new findings into existing ones — the numbering is the audit's history.
5. **Verify dynamic invariants, not just static text.** Buffer transfer (`postMessage(..., [buf])`) detaches the buffer; reading `.byteLength` after transfer is `0`. Promise-coalesce misses surface only under interleaving. ORT/WebGPU resources have lifecycle hooks that rejecting silently breaks. These are the failure modes audits miss most often.
6. **Add an "Adversarial review log"** at the top of `## Findings` summarising: what was verified, what was demoted/promoted, what new issues were added (with numbers). Future readers should not have to diff the file to know what changed.
7. **Mistrust the audit's own confidence.** Phrases like "harmless", "small in practice", "by happy accident" are red flags — they signal the prior author paused at a question they did not answer. Re-examine those issues with hostility.
8. **Verify the audit's structural claims, not just its line numbers.** Audits frequently claim things that sound plausible but turn out to be wrong: "the root barrel re-exports X" (when no root barrel exists), "module-init side effect" (when the effect is actually wrapped in an exported function), "callers must do Y" (when no callers exist anywhere). When the audit asserts a code pattern, run the search that would falsify it (`ls`, `grep`, "find usages") before trusting the claim. Demote / correct any structural claim you cannot reproduce.
9. **Search for the "no callers anywhere" failure mode.** If a use case looks dangerous (per-block IPC, fire-and-forget unload, etc.), `grep -rn` for callers across the codebase. A "dangerous code path" with zero callers is dead code labelled as working — promote that to a finding in its own right; do not let the surface fool you into auditing only the implementation.
10. **Cross-module callers count.** A module audit that only inspects the module's own files misses contracts the rest of the codebase depends on. For each public surface the audit lists (use cases, stores, components), run `grep -rn "from '#/modules/<Name>'"` and read the **callers**. Lifecycle bugs and id-collision hazards routinely live in the calling module, not the audited one.
11. **Run `pnpm typecheck` to confirm soundness claims.** When the audit alleges "this payload doesn't match the type" or "the cast bypasses checking", run typecheck. If it passes silently despite the claim, dig into why — usually a generic-erasing wrapper (`inject`, decorator, `any`-typed event bus) is hiding the problem upstream. That upstream is the real finding; the symptom in the audited module is the consequence.
