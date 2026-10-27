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

## Escape: a project-lifetime fence did not order Scala imports

PR #5397 (`2dc50d1388dd27a72a1661a26a79571f28c3a3a9`) brought project-lifetime
checks into Scala import on `main`, but two imports inside the unchanged project retained equal
authority. A's delayed completion could overwrite B's completed choice. PR #5516's review at
`49ce4baa3cf3add68ab05f5bb0050153e30c5bb1` identified this surviving same-project race;
`0951d30904df4e4c557a0ad35e5f716dcc585847` added latest-request authority across the
picker, read, parse, write, and notice routes. The missed stance was inverse completion within
one project, independently of project replacement. Historical private prompts and reviewer tiers
are unknown; the public finding does not establish them.
