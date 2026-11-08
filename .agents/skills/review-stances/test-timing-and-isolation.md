# Lesson library: test timing and isolation

A test is invalid when its verdict depends on elapsed time, a deadline paid for unobserved work, state leaked between
cases or from the environment (an optional native binary the CI install skips included), or a single terminal
observation that hides an interleaving window or a repeated call.
Split out of `test-validity.md`.
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
   Do not retry a required material or ownership invariant as readiness. #6342's bounded Audio-to-MIDI capture
   retry still hid a first-read PCM miss even though permanent absence failed with the right message. Return null
   once at the actual cached-buffer read while retaining the real PCM, then allow later reads: the case must fail
   on the one-shot miss, with hydration and document-witness refusals also remaining strict. Its public review
   reported permanent-absence/deadline attacks; historical private prompts and reviewer tiers are unknown.
   (#5661, #5874, #5363, #5849, #5520, #5613, #5517, #3318, #5464)

2. **The case's deadline pays for work it does not observe.**
   Probe: name what each await waits on and measure headroom under the default deadline. Remove,
   batch, bound separately or split into named rows the work outside the assertion: cold imports (an
   unrelated stylesheet held past the case boundary must not reach the next case, an optimizer crawl,
   candidate compilation), fixture transactions, heavy renders looped inside an `it.each` body,
   multi-request setup, and population walks in one case. Shrink cost without losing the asserted
   condition: a shorter render must still produce a receipt above its bound, and a dev-server resolve
   with discovery off must assert the exact source file chosen rather than an inequality. A raised
   timeout or warm-up hides unobserved cost. A generic deep matcher over a long typed PCM buffer can dominate an otherwise
   prompt async ownership test: queued Audio-to-MIDI cases in #6302 spent over 97% of local case time comparing
   1.76 million samples and exceeded the default deadline on hosted runners. Measure admission, release, conversion
   and assertion phases separately. Preserve the whole source fixture and compare its exact view bytes with a
   standard-library byte primitive, including byteOffset and byteLength; a mutation at the final byte must fail.
   Never replace full-buffer preservation with sampled elements, shorter audio or a larger timeout.
   External render or provider doubles do not remove downstream objective DSP. Measure actual render count,
   coherent PCM geometry and the real analysis before setting a case-specific deadline for required work; retain
   programme and gating windows and every functional assertion. #6311 introduced the brief case and #6350 the
   baseline cases and their initial measurement route. In Health run 42437242526, the [brief case](https://github.com/jcosta33/sourdaw/actions/runs/42437242526/job/128598913651)
   took 5811 ms and the [baseline cases](https://github.com/jcosta33/sourdaw/actions/runs/42437242526/job/128598913642)
   took 5153 and 5194 ms against 5 seconds; local diagnosis observed
   real analysis of 9 or 27 renders in roughly 2.1–2.5 seconds. The missed probe was workload and deadline accounting,
   not a demonstrated semantic assertion escape. Do not use global timeouts or retries.
   Compose stage deadlines (escalation plus proof, navigation plus overlay, every retry attempt plus
   backoff within step and job budgets) and drive a stalled child through the loop. A wall-clock bound
   measures only the budgeted quantity; a count cap is not a deadline. Under induced engine or runner
   delay the case must still discriminate, and a real retention (the previous render's channels or
   encoder state reachable at the next render's first write) must still fail the bound; a local green
   proves nothing about load-dependent roots.
   The #5798 composite factory persistence case failed [hosted run 40777377382, unit shard
   3/4](https://github.com/jcosta33/sourdaw/actions/runs/40777377382/job/123131079682) with
   continuing progress: the final position transition began at 4834 ms of a 5000 ms case budget.
   Measure phase progress and CPU before adjusting a deadline, never raise global timeouts or treat
   a green retry as recovery, and check that the whole-case budget accommodates sequential committed
   transitions and their individual waits. Mutate a real producer to persist the wrong value and
   require the existing functional case to fail under the adjusted budget.
   A warm-up hook that launches a browser, bundles and loads a page under one hook deadline turns a
   stalled step into an anonymous hook timeout and a launch error into a silent skip. Bound each step
   with its own named deadline and skip only on the exact not-installed condition.
   (#5191, #6011, #5964, #3270, #3356, #5459, #6000, #4775, #5798, #3222, #2976, #5337, #4228, #5115, #5924, #4331, #6250)

3. **Fixture state leaks across cases or depends on chance or the runner's environment.**
   Probe: hold a case past its real deadline in setup and again in its body. The successor must be
   refused before touching globals, the expired case must make no later assertion, cleanup must settle
   first, and removing the lifetime barrier must fail that ordered regression. Fix every
   nondeterministic input: actors on both sides of an Automerge merge (flip the chosen actor to the
   opposite extreme and expect red), ZIP `mtime` (force the writers across a two-second DOS
   boundary), clocks, inherited `GIT_TRACE2_EVENT`, and every environment variable read before the
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
   Sequential completed additions hid #6202's default-name read before the snapshot wait. Start both real UI
   commands while that transaction is held, observe both wait admissions, then release and await every command.
   Distinct IDs, complete persisted track arrays and recorded history names must agree before requiring distinct
   consecutive names; transient selection and ghost state are not persisted-slot fields. Reverting only the owner's
   late naming phase must fail `handleAddTrackDefaultName.integration.spec.ts`. Cleanup releases and settles every
   created promise even when an earlier assertion fails; a later await preserves the original command failure.
   (#2357, #4420, #5615, #5639, #4586, #5677, #2747, #5461, #5091, #5556, #5520, #806, #576, #5227, #187)

5. **The spec collects only where an optional native binary happens to be installed.**
   Probe: trace the subject's import graph through every native package import (`electron`, native audio or
   plugin bindings) and mock only the native boundary before importing the subject, keeping real project modules
   and their asserted values in the graph. Run the exact spec in an install-script-free environment where the
   native package entry cannot run: it must collect and execute assertions without evaluating that entry, since a
   cached host binary conceals a CI install that skips native downloads. `windowCloseCoordinator.spec.ts` imported
   `APP_TITLE` from `protocol.ts`, which imports `electron`, and failed collection with `Electron failed to
install correctly` on hosted unit2 (run 40195635280 at `fd9e41a4b3`); mock only `electron`, keep `protocol.ts`,
   `APP_TITLE`, the coordinator and an assertion for each coordinator state transition real.
   (#3141)
