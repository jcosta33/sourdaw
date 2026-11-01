# Lesson library: test observation scope

A test is invalid when it observes project truth or output in one place only, or when the boundary its claim depends on
is replaced by a controlled one. Split out of `test-validity.md`.
Each probe answers the baseline question from the Review section of root `AGENTS.md` (what must break for this
check to fail, and does it observe what its name claims?) and carries its baseline mechanical probe unrestated:
revert the behavioral hunk or apply one targeted mutation, run the named spec, and a remaining green fails the
round. Run mutations only on a committed head through [reviewer isolation](README.md#reviewer-isolation).
Report a probe that cannot run with its exact mutation, named check and limitation, never as passed.

## Standing probes

1. **Project truth is observed in one place only.**
   Probe: assert raw CRDT, owner projections, both history stacks and the history tree together, and again
   after save, binary reload and session-mirror hydration. The identity census across reload and replay is
   `project-integrity.md` probe 6; saved inverses holding bad captures are `project-integrity.md` probe 3;
   exact-inverse inputs are in `moving-coordinate-inverses.md`. For rejected partial merges, pair this with the
   real-store probe in `command-entry-and-state-oracles.md` probe 1. Removing the producer, reload fence or
   copy must fail the case.
   (#4036, #5578, #5064, #5157, #4564)

2. **Final equality hides a write followed by restoration.**
   Probe: count writes from a sentinel placed before the action and observe settled transitions, since
   notifications can miss a root install; keep identical-content replacement and an aborted private preview
   as clean controls, and compare any reported verdict with the final state it describes.
   (#5649, #5274)

3. **A flag, setter or presence stands for what the musician consumes.**
   Probe: observe PCM against an independent input, decoded bytes, painted pixels and console output during
   load, never a flag, setter, DOM presence, returned length or metadata.
   (#187, #5013, #4904, #5812)

4. **Fixtures or history bytes the real producer would never write.**
   Probe: replay history from bytes the untouched historical producer wrote, read by the current reader. Check
   fixture values real publication normalizes (600 BPM published as 120) after hydration.
   (#2169, #5578)

5. **A process boundary is modelled by a buffered read or a closed pipe.**
   Probe: exercise real child pipes and process groups: a buffered parent read is not a Writable `false`, closed
   pipes are not group absence, only `ESRCH` proves absence, and every PID is validated before signalling. After
   the first `ESRCH` the owned group is retired: send zero signals to it or to a raw descendant PID, even when
   the identifier is reused, and make direct-PID-only termination fail a stalled case whose grandchild ignores
   TERM and closes inherited stderr; numeric PID validation alone is insufficient. Inspection `EPERM` stays
   provisional until `ESRCH`; EIO then `ESRCH` must still refuse mutation proof; persistent EIO retains the
   mutated source and partial evidence without restoration; persistent `EPERM` exhausts the deadline with its
   typed diagnostic.
   (#5624, #5240, #5115, #5320, #5331)

6. **The claim depends on a real external system the test replaces.**
   Probe: exercise the real thing: the default launcher and owner fence, a real Git DAG, the installed tool, the
   SDK in its server environment, the live GraphQL schema, the pinned scanner, the served entry under the
   production CSP, the compiled build rather than the dev loader, and a transport buffer at production size. A
   custom dispatcher can bypass a global request mock.
   (#5639, #4271, #5615, #5705, #5595, #5363, #5284)

7. **A configuration value, snapshot or count stands for runtime behavior.**
   Probe: a configuration value, successful scan, snapshot, literal checkout depth or request count proves no
   runtime behavior, object availability, upload or comparison coverage: paginate every main analysis
   configuration, drive checkout depth through a real fetch topology, and prove a reload by a changed
   `performance.timeOrigin`. Confirm the run checked the integration that lands.
   (#5243, #3548, #3170)

8. **The evidence claims more than its scope.**
   Probe: state the evidence scope: controlled engines prove the call path, not audible, hardware or
   cross-platform execution; a later pass does not explain an earlier failure; a comment about a third-party
   component is not evidence, so quote its primary source; a job that cannot run on the PR has its first hosted
   run as its only evidence.
   (#5595, #3170)
