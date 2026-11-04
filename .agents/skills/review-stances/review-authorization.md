# Standing probes: review authorization

Defects where review evidence still authorizes a delivery or publication after one local bundle artifact is lost,
malformed or rebound, after a later review or PR state supersedes it, or through a token or command that cannot
perform the mutation it claims. The authorization decision must follow the producer's provenance and the latest
live state, not the continued presence of one file or an earlier read. Drive the production shell port and trusted
entry, never a fixture that supplies a preselected binding, and require refusal before any remote write.

## Standing probes

1. **A lost generated artifact must not downgrade a modern bundle (#4573 `f32b620c10`).** The delivery reader
   returned `legacy` whenever `risk-plan.json` was absent although `review:prepare` had recorded it in
   `manifest.json.generated`, disabling the dossier requirement; the PR's tests supplied a chosen binding through
   `fakePort`. Trace every generated bundle file from `review:prepare` through the manifest and every consumer that
   grants publication, acceptance or delivery authority; remove one generated file at a time (start with
   `risk-plan.json`) while leaving the manifest and other caller records intact and call the production reader:
   refusal before a remote write. A malformed or missing manifest and a surviving dossier with no plan also refuse,
   while a complete planned bundle returns the bound authorization and its pre-authorization dossier digest.
2. **Manifest provenance: the oldest real shape is the positive control (#5057).** The original `prepareReview`
   producer at `6517347907b1d255aca9eff0545b488a824e95d6` wrote only `{ pr, baseSha, headSha }`, and the first
   repair's reader rejected that genuine pre-plan bundle because its control still supplied `generated`. Keep the
   exact three-field manifest as a positive control beside later pre-contract manifests whose `generated` list
   excludes the new artifact; make each manifest absent, unreadable, malformed or bound to another head. Unknown
   provenance never becomes legacy authority.
3. **Bindings come from the production shell port.** With a present plan, retain the live reviewer id, authorized
   dossier digest and exact head checks; mutate each binding independently and require refusal before merge.
4. **A stacked delivery reaches its final policy read (#5057).** The stacked-delivery case supplied
   `delete_branch_on_merge: true` to the initial policy read, which returned before the final control, so removing
   that control stayed green. Let initial deletion-policy reads pass and prove the final repository-policy read
   occurred before any author merge call, with zero merge attempts on refusal. If the first read already refuses,
   the final guard remains untested even when the error text matches.
5. **A later same-head reviewer decision revokes a recovered approval (#5158, pre-merge).** The
   `historical-approval-acquires-current-delivery-authority` stance covered merged, moved-head and unresolved-thread
   states but not a newer decision between publication inspection and authorization, so an old approval could bind
   `delivery-authorized` over a newer change request. Hold the exact landed publication constant across both remote
   reads, then introduce a later same-head reviewer decision before the complete review-state read: the old review
   may bind its publication (byte-identical replay, no second POST) but authorizes delivery only while the latest
   independent review is that same APPROVED review ID with no unresolved threads. Cover a later change request,
   comment, dismissal and different approval ID; keep the unchanged latest approval as the positive control.
6. **A retired mutation command refuses through its real trusted entry (#4411).** #4411 kept `review:resolve` for
   legacy roots but never established legacy eligibility, and its tests exercised it as a normal author mutation, so
   a modern finding still accepted author `Done` and resolution. Run the actual trusted CLI entry with a modern
   OPEN/current-head finding and sentinel authentication and GitHub ports: zero authentication, GitHub reads, replies
   and resolutions; restoring the old implementation must fail. An old PR number, a bare author `Done` or a missing
   bundle artifact never restores author-side resolution. Keep historical repair-record readers separate from retired
   mutation authority.
7. **Receipt recovery re-establishes publication authority (#5111).** Receipt shape and exact owner alone did not
   prove a modern dossier could adopt a landed publication: the absent-lock replay branch exited before
   authenticating the reviewer, serializing the write and comparing the retained payload with stable live evidence.
   Start from an exact landed version-2 receipt and an unbound modern dossier: require two stable exact remote reads,
   one append-only publication binding and no new POST on a second recovery or a native publish replay. Present a
   foreign lock, a live original owner, and a changed actor, head, body or payload one at a time: no dossier mutation
   or review POST; exact adoption only under the native lock. Restoring the early return from the receipt must fail
   the owning case (a fresh-owner recovery case exercises another branch). A merged PR's landed receipt binds the
   publication with no retrospective delivery authorization; granting authorization there must fail.
8. **Lock release after a definitive 422 needs every binding (#3342).** Force a definitive 422 after the journaled
   pre-write transition of a review publication. Recovery may release the lock only when the prepared bundle digest,
   head, reviewer actor and remote review enumeration all match; mutate each field in turn and require the exact
   owner to stay retained.
9. **The latest review is decided by `databaseId`, not connection order (#4069; observed on #6019).** #4069 took the
   last reviewer node in the GraphQL reviews connection as latest, but GitHub orders it by `submittedAt` and stamped
   the reviewer App's newest APPROVE earlier than older CHANGES_REQUESTED and COMMENTED reviews, so `deliver` refused
   an approved head; every fixture shared one `databaseId`. List the newest review first with the earliest timestamp
   and older ones after it with later timestamps, and require the newest by `databaseId` to decide; pair the inverse
   (an older APPROVE listed last behind a newer CHANGES_REQUESTED must not read as approved), and require a null or
   duplicate reviewer id to refuse instead of guessing.
10. **Delivery authority must come from the final PR state (#4586, extended by #5032; 2026-10-09).** #4586 appended
    `delivery-authorized` without a final PR state and head read; #5032's recovery stance covered a head already
    moved at inspection, not a merge, close or move after both inspections. Hold the landed review exact across both
    inspections, change the PR state or head before the final authorization read, and require a publication-only
    dossier with zero review POSTs; keep an open, unchanged PR as the positive authorization control.
11. **A minted token must admit every mutation its script performs (#4411, 2026-09-19).** `review:confirm` resolved
    threads through a reviewer token minted `contents: read`; GitHub gates `resolveReviewThread` on repository write
    access, so every confirm failed with "Resource not accessible by integration" and the universal author-side
    `Done` fallback masked it. For every GitHub mutation a shipped script performs, prove the minted permission set
    admits that mutation class: resolve or create one real thread under the minted identity in a fixture repository
    and require the mutation to succeed before the flow lands.
