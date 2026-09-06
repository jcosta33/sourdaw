# Review stance: correctness

Dispatch guidance for the correctness stance: attack what the change does, not what it claims —
read the whole unit at head, state the invariant it must maintain, and try to construct the input
or state that breaks it. Per the Review section of `AGENTS.md`, an escape — a defect that reached
`main` which this stance should have caught — is recorded here as a lesson, and every future
dispatch of this stance carries this file's lessons. Lessons state the escape, the blind spot, and
the probe that would have caught it. Keep each lesson short enough to paste into a dispatch.

## Standing probes

- Read the full unit the diff touches at head — the function, its callers, its callee contracts —
  never the hunk alone. A hunk shows what changed, not what the code now does.
- State the invariant the change maintains in one sentence, then construct the input or state that
  violates it. Report the concrete failure scenario or report that none survived; never hedge.
- Where the change models another component's state — a mirror, a shadow copy, a re-derivation —
  enumerate the owning component's contract clauses from its source and check the model against
  every clause, including the ones today's tests do not exercise.
- Probe every boundary the change establishes or relies on one quantum to each side: the value the
  bug report named, and the adjacent value the report did not name.
- A green gate is not evidence: name what would have to break for the existing checks to fail, and
  whether anything observes it.
- When the change touches a shared control or a component that shares its input model, read the
  sibling components on the same surface before attacking: their comments carry measured browser
  behaviour (a `lostpointercapture` for a pointer the control never owned, a window or tab switch
  that never delivers `pointerup`) that the change must survive, and a stance that reads only the
  changed file re-derives, or misses, what a sibling already pinned.
- When a change stores timed events for later delivery — notes, automation stamps, scheduled
  commands — state its ordering rule, its release rule for every way playback leaves the timeline
  (stop, locate, loop wrap, a clear of the window), and its per-occurrence rule for repeated keys;
  a store that answers "is there a later note-off for this key" without "which occurrence does it
  belong to" releases the wrong note. A clause with no enforcing route is the finding.
- When a doc sentence calls two commands atomic, trace every command in the pair to the branch that
  can refuse it after the fence has made them visible; visibility-atomic and success-atomic are
  different claims, and the sentence must say which one holds and what a refusal leaves behind.
- When a set or bitmap models the state of another thing one bit per key, ask what the model cannot
  represent — two of one key, an order, a count — and whether the contract says so where a producer
  of that state will read it.

## Lessons from escapes

### 2026-09-05 — output selection recorded the requested sink after the browser refused it

The output-device use case wrote the requested ID into its selection store after `setSinkId` rejected or was unavailable, so the picker claimed hardware that was not applied. Its existing spec blessed that mirror by asserting the requested ID after a rejection.

Blind spot: the review treated a successful call attempt as the hardware outcome and never checked whether the store represented the browser's applied state through failure or overlapping requests.

Probe that would have caught it: drive the real use case with fake hardware and observe the store and notification after rejection, absent or non-callable `setSinkId`, deferred success, and ordered overlapping requests; require every failed request to retain the last applied ID and every later request to wait for its predecessor.

### 2026-09-02 — a mirror that implements half of the engine's release law (escaped via PR #3363; clip repair in flight in #3437)

PR #3363 shipped fader, pan and send automation on the native live engine with the loop-end
starvation live: its clip keeps writes stamped at the loop end (`orderedWrites`,
`writeLandSeconds(write) <= span.endSeconds`). The post-merge correctness round found the writer's
own release mirror implements only the playhead half of the engine's `proven_popped` law: the seam
half — carried stamps released two wraps post-echo when the start frame precedes the span end
frame — is missing, so a step one poll interval below the loop end is never mirrored as released.
Reproduced by simulation (30 of 60 passes frozen with a step 1 ms below the loop end) and by a
lane-run probe of the starvation spec with its last step at 3.9999 (0.1 ms below the 4.0 s loop
end), frozen by pass 8. The open #3437 repairs the clip, and its outstanding review round covers the
mirror gap.

Blind spot: the mirror was checked against the half of the law the failing test exercised, not the
whole law — stances ran across five attacked heads and still enumerated only part of it. The specs
pinned the behavior at the boundary the bug report named and never one poll interval inside it.

Probe that would have caught it: when a fix maintains a mirror of another component's state,
enumerate every clause of the owning component's invariant from its source (the engine's
render-and-pop law) and require each clause in the mirror — a clause no current test exercises is
the finding. Then run the starvation scenario with the step one poll interval below the loop end
and require the write to be released.

### 2026-09-03 — a narrowed sanitizer checked against one writer of the shape (escaped via PR #3112; fixed in #3477)

PR #3112 added a persistence rule that a pending-effect continuation may carry `sourceRevision`
only when every effect is a section render, and in the same PR made prepared-continuation
promotion pass the finalized revision for every continuation. For any generic effect, the promote's
persist failed sanitation, the throw was swallowed by an empty catch on the commit path, and the
placeholder prepared entry became the durable proof, so recovery refused every generic partially
committed batch with a proof mismatch. Many review rounds attacked the render paths only.

Blind spot: a new restriction on what a store accepts was checked against the writer the PR was
about, never against every writer of that record; and an empty catch around the persist hid the
violation from every test on the path.

Probe that would have caught it: when a diff narrows what a store or sanitizer admits, list every
producer of that record at head and drive each through the new clause. When a diff adds or keeps an
empty catch around a persistence call, name the throw it hides and construct the input that throws.

### 2026-09-03 — a changed durable record whose other witnesses were never run (escaped via PR #3506)

The fix made generic pending-effect continuation promotion succeed, so the persisted continuation
started carrying the receipt's real effects instead of the placeholder. `confirmPendingChatActions.spec.ts`
asserted the placeholder and failed deterministically on every nightly shard, hidden on the pull
request by the continue-on-error unit step; the pull request named three regression specs to run and
this one was not among them.

Blind spot: when a change alters what a durable record contains, every spec that asserts that
record's fields is a witness, and the stance accepted the author's named regression set instead of
deriving the set from the record.

Probe that would have caught it: grep `src/**/__tests__` for the record's field or type name
(`pendingEffectContinuations` here) and for the literal placeholder values the change retires, name
every spec that hits, and require the author's evidence to include a run of each.

### 2026-09-04 — a workflow comment's claim about a third-party installer read as evidence (escaped via PR #3548)

PR #3548 added the nightly `desktop-measure` leg. Its install step said "BlackHole is a HAL
plugin: coreaudiod picks it up as soon as the cask lands it, so nothing here reboots." The cask's
own caveat prints "You must reboot for the installation of blackhole-2ch to take effect", its pkg
distribution declares `onConclusion='RequireRestart'` with a post-install script that only fixes
permissions, and coreaudiod enumerates `/Library/Audio/Plug-Ins/HAL` only when it starts. The first
hosted run failed at `SwitchAudioSource` with
`Could not find an audio device named "BlackHole 2ch"`. The approval attacked "whether every step's
precondition holds in order on a hosted macos-latest runner" and reported all held, having checked
the claim against the comment rather than the package; actions/runner-images issue 11746 had
recorded the same failure and the `sudo killall coreaudiod` fix since March 2025.

Blind spot: a comment or pull-request body asserting how a third-party installer, runner image, or
external service behaves was accepted as evidence, and a job that cannot run on the pull request
was approved with no run of it at all.

Probe that would have caught it: for every claim about an external component in a workflow diff,
open that component's primary source — the cask or formula, the installer's distribution and
post-install scripts, the runner-image release notes, the vendor's open issues — and quote the line
that supports or contradicts the claim; a caveat, restart flag, or open issue that contradicts the
comment is the finding. When the job cannot run on the pull request, name the first hosted run as
the only evidence and require the pull request's test section to say so.

### 2026-09-05 — a retired renderer body with a carrier rule that still routed to it (escaped via PR #3593; fixed in #3846)

PR #3593 made the native live session the audible carrier and turned the Web Audio
external-plugin device into a synchronous pass-through, so only the native engine could voice
a hosted plugin. The carrier law it shipped kept rule 1 — a strip with no native playback is
`'nothing scheduled'` and stays on Web Audio — ahead of every chain rule, and the session
called itself the audible carrier only when the batch scheduled a clip. A track holding an
attached generator plugin and no clips, the exact project the nightly Desktop latency leg
builds, was therefore handed to a carrier that could no longer sound it, and the native master
peak read null. The approval walked every exit of the start sequence asking which carrier
sounds each strip, and never walked the law's rules against the strips the retired body used to
sound. The leg ran red from the first nightly after the merge until #3846.

Blind spot: when a diff retires one carrier's body for a device, the reviewer checked the new
carrier's exits and not whether the routing law can still send that device to the retired
carrier.

Probe that would have caught it: when a diff removes or stubs a renderer for something — a
device type, a clip type, a route — enumerate every rule in the routing law that can still
deliver that thing to the stub, drive each with the smallest project that hits it (one track,
that device, nothing else) and require either the new carrier to take it or a notice that names
why not. Then find the product's own standing consumers of that path — the nightly harness
project, the smoke set — and run them through the same rule.
