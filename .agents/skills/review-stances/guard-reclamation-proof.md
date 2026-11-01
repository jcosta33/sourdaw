# Standing probes: guard storage reclamation and process settlement on an incomplete OS observation

Use this file for a stance that attacks whether the resource guard deletes verification temporary storage, or
settles a process group, on an operating-system observation that was partial, stale, denied, or mis-parsed.
Deleting storage another process still holds, and retaining storage forever, are both defects: a run whose own
work succeeded ended `FAILED (leak)` and stopped its lane (#5337). Each probe names the failure, the input, and
the check that must go red. Historical reviewer prompts and tiers are unestablished unless a probe says otherwise.

## Standing probes

1. **Storage has an owned deletion boundary (original guard `0e20269791`, retained through #2449; missed by
   #4899).** An RSS ceiling does not limit disk use, and killing a process grants no authority to delete an
   arbitrary system-temp cache. Place an unowned sibling beside a UUID-bound run, then attack owner JSON,
   symlinked roots, metadata and temp directories, reused PID identities, a missing process census, and
   competing scavengers. Only a proven-dead owned payload may disappear. Keep claim metadata outside recursive
   deletion and kill its reclaimer twice; a later owner must recover it without deleting live or uncertain
   state. Inject low and unavailable disk samples on each monitored volume and require admission refusal or
   contained runtime termination with an explicit nonzero failure reason.
2. **A session token is not a storage-user census.** Repeat the lifecycle probes with a detached child holding
   only `TMPDIR`/`TMP`/`TEMP` whose parent exits between samples, and with a supervisor crash before descendant
   tracking publication; Unix temp-path references must veto deletion. Repeat with no temp variables or token
   and only a cwd or open file under owned storage, including after the payload moves into a claim. Require OS
   file-use evidence, complete same-UID coverage, and retention for empty process output, missing utilities, and
   denied or partial fields.
3. **Linux descriptor closure and terminal file proof.** Include the scanner's own enumeration descriptor and a
   genuinely recreated slot; check presence without re-enumerating the directory; unavailable metadata retains.
   Probe terminal file proof with a real unreaped child and a zombie leader with live threads: require matching
   PID, thread group, four UIDs and exactly one thread; denied, incomplete or expired status retains. File
   release never grants authority to treat a registered PID as gone. UID equality does not grant `/proc`
   readlink access (dumpability and access policy can deny a live same-UID cwd or descriptor): keep denial
   unknown and retain storage, except for a process that started before the supervisor that created the storage
   (read live, or from its recorded start ticks during recovery), which inherited nothing from it. That start
   time does not prove it never opens a storage path it is later handed.
4. **Hosted test isolation must not excuse production inspection.** Prove the account's UID unused before
   install, every runtime identity field unprivileged, groups and capabilities cleared, private storage owned.
   Attack denied same-test-UID consumers before worker concurrency and require actual retention followed by
   reclamation after reaping. Isolation must not mutate hardlinked files or weaken shard execution. Root or the
   runner loading a helper does not prove the dropped identity can search its ancestry: Node may report a
   negative stat as a missing module, so admit source and the full tool closure under the actual identity before
   importing source. A private execution copy keeps the exact checked-out HEAD, all refs and history without
   shared object inodes; leave runner ancestry and action cleanup unchanged.
5. **Foreign same-UID processes attributed to every run (#5274).** The Linux census was proven only in a fresh
   isolated account; in the runner account a long-lived same-UID process with EACCES on `/proc/<pid>/cwd` made
   every cleanup unknown, so nightly unit shards and the "Review tooling unit suite" reported `leak` (skipped on
   #5274 because its profile was broad). Run a guarded no-op in a populated Linux account beside an uninspectable
   process that predates the supervisor and require reclamation. Keep the denial retained for a process started
   at or after the supervisor that created the storage, and for every denial whose owner start cannot be
   established.
6. **The start-time excuse must bound by the dead owner (#5345).** The excuse ended with the live supervisor, so
   every runner-account row reclaiming an exited or crashed run through a later guard start (including a moved
   claim) still met the boot-time process denying `/proc/<pid>/cwd` and kept the leak; the "Review tooling unit
   suite" stayed red on main. Recover a dead owner's storage, directly and from a moved claim, beside a denied
   process older than that owner and require reclamation. Bound the excuse by the start ticks the creating
   supervisor recorded in its ownership record, never by the reclaimer's start; retain for a denied process
   started at or after that owner and for a record carrying no start ticks.
7. **Capped catalog count cannot converge on a busy Mac (#5274 two observations, #5331 three; issue #5337).**
   Darwin `lsof` intermittently omits live same-UID processes, newborn or already listed, so under load every
   allowed catalog could miss one. This supersedes the three-observation limit in probe 8. Within the five-second
   deadline: omit a listed live same-UID process from one whole catalog and require reclamation from a fresh
   one; omit it from every catalog and require retention naming it at the deadline; alternate the omission of
   two processes and require retention, never pooled coverage. A missed holder that forks into storage and
   exits before its liveness check, state sample, or scoped read needs a fresh whole observation that finds the
   heir; one that forks after the closing process list and stays an unreaped zombie must still reach the closing
   parent listing; a missed process gone before the closing list costs no fresh observation. The closing parent
   listing must catch a heir handed storage by a live missed holder, including one reparented to launchd, and
   ignore an unrelated newcomer and another account's launchd children. Measure convergence with repeated
   guarded real specs beside the base guard; neither review measured availability under natural process churn.
8. **Transient Darwin descriptor omission exhausted complete-census admission (#5274 `40baa0716b`).** Live
   captures showed complete, incomplete, complete catalogs; the incomplete records had `f,n` without `t`, a shape
   a vnode can have, so skipping nonabsolute unknown records cannot prove safe deletion. Inject two successive
   missing-type catalogs, then a wholly usable third with fresh before/after PID coverage; release only from the
   complete catalog. Persistent omissions, a third live borrower, expiry of the original five-second budget, and
   an uncovered live PID in the final catalog retain. Descriptor omissions and exclusively new same-UID live PID
   gaps may each discard a whole catalog and trigger a fresh one, bounded by the five-second deadline alone on
   Darwin (the `scripts/resourceGuard.ts` loop runs while `Date.now() < deadline` and counts no observations;
   probe 7 supersedes the original three-catalog cap) and, on Linux, by `LINUX_CENSUS_OBSERVATIONS = 32` or that
   deadline. A previously missing PID still present in the next pre-sample is not new. Never merge partial
   catalogs or extend the deadline.
9. **A documented `LINK` vnode type invalidated the census (#5274 `40baa0716b`).** The parser omitted lsof's
   `LINK` type, so a same-UID capture with an absolute `LINK` outside guarded storage refused the whole catalog
   as `unknown-file-type` (not the original failed guard's field record). Open a private symlink with Darwin
   `O_SYMLINK` and observe its installed lsof record. A complete catalog containing an outside `LINK` stays
   usable; drive an owned `LINK` through file-use proof and release/recovery, including a moved claim, spaces,
   long paths and the deleted suffix, and its path must veto deletion. Missing, relative, malformed, diagnostic
   or unknown-type evidence still retains. Reverting type admission must fail the outside case; discarding the
   path must fail the live-holder case; adding a known type without following its path to the deletion veto is
   insufficient.
10. **Diagnostic words inside a pathname rejected usable evidence (#5274, 2026-10-29).** Inspection-error words
    were matched anywhere in an `lsof` name, so a pure `tREG` fixture named `/tmp/no info.txt` rejected a
    complete catalog; the final review covered startup routing, borrower retention, interrupted reclamation,
    account admission and failure reporting but lacked a pathname-versus-diagnostic probe. This does not
    identify the cause of a later uninstrumented census failure. Probe absolute REG/DIR paths containing
    diagnostic words without opening those filenames on the shared host, and require the parsed path to veto
    reclamation. Unrooted errors and ambiguous stat/readlink suffixes stay fail-closed; whole/scoped replacement
    proof and the five-second bound are preserved; retain only bounded PID, descriptor, type and matched-category
    context, never unrelated catalog names or environment text. Reverting the pathname distinction must fail the
    parser assertion; dropping the retained context must fail the whole/scoped diagnostic assertions.
11. **Linux proof went stale across arrival, exit settlement and output attribution (#5274, retained by
    #5443).** #5274 introduced two Linux whole-account observations, terminal file release only after an ENOENT
    inspection, and immediate emission of the first unavailable-proof diagnostic; its review probed one
    unrelated newborn under `unrelated-process-churn-prevents-safe-reclamation` but not successive arrivals, and
    recorded no EACCES-during-exit probe. #5443 kept eager diagnostic output while adding final warning/leak
    classification and did not require byte-exact parseable child output after startup recovery or a superseding
    release proof. Run the owning cases: `bounds complete Linux replacement proof` with one new same-UID PID in
    each fresh catalog (reclaim when arrivals settle, bounded retention when they do not);
    `counts a denied same-UID process as released only once it is gone or a zombie` with an EACCES FD list
    progressing through live, reaped, and multithreaded-to-single-thread-zombie states (persistent live and cwd
    denials stay unknown); `never proves Linux release from an observation that waited on an exit`, requiring a
    new complete process observation after any wait, including retention when a previously inspected process
    becomes a borrower; `keeps storage proof evidence out of the child output unless it explains retention`,
    where startup, superseded and successful proofs leave byte-exact parseable child output and a retained run
    emits only its own final obstruction.
12. **Process-group inspection EPERM is not a foreign UID (PR #5240 interrupted failure; errno unknown).** Apple's
    XNU group signal traversal excludes zombies, so an existing all-zombie group may return EPERM until reap
    removes its membership ([signal traversal][xnu-sig], [reap][xnu-exit]). Current
    main source is not an installed-kernel binding and the saved #5240 run did not observe zombie state. Only
    inspection EPERM may be provisional, never absence; require direct-child close and exact ESRCH before
    settling or restoring source, keep unchanged escalation/confirmation bounds, and reject persistent
    uncertainty with typed diagnostics. Inject EPERM then ESRCH around a real owned child, persistent EPERM
    through the deadline, and termination EPERM followed by absence; only the first recovers, with no extra group
    signals and no loss of prior fatal evidence.

[xnu-sig]: https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c#L1549-L1624
[xnu-exit]: https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exit.c#L2601-L2624
