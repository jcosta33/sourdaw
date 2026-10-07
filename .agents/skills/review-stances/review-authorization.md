# Lesson library: review authorization

Use this file for a stance that attacks whether review evidence still authorizes a delivery or
publication when one local bundle artifact is lost, malformed, or rebound. The authorization
decision must follow the producer's provenance, not the continued presence of one file.

## Standing probes

- Trace every generated bundle file from `review:prepare` through the manifest and every consumer
  that grants publication, acceptance, or delivery authority. Remove one generated file at a time
  while leaving the manifest and other caller records intact; require refusal before a remote write.
- Exercise a genuine pre-contract bundle with a valid head-bound manifest that never named the new
  artifact. Keep it as a positive control, then make the manifest absent, unreadable, malformed, or
  bound to another head. Unknown provenance must never become legacy authority.
- Run the production shell port, not a fixture that supplies a preselected `legacy` or `required`
  binding. With a present plan, retain the live reviewer id, authorized dossier digest, and exact
  head checks; mutate each binding independently and require refusal before merge.

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
