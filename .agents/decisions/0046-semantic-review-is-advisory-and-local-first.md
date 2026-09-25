---
type: adr
id: 0046
title: Semantic model review is advisory, local-first, and never merge-authoritative
status: superseded by 0047
date: 2026-09-20
owner: The Sourdaw team
sources:
    - scripts/semanticReview.ts
    - scripts/semanticReview/rules.ts
    - scripts/semanticReview/provider.ts
    - scripts/semanticReview/evidence.ts
    - scripts/prepareReview.ts
    - scripts/reviewDossier.ts
    - .github/workflows/health-gates.yml
---

# 0046 - Semantic model review is advisory, local-first, and never merge-authoritative

> **Superseded by [0047](0047-advisory-semantic-review-also-runs-in-ci.md) on 2026-09-20.** The
> owner accepted the three costs this ADR deferred — paid provider spend, sending pull-request
> source to a third party, and a new workflow trust class — and the advisory review now also runs
> automatically on every non-draft same-repository pull request. 0047 carries forward every ruling
> here that it does not change, including all of them about authority; what it replaces is ruling 3
> and the "local-first" in the title. Read 0047 for the current decision.

## Context

A proposal arrived to add a TypeSafe/Jev-backed semantic layer to the review pipeline: assess a pull
request's diff, surface additional risks for the orchestrator to investigate, and check candidate
findings before they are published. Its acceptance criteria were written against a generic
repository, and several of them assumed an integration this repository cannot adopt without giving
something up.

Three properties of the existing pipeline decided the shape of what was built.

First, the review bundle is the *blind reviewers' input*. `review:prepare` writes
`.agents/review-bundles/<pr>-<head-sha>/` and the orchestrator dispatches blind reviewers against it
under the root Review rules. A semantic sidecar placed inside that bundle would hand every reviewer
the model's proposed verdicts and probabilities — exactly the anchoring the blind-dispatch rule
exists to prevent. The proposal's own suggestion was to put it there.

Second, this repository has no code orchestrator. "Integrate with the orchestration procedure" means
editing `AGENTS.md` and the delivery-orchestration skill, which an agent then follows. A model
assessment can therefore be made *available* to the orchestrator, but its use cannot be enforced in
the way a script's refusal can.

Third, the workflow trust model is deliberate. `health-gates.yml` answers to `pull_request` alone and
every workflow directory entry, job, step, and permission is pinned by a recorded snapshot. No
workflow in this repository uses `pull_request_target` today, and secrets appear only in
`nightly.yml`, which the schedule owns. A `pull_request_target` workflow holding a paid provider key
would be a new trust class in the one place the repository has spent the most machinery defending.

At the same time, the existing contracts already enforce the proposal's sharpest prohibitions. A
semantic assessment cannot be recorded as a reviewer draw: the dossier only accepts `stance-completed`
events carrying a `reviewerModel` and `modelTier` (`scripts/reviewDossier.ts`). Caller-authored
`stances.json`, `review.json`, `discarded.json`, `dossier.json`, and `acceptance.json` are preserved
across a re-prepare (`scripts/prepareReview.ts`). `review:publish` reads only caller-authored
`review.json` and refuses a moved head. Nothing a model produces can reach a merge decision on its
own.

The provider's own documentation settles the authority question. Jev "does not treat [state] as
hostile by default", and the classifier cookbooks state plainly that such a filter is "not a security
boundary". A model that reads untrusted source comments cannot be given authority over the pipeline
that publishes that source.

## Decision

Semantic review is **advisory, local-first, and outside the gate**.

1. **Advisory only.** No semantic result may approve, request changes, resolve a thread, waive a
   check, or merge. Its output is input to the orchestrator's existing judgement, never a decision.
2. **Outside the reviewer-visible bundle.** Sidecars and the response cache live in the gitignored
   `.agents/semantic-review/`, never under `.agents/review-bundles/`. A blind reviewer must not be
   able to read a proposed verdict.
3. **Local-first, no new CI trust class.** The command runs from the protected primary checkout under
   the existing trusted-executing-blob assertion, reading `TYPESAFE_API_KEY` from the environment or a
   primary-root gitignored `.env.sourdaw-semantic`. No `pull_request_target` workflow and no
   PR-triggered secret is introduced. Automatic CI assessment waits on an explicit owner decision
   about spend, third-party source egress, and the workflow trust class.
4. **The endpoint, model, and logging are pinned in code.** `baseURL`, `defaultModel`, and `logLevel`
   are always supplied explicitly, so a `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, or
   `TYPESAFE_LOG_LEVEL` value cannot redirect the call, swap the model, or enable the SDK's
   unredacted debug body logging. The model is the explicit version, never an alias.
5. **One retry layer, owned by the adapter.** The SDK's automatic retries are disabled because every
   network attempt must be visible to the budget controller. Only explicitly transient failures are
   retried; a valid answer is never rerolled.
6. **Rules and thresholds are trusted code and versioned.** A wording, evidence, or threshold change
   alters `rulesDigest` and invalidates the responses it shaped. A policy-only change can reinterpret
   a saved response offline through `replay` without a paid call.

The initial rule set is six bounded questions, each naming the evidence it needs and the
counterexamples that must not read as a signal: `test-observable-weakened`, `test-behavior-bypassed`,
`project-integrity-risk`, `realtime-path-risk`, `ipc-authority-risk`, and `semantic-boundary-risk`.
Every threshold in it is provisional advisory policy, not calibration.

## Consequences

The integration was validated against the live provider on the pull request that introduced it: 12
units, 12 requests, 74,330 input tokens, USD 0.0031, and the pinned `jev-1.13.0` returned for every
one. That run was worth it, because four defects only the live path exposed had to be fixed before
the tool could say anything at all.

The evidence ceiling was the per-request state budget rather than the run total, so the first large
file consumed it and a twenty-two-path change reported zero eligible units. The unit fitter costed
regions by raw bytes, but JSON escapes every newline in a source file to two bytes, so a unit sized
by it overran the request limit by roughly one byte per line. The provider rounds its Choice
distributions, so a legitimate three-way answer sums to 0.99 — and a `0.01` sum tolerance fails on
`|0.99 - 1|` alone, which broke roughly one request in twelve. And a rule about *removing* previously
checked behavior was demanding before-side evidence from wholly added files, which marked every unit
`unresolved` and made the whole run inconclusive on a change that only adds files.

All four are fixed and guarded: the budget is the run total, regions are costed by their serialized
size, a rounded distribution inside a stated bound is normalized rather than refused, and a side the
change could not have produced is not treated as missing. A rerun after the interpretation fix served
all twelve units from the durable cache at zero cost, which is the response-cache and policy
separation working as intended: a policy change and a wording change were each absorbed without
re-asking the provider.

Four blind draws then found four more, and three of them were the kind this design exists to prevent.

The egress path classified sensitive content **by filename only**. A live credential in an
ordinary-named file — a key in a config example, a token in a fixture, a private-key block — was
admitted and sent, and the module's own comment conceded that filename matching "is not a guarantee
that arbitrary source has been sanitized" while no content scan existed at all. It now applies the
repository's existing `unsafeCredentialReason` detector to every region before admission, on the whole
region rather than the prefix, and records what it withheld. That the detector already existed and
went unused is the part worth remembering: this was a reuse failure, not a missing capability.

A unit whose evidence the request budget had to cut still reported `completed`, with an empty
truncated list and a clean summary. The per-unit reduction was built, tested, and then never merged
into the report, so an operator saw exit 0 and "no additional semantic signals" for a unit whose after
side had been cut to a fraction of itself. Unit-level reductions now reach the report, and a cut
region no longer satisfies the required side it came from.

`replay` reinterpreted stored answers with the current rule wording and kept the old digest, so a
disposition computed from one question could be presented under another's identity — while the
function's own comment claimed a changed question "is not attempted here". Question identity and
threshold policy are now separate digests: replay refuses when the questions have changed, and
records the policy it actually applied, including the verification thresholds that were previously
outside every versioned identity.

The fourth was narrower: the cached path validated token counts and the live path did not, so a
provider-returned usage could inflate the advisory cost estimate or poison the whole report at write
time. Both paths now share one validator.

What the draws also established is worth recording, because it bounds what remains unknown: the model
cannot select a path, a file, a URL, a threshold, a rule, or a cache key; answer labels,
probabilities, confidence, the returned model, and every selected evidence id are bounded by
application code; and the hard admission budget is byte-based and application-computed, so actual
spend is not model-controlled. The adversarial answers that were tried did not cross into approval,
request changes, thread resolution, or merge.

A second round on the repaired head found more, and the most important lesson is that a fix verified
on one path is not a fix. The credential gate from the first round had landed on `scan` only:
`verify` still read a candidate finding's referenced files and sent their full content with no
screening of any kind, so a finding naming a committed key, or a credential in an ordinary-named file,
egressed it verbatim — the exact case the first round claimed to have closed. A fix belongs to a
capability, not to one entry point, and the check that proves it must cover every entry point.

Three identity gaps followed the same shape. The policy digest omitted the probability-sum tolerance
and the severe-category set, each of which changes an outcome, so two runs with different dispositions
could name the same policy. A verify report recorded the *scan* rules digest although its questions
are built elsewhere, naming a question set that did not produce it. And the advertised cost figure was
provider-controlled: the bound added in the first round checked shape, not magnitude, so a
schema-valid `MAX_SAFE_INTEGER` reported roughly USD 378 million. The bound is now the submitted byte
length, which no tokenization can exceed — a limit derived from the transport rather than chosen.

Two reporting defects were the same failure in different clothes: a unit's evidence reduction was
recorded but never consumed by the execution state, so a run whose evidence was cut reported
`completed` and exited 0 while its own body said otherwise; and an all-unresolved run printed the
identical sentence as an affirmatively clean one. Both are the advisory form of the defect this
document keeps returning to — an incomplete assessment presented as a finished one — and both are now
refused by validation rather than merely described.

The count matters less than the pattern: of the eight defects the two rounds found, seven were in
application code around the model, and none were in what the model said. That is the argument for
keeping this advisory, and for the bound being the application's rather than the provider's.

A fourth round taught the last lesson, and it is about approach rather than any single input. Each of
the previous rounds had found one more credential shape missing from the detector — a private-key
header, a connection string, then Azure account keys and OAuth client secrets. That is a treadmill:
the set of live credential shapes is unbounded, so a list that must be complete cannot be finished,
and reviewing harder only finds the next vendor prefix.

The detector now screens the *form* a secret takes in source rather than enumerating who issues it: a
secret-named key assigned a long opaque value, credentials in a URI, a secret in a query parameter, a
key-value connection string, plus the cheap precise vendor prefixes as a fast path. That covers the
class instead of the instances, which is what makes it finishable — and it is why the answer to "one
more shape was missed" was to change the rule, not to extend the list again.

Two evasions remain and are documented rather than covered: a secret split across concatenated
literals or lines, and one encoded before it reaches source. Both are inherent to screening text
rather than tracking a secret, which is the honest reason this is defense in depth and never a
security boundary. The boundary is that the tool is advisory and holds no authority, which is
structural and does not depend on the detector being complete.

What remains unmeasured is whether the signals are *useful*. The rules are proposed assessment tasks,
not demonstrated accuracy; on this change the run returned no additional signals, which is the
correct answer for a change that adds a new tool rather than altering product behavior, and it is
also a single sample. No claim of improved defect detection or reduced review time is supported yet.

Two guarantees are structural and two are not. Structural: a Jev result cannot be counted as a
reviewer draw, and it cannot publish or merge anything, because the dossier and publication contracts
refuse anything that did not come through the caller. Not structural: the orchestrator running the
`verify` step at all, and heeding it. Those live in instructions, and an instruction is not an
enforcement boundary. Calling the second guarantee a guarantee would be the mistake this ADR exists to
prevent.

An unavailable provider is a typed outcome, never a clean review: execution states
`unavailable`/`partial` are reported, unassessed units are listed with reasons, and the summary refuses
wording that claims a scope is safe or approved.

The strongest reason this stays advisory is the one the provider documents about itself. Adversarial
source content can move a Jev answer, and the model is not a security boundary. Nothing in this
repository may be allowed to depend on a classifier that can be argued with by the code it is reading.

The deferred decision — automatic PR assessment in CI, which is what would make this frictionless —
is recorded in the [open-decision docket](./open-decision-docket.md). It requires the owner to accept
paid spend, sending PR source to a third party, and a new workflow trust class. It is not an
engineering call.
