# Lesson library: asset cache publication

Defects where decoded or durable audio is published into a cache, ownership row or settled record whose target,
source or authority changed while the work waited, or where decoded audio loses residency before its owner commits.
A session may remain current while an active clip's decoded-audio target changes, so session ownership alone never
authorizes delayed PCM publication; local object identity, runtime tokens, lease equality and scope locks never
establish persistent PCM identity. Each probe names the state to hold, the identity transition to inject, and the
mutation that must fail the case.

## Standing probes

1. **A current session must not retain a revoked clip alias (#3955).** Session-owner fences alone leave the
   same-session alias and empty-cache races. Hold the shared asset resolver at blob read and decode independently.
   Keep its session current; change the track, clip, hash or buffer identity, or fill the slot before the old
   completion. Old PCM must not publish, while later unchanged aliases still resolve. Capture the target before
   waiting and re-read its active association and empty-slot authority after each yield and before caching.
   Removing only alias validation or only the empty-slot guard must fail the connected producer case;
   unchanged-current and later-alias controls must still pass.
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
7. **Two accepted bounces must not reuse clock-based material identity (#226).** A material ID built from
   `Date.now()` (`bounce-sel-${trackId}-${Date.now()}`) collides when two bounces land in one clock tick. Run two
   successful typed bounces on one track while `Date.now()` is fixed, with distinct nonperiodic first PCM and second
   PCM. Undo the second and authenticate the first cached material through the actual retained clip/history
   reference; Redo must recover the second. An ID-inequality assertion alone is insufficient: replacing the
   `crypto.randomUUID()` producer in `bounceSelection.ts` with the timestamp must fail a fixed-clock restored
   first-PCM comparison in `src/modules/Arrangement/useCases/freezeBounce/__tests__/bounceSelection.spec.ts`. Use the platform's unique
   identity producer and retain unrelated source PCM. This is runtime/history material proof, not a durability
   receipt or saved-session replay claim.
8. **Decoded imports stay resident until their clip owner commits (#6038, #4962).** Scoped holds for decoded
   buffers awaiting placement protect nothing on a caller that decodes without one. Drive manual import under
   competing cache writes while original-asset staging or the actual snapshot transaction queue holds placement.
   Retain before the decoder's cache write, through the awaited retained batch outcome, and release in `finally`
   after transfer or terminal cleanup. Exercise existing-track import, new-track import, file drop and the
   empty-timeline menu through their real producers. Require exact PCM and matching raw/projected clip identity
   plus actual typed history and grouped Undo. Removing only the lifetime hold must lose the pending source under
   cache pressure in `src/modules/Arrangement/presentations/__tests__/manualAudioImportResidency.integration.spec.tsx`
   or `src/modules/Arrangement/useCases/__tests__/importAudioClipToTrack.residency.integration.spec.ts`.
   Cancellation and staging failure must release leases, decoded material and holds; re-cache the now-unowned ID and
   pressure it to prove a leaked hold cannot hide behind deletion. For a committed source, retire the real clip and
   history owners before proving the temporary hold ended. Mere residency while the live clip still protects it
   proves no release, and a readiness wait cannot repair an evicted source.
9. **A published imported buffer ID has PCM on its first material read (#6342).** Decode caches synchronously
   before returning, so a retry around an evidence read accepts a one-shot source miss as transient and hides the
   defect; permanent-absence and deadline attacks do not expose this masking. Inject one null read result for a
   real cached buffer, then permit subsequent actual reads: the case must fail at that first missing source.
10. **A sample row placed after eviction restores its original PCM (#4045, #6287, #6372).** Browser sample rows can
    outlive runtime residency before the placement gesture, and a cache-only lookup at placement substitutes or
    loses the source. Evict a real imported stereo source while its stored or pending-session PCM remains, then
    place through the registered Command and verify the same ID, exact runtime Float32 channels, the actual staged
    WAV's quantized samples and hash, raw/projected state and Undo/Redo. A preview control's Stop label is
    insufficient when a cache miss substitutes a tone. Restore the original through the existing scoped storage
    read, hold it until placement commits or aborts, and prove release after the real clip owner retires. The
    library-file fallback creates another decoded UUID: retain that ID before its cache write too. Revoke project
    authority during restoration and factory lookup; neither late completion may stage through the new project's
    global asset owner. Apply eviction before the gesture plus pressure during staging and commit admission, not a
    longer UI wait. Restoring the cache-only lookup must fail
    `src/modules/AudioEngine/stores/__tests__/audioBufferCacheUnpinnedRestore.spec.ts` or
    `src/modules/Arrangement/presentations/hooks/__tests__/useTimelineFileDrop.spec.tsx`.
