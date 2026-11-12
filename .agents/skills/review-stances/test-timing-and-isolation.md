# Lesson library: test timing and isolation

A test is invalid when its verdict depends on elapsed time, a deadline paid for unobserved work, state leaked between
cases or from the environment (an optional native binary the CI install skips included), or a single terminal
observation that hides an interleaving window or a repeated call.
Each probe answers the baseline question from the Review section of root `AGENTS.md` (what must break for this
check to fail, and does it observe what its name claims?) and carries its baseline mechanical probe unrestated:
revert the behavioral hunk or apply one targeted mutation, run the named spec, and a remaining green fails the
round. Run mutations only on a committed head through [reviewer isolation](README.md#reviewer-isolation).
Report a probe that cannot run with its exact mutation, named check and limitation, never as passed.

## Standing probes

1. **The case waits on time instead of the producer's signal.**
   Probe: await what the producer emits (a capability signal, an acknowledgement published by rename,
   a handler's first acknowledgement, a polling-start log, a producer-backed phase witness), never a
   sleep, a larger deadline, or a fixed microtask or frame count. Hold the real seam (snapshot wait,
   storage release, fallback timer), not a wrapper or a setter-injected microtask, and drive time-based
   readiness through the real progress producer. Delay the bad variant past the case's end: finishing
   before a scheduled side effect does not prove it was prevented, so the delayed mutant must still
   fail. Teardown must not depend on the behavior under test.
   Do not retry a required material or ownership invariant as readiness: a bounded capture retry hides a
   first-read PCM miss even while permanent absence fails with the right message (#6342). Return null once at the
   actual cached-buffer read while retaining the real PCM, then allow later reads: the case must fail on the
   one-shot miss, with hydration and document-witness refusals also remaining strict.
   (#6342, #5661, #5874, #5363, #5849, #5520, #5613, #5517, #3318, #5464)

2. **The case's deadline pays for work it does not observe.**
   Runs: author. Phase timing and CPU measurement are author work; the reviewer reads per-case durations in the
   collecting `Unit suite` shard log on the head and checks from the fixed commit what each await waits on.
   Probe: name what each await waits on and measure headroom under the default deadline. Remove,
   batch, bound separately or split into named rows the work outside the assertion: cold imports (an
   unrelated stylesheet held past the case boundary must not reach the next case, an optimizer crawl,
   candidate compilation), fixture transactions, heavy renders looped inside an `it.each` body,
   multi-request setup, and population walks in one case. Shrink cost without losing the asserted
   condition: a shorter render must still produce a receipt above its bound, and a dev-server resolve
   with discovery off must assert the exact source file chosen rather than an inequality. A raised
   timeout or warm-up hides unobserved cost. A generic deep matcher over a long typed PCM buffer can dominate an
   otherwise prompt async ownership test and exceed the default deadline on hosted runners (#6302). Measure
   admission, release, conversion and assertion phases separately. Preserve the whole source fixture and compare its exact view bytes with a
   standard-library byte primitive, including byteOffset and byteLength; a mutation at the final byte must fail.
   Never replace full-buffer preservation with sampled elements, shorter audio or a larger timeout.
   External render or provider doubles do not remove downstream objective DSP. Measure actual render count,
   coherent PCM geometry and the real analysis before setting a case-specific deadline for required work; retain
   programme and gating windows and every functional assertion (#6311, #6350). Do not use global timeouts or
   retries.
   Compose stage deadlines (escalation plus proof, navigation plus overlay, every retry attempt plus
   backoff within step and job budgets) and drive a stalled child through the loop. A wall-clock bound
   measures only the budgeted quantity; a count cap is not a deadline. Under induced engine or runner
   delay the case must still discriminate, and a real retention (the previous render's channels or
   encoder state reachable at the next render's first write) must still fail the bound; a local green
   proves nothing about load-dependent roots.
   A case whose sequential committed transitions keep progressing can still exhaust its whole-case budget on a
   hosted unit shard (#5798). Measure phase progress and CPU before adjusting a deadline, never raise global timeouts or treat
   a green retry as recovery, and check that the whole-case budget accommodates sequential committed
   transitions and their individual waits. Mutate a real producer to persist the wrong value and
   require the existing functional case to fail under the adjusted budget.
   A warm-up hook that launches a browser, bundles and loads a page under one hook deadline turns a
   stalled step into an anonymous hook timeout and a launch error into a silent skip. Bound each step
   with its own named deadline and skip only on the exact not-installed condition.
   For browser responsiveness, inspect the complete task containing publication, including Promise
   continuations, subscriber renders and compositor work; phase measures alone omit surrounding cost.
   #5843 introduced Detect's Promise settlement inside `requestAnimationFrame`. Its rendering-task/performance
   stance was mis-prompted: phase measures and an ordinary passing E2E did not require enclosing-task
   attribution. The escaped task spent 48.449 ms of CPU across 50.075 ms elapsed, so runner preemption
   cannot excuse the rendering work. Resume heavy post-frame continuations in a separate host task;
   hold its queued delivery, revoke the operation, and require refusal with no stale writes. Revert
   that task boundary and require `detectTransientsForClip.spec.ts` to fail. In the real Detect trace,
   require publication outside `FireAnimationFrame` while preserving PCM, projections, undo/redo,
   and the original no >=50 ms task and no >=100 ms frame-gap gates. Follow the complete settled
   command through its success notification and caller DOM update too: #5843 introduced the synchronous
   post-commit completion path. Its recorded cold 120-second E2E passed the task/frame, PCM and Undo gates;
   recorded mutations targeted storage admission, tier selection and FFT. Those results did not demonstrate
   compound UI task margin or cover the distinct late-caller ownership failure. A subsequent whole-host-task
   counterexample requires both complete-endpoint attribution and held late-caller probes. A later awaited
   presentation task must leave raw/projected markers, durable replay and session Undo available before delivery,
   retain notification and caller completion inside the original measurement endpoint, and show both full host
   tasks including subsequent renders. A held platform receiver must discriminate the real registered path;
   synchronous delivery, failed scheduling/reconciliation, hidden/pagehide and stale delivery need explicit
   controls. Separating tasks is a hypothesis until the unchanged whole-task/frame gates pass.
   (#5191, #6011, #5964, #3270, #3356, #5459, #6000, #4775, #5798, #3222, #2976, #5337, #4228, #5115, #5924, #4331, #6250)

3. **Fixture state leaks across cases or depends on chance or the runner's environment.**
   Probe: hold a case past its real deadline in setup and again in its body. The successor must be
   refused before touching globals, the expired case must make no later assertion, cleanup must settle
   first, and removing the lifetime barrier must fail that ordered regression. Fix every
   nondeterministic input: actors on both sides of an Automerge merge (flip the chosen actor to the
   opposite extreme and expect red), archive timestamps (`security-and-platform.md` probe 9),
   clocks, inherited `GIT_TRACE2_EVENT`, and every environment variable read before the
   asserted one, under the variables CI exports. A spec must not
   run its subject on import or read refs, history or remotes its CI job never fetches (grep `origin/`,
   `HEAD~`, `merge-base` against each collecting job's checkout depth). Isolate inherited
   configuration and run under both CI values.
   (#5899, #4390, #5646, #5852, #4292, #4057, #4854, #3513, #4356, #5917, #2)

4. **One terminal observation hides an interleaving window or a repeated call.**
   Probe: hold the real seam between the guard's read and the write it authorizes (snapshot wait,
   commit publication, final provider response, OPEN snapshot, pending permission, in-flight pump,
   journaled pre-write). Inside it, change what the guard reads: move the head, reopen the parent,
   replace the root with a clone, commit a peer edit, settle a grant, or restore discarded history,
   including through an un-cloned historical view whose shared handle still sees the edit. Include a
   store write whose serialized value is unchanged but whose flush advances the mutation epoch, history
   restored with its original entry objects, and peer races on each owner independently (MIDI notes,
   controllers and bend, clip automation, gain, warp) without changing raw tracks. Require refusal
   with zero writes and retained history and recovery evidence, plus a positive control that commits.
   Removing the fence must fail the held case while the ordinary case stays green.
   Repeat terminal calls (Stop twice, dispose twice, an error after a grant, a throw from one cleanup
   step) and count every reply, release and stop. Through the real atomic port, re-enter each scope
   synchronously from the publication listener and assert callback entry count separately from cache,
   document and pending state; revert the write-context guard and the scope-entry guard separately.
   Publish newer same-slot authority from inside each guarded terminal or hydrate callback, with
   projectors that return null or throw and no configured initial value. A failed initialization must
   replay its original error to later requests with no second construction or ready reply.
   (#2357, #4420, #5615, #5639, #4586, #5677, #2747, #5461, #5091, #5556, #5520, #806, #576, #5227, #187)

5. **The spec collects only where an optional native binary happens to be installed.**
   Runs: CI; the reviewer reads the `Unit suite` shard that collects the spec on the head, and traces the import
   graph from the fixed commit. A cached host binary conceals a CI install that skips native downloads, so a local
   run cannot discharge this probe. Probe: trace the subject's import graph through every native package import
   (`electron`, native audio or plugin bindings), including every direct and transitive pure-spec importer of a
   shared native-adjacent constant module, not just the first fixture repaired. Mock only the native boundary before
   importing the subject, keeping real project modules and their asserted values in the graph. In
   `electron/__tests__/windowCloseCoordinator.spec.ts`, `APP_TITLE` comes from `electron/protocol.ts`, which
   imports `electron`; `rendererSessionLifecycle.spec.ts` reaches the coordinator and its real `APP_TITLE`
   transitively, and `appIpc.spec.ts` reaches the same title through `appIpc.ts`. Mock only `electron`, keep
   `protocol.ts`, `APP_TITLE`, the coordinator and an assertion for each coordinator state transition real. In the
   install-script-free CI shard each spec must collect and execute assertions without evaluating the native entry;
   a collection failure such as `Electron failed to install correctly` is the red result.
   (#3141, #4289, #5700)

## Relocated

- Overlapping nameless track additions reading default names before the snapshot wait (#6202) →
  `command-entry-and-state-oracles.md` probe 9.
