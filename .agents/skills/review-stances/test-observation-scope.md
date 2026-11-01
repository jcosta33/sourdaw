# Lesson library: test observation scope

A test is invalid when it observes project truth or output in one place only, or when the boundary its claim depends on
is replaced by a controlled one. Split out of `test-validity.md`.
Each probe answers the baseline question from the Review section of root `AGENTS.md` (what must break for this
check to fail, and does it observe what its name claims?) and carries its baseline mechanical probe unrestated:
revert the behavioral hunk or apply one targeted mutation, run the named spec, and a remaining green fails the
round. Run mutations only on a committed head through [reviewer isolation](README.md#reviewer-isolation).
Report a probe that cannot run with its exact mutation, named check and limitation, never as passed.

## Standing probes

1. **Project truth or output is observed in one place only.**
   Probe: assert raw CRDT, owner projections, both history stacks and the history tree together, and
   again after save, binary reload and session-mirror hydration. Census identities across each
   namespace's whole live scope, keeping clip-local IDs such as gain points clip-local: split an
   envelope with points before, at and after the cut; preoccupy the preferred generated ID under an
   unrelated owner; after Undo let a peer claim a captured ID and require a zero-write refusal; then
   reload and replay Undo and Redo twice. A saved inverse whose capture holds duplicate note
   identities, malformed CC or pitch-bend rows, or a missing required capture must hydrate through
   production with no raw, projection or history write, beside valid-null and present-empty controls.
   Replay history from bytes the untouched historical producer wrote, read by the current reader
   (exact-inverse inputs are in `moving-coordinate-inverses.md`). Final equality can hide a write
   followed by restoration and notifications can miss a root install: count writes from a sentinel
   placed before the action, observe settled transitions, keep identical-content replacement and an
   aborted private preview as clean controls, and compare any reported verdict with the final state it
   describes. Observe what the musician consumes (PCM against an independent input, decoded bytes,
   painted pixels, console output during load), not a flag, setter, DOM presence, returned length or
   metadata. Check fixture values real publication normalizes (600 BPM published as 120) after
   hydration. Removing the producer, reload fence or copy must fail the case. For rejected partial
   merges, pair this with the real-store probe in `command-entry-and-state-oracles.md`.
   (#4036, #5578, #5064, #187, #5013, #4904, #5649, #4564, #5157, #2169, #5274, #5812)

2. **The claimed boundary is replaced by a controlled one.**
   Probe: exercise the real thing the claim depends on: child pipes and process groups (a buffered
   parent read is not a Writable `false`, closed pipes are not group absence, only `ESRCH` proves
   absence, validate every PID before signalling), the default launcher and owner fence, a real Git
   DAG, the installed tool, the SDK in its server environment, the live GraphQL schema, the pinned
   scanner, the served entry under the production CSP, the compiled build rather than the dev loader,
   a transport buffer at production size. After the first `ESRCH` the owned group is retired: send
   zero signals to it or to a raw descendant PID, even when the identifier is reused, and make
   direct-PID-only termination fail a stalled case whose grandchild ignores TERM and closes inherited
   stderr; numeric PID validation alone is insufficient. Inspection `EPERM` stays provisional until
   `ESRCH`; EIO then `ESRCH` must still refuse mutation proof; persistent EIO retains the mutated source
   and partial evidence without restoration; persistent `EPERM` exhausts the deadline with its typed
   diagnostic. A configuration value, successful scan, snapshot, literal checkout depth or request count
   proves no runtime behavior, object availability, upload or comparison coverage: paginate every main
   analysis configuration, drive checkout depth through a real fetch topology, prove a reload by a
   changed `performance.timeOrigin`, and remember a custom dispatcher can bypass a global request
   mock. Confirm the run checked the integration that lands. State the evidence scope: controlled
   engines prove the call path, not
   audible, hardware or cross-platform execution; a later pass does not explain an earlier failure; a
   comment about a third-party component is not evidence, so quote its primary source; a job that
   cannot run on the PR has its first hosted run as its only evidence.
   (#5624, #5639, #5240, #5115, #5320, #4271, #5615, #5705, #5595, #5363, #5331, #5284, #5243, #3548, #3170)
