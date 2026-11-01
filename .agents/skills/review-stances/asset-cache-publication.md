# Lesson library: asset cache publication

A session may remain current while an active clip's decoded-audio target changes.
Session ownership alone cannot authorize delayed PCM publication into that target.

## Escape: a current session retained a revoked clip alias

Commit `1d27112e9ac94295f965b35ec8856a07023f63cc` introduced the peer-asset resolver;
GitHub returns no associated PR. PR #3955 added session-owner fences but retained
the same-session alias and empty-cache races. Historical reviewer prompts and tiers
are unestablished; the missing probe is target revocation during read/decode.

Hold the shared asset resolver at blob read and decode independently. Keep its
session current; change the track, clip, hash or buffer identity, or fill the slot
before the old completion. Old PCM must not publish, while later unchanged aliases
still resolve. Capture the target before waiting and re-read its active association
and empty-slot authority after each yield and before caching. Removing only alias
validation or only the empty-slot guard must fail the connected producer case;
unchanged-current and later-alias controls must still pass.

## Standing probes: durable ownership, async cache admission and prepared settlement

Moved from the `state-and-write-paths` skill.

### Durable ownership must authenticate the exact current source (#3943)

Checkpoint retention acquired from raw audio buffer IDs, so a replaced runtime source could publish
ownership over stale disk PCM. Review every acquisition route with a genuine durability receipt and
active storage scope, then change the source after retention commits and prove exact-token cleanup
either removes the row or reports retained ownership explicitly.

### Async cache admission must stay release-visible before every await

Review the path from request admission through every await before cache registration. Release or
cancel while transfer data is pending, then admit a fresh request and prove late cleanup affects
only its exact former entry. Tests must observe release-visible ownership before provider creation
begins.

### Prepared settlement review crosses module instances (#3877, #4051)

Use a dedicated integrity-review stance with two module instances sharing IndexedDB and the named
storage lock. Test known durable, hydrated and evicted PCM, and attack fresh durability checks
separately from acquisition through an older receipt. Reuse one buffer ID and lease with different
PCM and persistence revisions, then exercise promotion and discard over temporary and already-settled
durable owners. Local object identity, runtime tokens, lease equality and scope locks do not
establish persistent PCM identity; the source map (#3877) and receipt authentication (#4051) each
need this cross-instance proof. Compose eviction with an explicit retained project reset and
hydration in one attack: isolated eviction and hydration cases do not prove that the retained
transition preserves an identity witness when no decoded runtime remains.

Treat any pre-commit cache invalidation as an identity transition, not cleanup. A cold module can
authenticate an exact prepared row from its durable revision, stage deletion and then observe an
aborted transaction; the unchanged row must remain readable and recoverable in that same module.
Carry explicit preserved, read-origin and admitted-commit witnesses through invalidation, and attack
each with a later source replacement before accepting retry or recovery. Capture a prepared release's
publication authority at mutation admission, before it waits for the storage lock; recapturing
inside the queued storage phase can authenticate an intervening ordinary replacement as the older
prepared commit.
