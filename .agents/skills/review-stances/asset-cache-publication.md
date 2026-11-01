# Lesson library: asset cache publication

Defects where decoded or durable audio is published into a cache, ownership row or settled record whose target,
source or authority changed while the work waited. A session may remain current while an active clip's
decoded-audio target changes, so session ownership alone never authorizes delayed PCM publication; local object
identity, runtime tokens, lease equality and scope locks never establish persistent PCM identity. Each probe names
the state to hold, the identity transition to inject, and the mutation that must fail the case. Probes 2 to 4 moved
from the `state-and-write-paths` skill.

## Standing probes

1. **A current session retains a revoked clip alias (peer-asset resolver `1d27112e9a`; #3955 kept the race).**
   #3955 added session-owner fences but retained the same-session alias and empty-cache races. Hold the shared
   asset resolver at blob read and decode independently. Keep its session current; change the track, clip, hash or
   buffer identity, or fill the slot before the old completion. Old PCM must not publish, while later unchanged
   aliases still resolve. Capture the target before waiting and re-read its active association and empty-slot
   authority after each yield and before caching. Removing only alias validation or only the empty-slot guard must
   fail the connected producer case; unchanged-current and later-alias controls must still pass.
2. **Durable ownership must authenticate the exact current source (#3943).** Checkpoint retention acquired from raw
   audio buffer IDs, so a replaced runtime source could publish ownership over stale disk PCM. Review every
   acquisition route with a genuine durability receipt and active storage scope, then change the source after
   retention commits and prove exact-token cleanup either removes the row or reports retained ownership explicitly.
3. **Async cache admission stays release-visible before every await.** Review the path from request admission
   through every await before cache registration. Release or cancel while transfer data is pending, then admit a
   fresh request and prove late cleanup affects only its exact former entry. Tests must observe release-visible
   ownership before provider creation begins.
4. **Prepared settlement crosses module instances (#3877, #4051).** Use two module instances sharing IndexedDB and
   the named storage lock. Test known durable, hydrated and evicted PCM, and attack fresh durability checks
   separately from acquisition through an older receipt. Reuse one buffer ID and lease with different PCM and
   persistence revisions, then exercise promotion and discard over temporary and already-settled durable owners;
   the source map (#3877) and receipt authentication (#4051) each need this cross-instance proof. Compose eviction
   with an explicit retained project reset and hydration in one attack: isolated eviction and hydration cases do not
   prove that the retained transition preserves an identity witness when no decoded runtime remains.
5. **A pre-commit cache invalidation is an identity transition, not cleanup.** A cold module can authenticate an
   exact prepared row from its durable revision, stage deletion and then observe an aborted transaction; the
   unchanged row must remain readable and recoverable in that same module. Carry explicit preserved, read-origin and
   admitted-commit witnesses through invalidation, and attack each with a later source replacement before accepting
   retry or recovery.
6. **Prepared release authority is captured at mutation admission.** Capture a prepared release's publication
   authority at mutation admission, before it waits for the storage lock; recapturing inside the queued storage
   phase can authenticate an intervening ordinary replacement as the older prepared commit. Queue an ordinary
   replacement behind the lock and require the older prepared commit to refuse.
