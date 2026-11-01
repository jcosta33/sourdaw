# Lesson library: asynchronous file imports

Defects where a file request that reads, decodes or parses asynchronously publishes into an open project without the
authority that admitted it: an older request inside the same project, a replaced project, a missing local-work budget,
or a completed import that never reaches storage and autosave. A matching project alone does not authorize an older
request; distinguish the project's lifetime from the user's latest request within it. Each probe names the awaits to
hold, the observable to read (stored state and notices, never parser calls or promise completion) and the mutation
that must fail the case.

## Standing probes

1. **A file-preparation route skips the local-work budget (#1986 `e36b9589c2`, #2648 `7b41fd731c`, #4479).** #1986
   made stem preparation refuse a missing work-budget callback before decode or staging; #2648's
   `submitAdmittedPromptRequest` never passed that callback to `planPromptActions`, and #4479 kept the route. Submit a
   two-file stem import through the real Prompt Bar planner with only picker, decode and storage ports replaced: an
   admitted budget produces one confirmable card and commits once; an exceeded storage limit keeps the exact
   refusal, reserves none of the three stem categories and reaches neither decode nor staging. Keep cancelled and
   invalid selections at the same boundary. A mocked planner or prepared-scope result cannot prove the route carries
   the callback.
2. **Inverse completion inside one project (#5397 `2dc50d1388`; caught at #5516 review `49ce4baa3c`, fixed
   `0951d30904`).** #5397 brought project-lifetime checks into Scala import, but two imports in the unchanged
   project kept equal authority and A's delayed completion overwrote B's choice. Hold import A at the picker, file
   read and parser independently, start import B in the same project, complete B first, then resolve or reject A:
   only B changes the tuning or reports success, and A's structured errors, rejected promises and console errors
   stay silent. Exercise browser selection and native selected-file reads through their real boundaries across the
   picker, read, parse, write and notice routes. Removing the request-identity conjunct must fail this case.
3. **A replaced project receives an outgoing import.** Repeat probe 2 with a prepared project replacement and with
   an activated replacement reusing the project ID: neither outgoing request writes or notifies in the successor.
   Pair those refusals with a current successful import, current failures and ordinary edits during the wait, which
   the accepted import must preserve. Removing the project-lifetime conjunct must fail the replacement case.
4. **A completed import never reaches storage or autosave admission (Scala import `0960a49339`; #4883, #5397 kept it;
   found at #5761 review `2c845ad3e0`).** The Scala import wrote project tuning without calling `markDirty`, so a
   valid browser import reached the real store and CRDT while leaving `dirty: false`; the installed tracker watches
   tracks and tempo, so their positive controls do not prove import bookkeeping, and autosave admits only dirty
   projects. Run a successful import against the real normalized project store, CRDT adapter and installed dirty
   tracker; flush the actual write and require both the imported table and dirty state, proving the tracker active
   with its normal positive control; writing the tuning without `markDirty` must fail that dirty-state assertion.
   Cancellation, malformed input, supersession and project replacement leave a clean current project clean. Keep the
   loading guard and recheck request ownership before bookkeeping and after synchronous dirty subscribers, before
   publishing success. A mocked store or mocked tuning-write and notice assertions cannot prove autosave admission;
   this evidence does not establish a live save/reopen loss.
5. **Every await after decode re-checks the accepted sample (Crumbs: `c8c1257477` unfenced continuation; #5041
   guarded only decode; #5780).** Telemetry and peaks stayed separate stale-publication windows. Hold each await
   independently against the real session store. Complete B before releasing A, and separately leave B decoding:
   require B's exact metadata/vector and pending flag. Replace the accepted sample without starting another load.
   Check project/device lifetime and the actual accepted leaf after each await and synchronous subscriber, while
   ordinary edits and the accepted sample's own persistence round trip remain valid. Removing either post-await
   check must redden its corresponding case; a decode-only inverse-completion test cannot.
