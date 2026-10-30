# Lesson library: asynchronous file imports

For file requests that read or parse asynchronously before changing an open project, distinguish
the project's lifetime from the user's latest request within that lifetime. A matching project
alone does not authorize an older request to publish its result.

## Standing probes

- Hold import A at the picker, file read, and parser independently. Start import B in the same
  project, complete B first, then resolve or reject A. Only B may change the tuning or report
  success; A's structured errors, rejected promises, and console errors must stay silent.
- Repeat with a prepared project replacement and with an activated replacement reusing the
  project ID. Neither outgoing request may write or notify in the successor. Pair those refusals
  with a current successful import, current failures, and ordinary edits during the wait, which
  the accepted import must preserve.
- Exercise browser selection and native selected-file reads through their real boundaries.
  Removing the request-identity conjunct must fail the same-project inverse-completion case;
  removing the project-lifetime conjunct must fail the replacement case. Observe the stored
  tuning and notices, rather than only parser calls or the promise's completion.
- Run a successful import against the real normalized project store, CRDT adapter, and installed
  dirty tracker. Flush the actual write and require both the imported table and dirty state;
  prove the tracker is active with its normal positive control. Cancellation, malformed input,
  supersession, and project replacement must leave a clean current project clean. Preserve the
  loading guard and recheck request ownership before bookkeeping and after synchronous dirty
  subscribers, before publishing success. A mocked store cannot prove autosave admission.

## Crumbs waveform publication outlived its accepted sample

Commit `c8c1257477838ab15d98b5ea6b38e821ddb4ad57` introduced the sampler's unfenced
post-peaks continuation; no associated public PR is established. PR #5041 later guarded
decode completion, leaving telemetry and peaks as separate stale-publication windows (#5780).
Historical private prompts and reviewer tiers are unknown.

Hold each await independently against the real session store. Complete B before releasing A,
and separately leave B decoding: require B's exact metadata/vector and pending flag. Replace
the accepted sample without starting another load. Check project/device lifetime and the
actual accepted leaf after each await and synchronous subscriber, while ordinary edits and
the accepted sample's own persistence round trip remain valid. Removing either post-await
check must redden its corresponding case; a decode-only inverse-completion test cannot.

## Escape: a project-lifetime fence did not order Scala imports

PR #5397 (`2dc50d1388dd27a72a1661a26a79571f28c3a3a9`) brought project-lifetime
checks into Scala import on `main`, but two imports inside the unchanged project retained equal
authority. A's delayed completion could overwrite B's completed choice. PR #5516's review at
`49ce4baa3cf3add68ab05f5bb0050153e30c5bb1` identified this surviving same-project race;
`0951d30904df4e4c557a0ad35e5f716dcc585847` added latest-request authority across the
picker, read, parse, write, and notice routes. The missed stance was inverse completion within
one project, independently of project replacement. Historical private prompts and reviewer tiers
are unknown; the public finding does not establish them.

## Escape: a stored Scala import remained ineligible for autosave

The Scala import added in `0960a493392c6c94697401d3c4a4ebea10b68e51` wrote project
tuning without calling `markDirty`; no associated PR was found. PR #4883 removed the false
instrument-retuning claim, and #5397 added lifetime checks, but both retained this omission.
PR #5761's review at `2c845ad3e0d2f5b1f36127e1e79f9eba0a13e24e` found that a valid
browser import reached the real store and CRDT while leaving `dirty: false`. The installed
tracker watches tracks and tempo, so their positive controls do not prove import bookkeeping;
autosave admits only dirty projects. The missed stance was the completed file import's real
storage and autosave-admission boundary. Mocked tuning-write and notice assertions missed it.
Historical private prompts and tiers are unknown. This source and controlled-state evidence
does not establish a live save/reopen loss.
