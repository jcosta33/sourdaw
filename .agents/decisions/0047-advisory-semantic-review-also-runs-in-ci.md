---
type: adr
id: 0047
title: Advisory semantic review also runs in CI, on the trusted revision
status: accepted
date: 2026-09-20
owner: The Sourdaw team
sources:
    - .agents/decisions/0046-semantic-review-is-advisory-and-local-first.md
    - .agents/decisions/open-decision-docket.md
    - .github/workflows/semantic-review.yml
    - scripts/semanticReviewWorkflowContract.ts
    - scripts/semanticReview.ts
    - scripts/healthGateWorkflowContract.ts
---

# 0047 - Advisory semantic review also runs in CI, on the trusted revision

## Context

[0046](0046-semantic-review-is-advisory-and-local-first.md) built the advisory semantic review and
deliberately stopped short of running it automatically. Its third ruling — local-first, no new CI
trust class — named the three costs an agent could not accept on the owner's behalf: paid spend
against the provider account, sending pull-request source to a third party, and a new workflow trust
class. The deferred decision was recorded in the open-decision docket with its options.

The owner has since accepted all three and asked for the CI counterpart, and the reason it is worth
having is not that the local command is inconvenient. The local command serves the author of a
change before review is dispatched. It does nothing for anyone reading a pull request this session
did not author, and it is run only when someone remembers. A check that runs itself serves a
different reader, on every pull request, including the ones no lane of this session ever touches.

Two facts recorded in 0046 bound what the workflow may be. `pull_request_target` exposes the base
repository's secrets to anything that executes content from the head, and the repository had spent
more machinery defending its workflow trust boundary than anywhere else. And the provider documents
that it does not treat its input as hostile, so no workflow that reads untrusted source may give the
model any authority over the pipeline publishing it.

## Decision

The advisory review also runs as a workflow, `.github/workflows/semantic-review.yml`, under five
rulings that hold together or not at all.

1. **The trigger is `pull_request_target`, and the definition comes from the base revision.** On
   `pull_request`, GitHub takes the workflow definition from the head under review, so a change could
   edit the job that reads the provider key. `pull_request_target` runs the base revision's
   definition instead, and the job keeps that property by treating the head as data only: it checks
   out `github.workflow_sha`, fetches `refs/pull/<n>/head` as Git objects, and never checks out,
   installs from, or executes a file the head supplies. GitHub serves `pull_request_target`
   definitions from the default branch, so the workflow cannot run against the pull request that adds
   it either — its first run is the first pull request after this merges.
2. **The key is scoped to one step, and the job holds no write token.** `TYPESAFE_API_KEY` is
   declared on the assessment step alone, so the dependency install and the reporting step never see
   it, and the workflow grants exactly `contents: read` and `pull-requests: read`. `checks: write` is
   refused: the assessment publishes through its own job check, its step summary, and an artifact,
   none of which need a token that can write.
3. **Publication is the job's own check, named `Semantic review`, and it is not required.** A
   required context converts an observation into merge authority, and this is an observation.
4. **Success means the assessment was delivered, not that the change is clean.** `completed` and
   `partial` produced advice; `partial` carries its gaps in the summary rather than in the check's
   colour, because a permanently red advisory check on every large change is a signal its readers
   learn to ignore. Anything else — `unavailable`, `cancelled`, or no report at all — fails the job,
   so an unavailable provider can never read as a clean review.
5. **Forks, drafts, and changes proposed to another branch are out of scope, in one condition.**
   A fork is a different trust domain and a different spend decision, and admitting it is a
   deliberate later change, not a default. A draft is not under review yet; `ready_for_review` is a
   trigger so it is assessed when it becomes one. A stack whose base is another lane branch runs
   that branch's revision of the command, which its own trusted-execution assertion refuses as a
   mutated copy — so the workflow says which base it serves instead of failing closed with a
   refusal meant for a tampered checkout.

Everything 0046 established about authority is unchanged and is what makes this safe to run
unattended: a semantic result cannot be counted as a reviewer draw, cannot publish, cannot request
changes, cannot resolve a thread, and cannot merge. The reviewed change's credentials are screened by
the same content gate before they leave, with the same documented limitations.

## Consequences

The spend is real and the egress is real. A live run of a twenty-two-path change cost about three
tenths of a cent; the workflow runs on every push to a non-draft same-repository pull request, and a
provider outage costs nothing because the call never lands. Two things about that spend are worth
stating rather than implying: the per-run byte and attempt caps are hard admission budgets, not a
monthly ceiling, so several lanes pushing at once add up; and the source the evidence selection
admits — the regions it does not withhold — is sent to the provider, which is the third-party
disclosure 0046 recorded as an owner decision and this ADR is that decision. TypeSafe states it does
not train on customer data, but zero-data retention is an enterprise offering and is not assumed
here.

The workflow definition is now part of the pinned health-gate surface. It is registered in
`HEALTH_GATE_WORKFLOW_FILES`, its jobs and ordered steps are in `STEP_INVENTORY`, and its whole
parsed contents are in the recorded snapshot, so any edit fails the harness until the record is
regenerated and the diff reviewed. The properties that make the trust boundary hold are pinned beside
the snapshot in `semanticReviewWorkflowContract.ts`, which refuses a head checkout, a `pull_request`
trigger, a persisted credential, a key on any other step, a widened token, a dropped fork gate, and a
renamed check. That contract also fixes the job-level permissions: the assessment job grants none,
and the coverage job that annotates the withheld paths grants exactly `contents: read`.

Three things remain true and are worth stating plainly. The signal's usefulness is still unmeasured —
no labelled evaluation exists, and a green check means the assessment ran. The provider's judgement
of untrusted text can be argued with, which is why it holds no authority. And the screening is
defense in depth: a secret split across concatenated literals or encoded before it reaches source is
not detected by text screening and never will be.

The screen is not a mirror of the pinned scanner: it withholds the credential families it enumerates
plus a conservative secret-named assignment rule, and because the pinned rule set lives inside the
Gitleaks binary rather than in `.gitleaks.toml`, families nobody has enumerated stay unscreened.
Issue #4558 owns the audit that closes that gap.

## The question set was rebuilt around one property per question

The first revision asked six compound Choice questions per changed file. That shape was wrong on the
provider's own guidance, which is explicit that the decomposition is the concept that matters most:
a question carrying two judgements returns one answer that means neither, and no threshold recovers
what the bundling hid. `test-observable-weakened` is the example — deleted assertion, weakened
assertion, assertion moved, and assertion replaced by an implementation detail are four properties
with four different responses, and code could neither inspect nor weight which one it had been told.

The set is now one Noul per property: the probabilities that an assertion was deleted, that an
observable assertion was removed, that an observable became an internal detail, that a condition was
loosened, that a real collaborator was mocked, that a conditional admission was added, that a test
was skipped, that the production path is no longer reached, that a new branch completes without
asserting, that coverage moved to a weaker tier, that a persisted shape changed without a migration,
that a mutation bypasses undo, that data can be lost silently, that a stated invariant is
contradicted, that the audio thread can allocate, that timing semantics moved, that a public contract
widened silently, that a dependency points the wrong way, that an existing mechanism was duplicated,
that a gate was weakened, and that an advisory result gained authority.

Three consequences follow, and each states a contract rather than a measurement.

A missing-evidence disposition is decided by code, not by the model. The model returns a
probability; `insufficient_context` is what the caller reports when a rule's declared evidence was
not supplied, and the fire threshold lives in the policy digest, so calibration is a policy change
over stored answers rather than a redesign.

Evidence is the change, not the file. Each region is one changed hunk with a margin of a few lines,
and a side with no hunks at all is supplied whole. The earlier policy sent the whole side and
truncated what did not fit, which asked a question about a fragment while the report said the region
had been sent. A region is now sent whole or not at all, and a rule whose declared side lost a
region reports that evidence as absent rather than scoring it.

Two limitations are properties of the state rather than of the questions. A region larger than the
per-request budget is still withheld, which on this repository excludes its largest modules because
a new file's only admissible region is the file. And a hunk view cannot see a relationship spanning
more than the margin: the whole-side fallback covers a side with no hunks, not a hunk far from the
line it interacts with.

What has not changed is what 0046 established: none of this is calibrated. The thresholds are
provisional, the questions are proposed assessment tasks, and no labelled evaluation compares them
against merged outcomes yet, so no probability this tool returns is a measured accuracy. The design
keeps calibration a threshold-and-weight change over cached answers rather than a redesign, which is
the only property of this set that can be asserted before anyone has measured it.

This ADR supersedes 0046, which was its prerequisite rather than its opposite, and it carries
forward everything there that this decision does not change: the sidecars stay outside the
reviewer-visible bundle, the endpoint, model, and logging stay pinned in code, one retry layer
stays owned by the adapter, the rules and thresholds stay versioned trusted code, and every
ruling about authority stands. What it replaces is 0046's ruling 3 — local-first, and no
PR-triggered secret — and the title's "local-first", which is no longer true.
