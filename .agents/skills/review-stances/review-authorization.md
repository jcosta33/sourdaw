# Lesson library: review authorization

Use this file for a stance that attacks whether review evidence still authorizes a delivery or
publication when one local bundle artifact is lost, malformed, or rebound. The authorization
decision must follow the producer's provenance, not the continued presence of one file.

## Standing probes

- Trace every generated bundle file from `review:prepare` through the manifest and every consumer
  that grants publication, acceptance, or delivery authority. Remove one generated file at a time
  while leaving the manifest and other caller records intact; require refusal before a remote write.
- Exercise the original producer's three-field `{ pr, baseSha, headSha }` manifest as a positive
  control, alongside later pre-contract manifests whose `generated` list excludes the new artifact.
  Make each manifest absent, unreadable, malformed, or bound to another head. Unknown provenance
  must never become legacy authority.
- Run the production shell port, not a fixture that supplies a preselected `legacy` or `required`
  binding. With a present plan, retain the live reviewer id, authorized dossier digest, and exact
  head checks; mutate each binding independently and require refusal before merge.
- A stacked-delivery fixture must let initial deletion-policy reads pass and prove the final policy
  read occurred before any author merge call. If the first read already refuses, the final guard
  remains untested even when the error text matches.
- For a recovered reviewer approval, hold the exact landed publication constant across both remote
  reads, then introduce a later same-head reviewer decision before the complete review-state read.
  The old review may bind its publication, but it may authorize delivery only while the latest
  independent review is that same APPROVED review ID and no threads are unresolved. Cover a later
  change request, comment, dismissal, and different approval ID; retain the current-approval control.

## Review lesson: PR #5158 needed a later-review authority probe

PR #5158 introduced adoption of exact landed recovery receipts. Its
`historical-approval-acquires-current-delivery-authority` stance named merged, moved-head, and
unresolved-thread states, but those probes did not cover a later same-head reviewer decision between
publication inspection and authorization. The independent review caught this before merge: the old
approval could bind `delivery-authorized` even when complete live state reported a newer change
request. Delivery's separate live check refused the merge; the dossier event still overstated
authority. Probe the production recovery route with the later decision appearing only after both
stable publication reads, and require publication-only binding with byte-identical replay and no
second POST. Keep an unchanged latest approval as the positive control.

## Escape: PR #4573 treated a lost modern plan as legacy

PR #4573 introduced delivery authorization in commit `f32b620c10`. Its delivery reader returned
`legacy` whenever `risk-plan.json` was absent, although `review:prepare` had already recorded that
file in `manifest.json.generated`. Removing only the plan therefore disabled the dossier
authorization requirement for a modern head. The PR's delivery tests supplied a chosen binding
through `fakePort`; their legacy case never removed the file from a real shell-port bundle. The
published review attacked a wrong review-id binding and approved its repair; the retained review
record shows no artifact-loss probe.

Probe that would have caught it: create one modern bundle using the producer's manifest shape,
remove `risk-plan.json`, then call the production delivery authorization reader and require a
missing-generated-plan refusal. Keep a valid pre-plan manifest as the positive control. A malformed
or missing manifest and a surviving dossier with no plan must also refuse, while a complete planned
bundle must still return the bound authorization and its pre-authorization dossier digest.

## Escape: PR #5057 missed the oldest manifest and the final stack guard

The first repair's positive control still supplied `generated`, although the original
`prepareReview` producer at `6517347907b1d255aca9eff0545b488a824e95d6` wrote only
`pr`, `baseSha`, and `headSha`. Its reader therefore rejected a genuine pre-plan bundle.
The stacked-delivery case supplied `delete_branch_on_merge: true` to the initial policy read,
which returned before the final control; the case stayed green if that control was removed.
Keep the exact three-field manifest as a positive control, reject unproven variants, and make
the stack fixture reach the final repository-policy read with zero merge attempts.
