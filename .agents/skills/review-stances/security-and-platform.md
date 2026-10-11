# Lesson library: security and platform boundaries

Lesson library for defects in native authority, renderer trust, platform capabilities, IPC
exposure, filesystem access, secrets, or operating-system integration. Per the Review section of
`AGENTS.md`, this directory is a lesson library, not a stance menu: an escape — a defect that
reached `main` whose defect class matches this file — is recorded here as a lesson, and every
dispatch whose derived stance matches this file carries its lessons. Lessons state the escape, the
blind spot, and the probe that would have caught it. Keep each lesson short enough to paste into a
dispatch.

## Standing probes

- Enumerate every implicit authority root from the live implementation. For each one, prove why the
  application owns the whole root rather than an app-specific child.
- Put a synthetic ungranted sibling one component outside every claimed owned child and exercise
  each exposed access mode. Require refusal for the sibling, then require owned-child and explicit-
  grant positive controls to succeed.
- Trace internal native scratch producers separately from renderer-reachable file commands. An
  internal consumer of a broad platform directory does not grant the renderer authority over it.
- Follow canonical paths through existing symlinks and missing tails before evaluating a root or
  grant. Check component boundaries and platform spelling behavior rather than string prefixes.

## Lessons from escapes

### 2026-10-10 — verification temporary storage lacked an owned deletion boundary

The original resource guard (`0e20269791`, retained through PR #2449) contained processes without
owning their temporary storage. PR #4899's Vitest upgrade review omitted the killed-run storage
lifecycle risk. An RSS ceiling does not limit disk use, and process termination does not grant
authority to delete an arbitrary system-temp cache.

Probe: place an unowned sibling beside a UUID-bound run, then attack owner JSON, symlinked roots,
metadata and temp directories, reused PID identities, missing process census, and competing
scavengers. Only a proven-dead owned payload may disappear. Keep claim metadata outside recursive
deletion and kill its reclaimer twice; a later owner must recover it without deleting live or
uncertain state. Inject low and unavailable disk samples on each monitored volume and require
admission refusal or contained runtime termination with an explicit nonzero failure reason.
A session token is not a complete storage-user census: repeat lifecycle probes with a detached
child retaining only `TMPDIR`/`TMP`/`TEMP`, whose parent exits between samples, and with a supervisor
crash before descendant tracking publication. Unix temp-path references must veto deletion.
Repeat with no temp variables or token and only cwd or an open file under owned storage, including
after the payload moves into a claim. Require OS file-use evidence, complete same-UID coverage,
and uncertainty retention for empty process output, missing utilities, denied or partial fields.
For Linux descriptor closure, include the scanner's own enumeration descriptor and a genuinely
recreated slot. Check presence without re-enumerating the directory; unavailable metadata retains.
Probe Linux terminal file proof with a real unreaped child and a zombie leader with live threads.
Require matching PID/thread-group/four UIDs and one thread; denied, incomplete or expired status
retains. File release never grants authority to treat a registered PID as gone.
UID equality does not grant `/proc` readlink access: dumpability and access policy can deny a live
same-UID cwd or file descriptor. Keep denial unknown and retain storage. For hosted test isolation,
prove the account's UID unused before install, all runtime identity fields unprivileged, groups and
capabilities cleared, and private storage owned. Attack denied same-test-UID consumers before worker
concurrency and require actual retention followed by reclamation after reaping. Account isolation
must not excuse production inspection failures, mutate hardlinked files, or weaken shard execution.
Root or runner loading a helper does not prove the dropped identity can search its ancestry: Node
may report a negative stat as a missing module. Admit source and the full tool closure under the
actual identity before importing source. A private execution copy must retain exact checked-out HEAD,
all refs and history without shared object inodes; leave runner ancestry and action cleanup unchanged.

### 2026-10-09 — publication used an earlier PR state for delivery authority (introduced via PR #4586)

PR #4586 first appended `delivery-authorized` after reading review state without a final PR state
and head read. Its recorded stances attacked wrong digest or head binding and unsolicited or
duplicate authorization, but did not admit a late PR state transition. PR #5032 extended that
vulnerable binder to recovered publications; its recovery-authority stance and moved-head probe
covered a head already moved at inspection, not a merge, close, or move after both inspections.

Probe that would have caught it: hold the landed review exact across both inspections, change the
PR state or head before the final authorization read, and require a publication-only dossier with
zero review POSTs. Keep an open, unchanged PR as the positive authorization control.

### 2026-09-09 — hosted WASM control and source revisions were assumed identical (introduced via PR #4057)

PR #4057 validated artifact provenance when the workflow helper and checked-out source shared a
revision, but GitHub executes workflow YAML from the merge revision while the workflow may check out
an older PR head without that helper.

Blind spot: review inspected a same-head build and receipt path, not the actual control CLI against
two pinned roots with source-local hashes and pins.

Probe that would have caught it: execute the real control helper against a distinct clean source Git
root lacking both hosted helpers; exercise relevant and irrelevant source changes plus divergent
closure hashes and toolchain pins, and require invalid or dirty roots to fail before source-toolkit
import. For return verification, use a source toolkit sentinel and prove the verifier only reads the
clean source root and never imports it.

### 2026-10-10 — ZIP fixture clock drift obscured the strict artifact boundary (introduced by PR #4057, commit `d608d165a49`)

PR #4057's streamed-artifact case and ZIP-based artifact-return fixtures used fflate 0.8.3 without
explicit `mtime` values. Both the streamed local/central header writes and the two `zipSync` writes
per file call `wzh`, which reads a fresh `Date.now()`. Crossing a DOS two-second boundary changes
the timestamp word, so the strict parser refuses the archive before its descriptor or artifact
checks run.

Blind spot: a clock-dependent positive fixture can make strict metadata validation look like the
problem. Preserve local-central equality and the parser's other metadata, bounds, CRC, path, and
encryption checks.

Probe that would have caught it: force actual streamed and `zipSync` fixtures across a two-second
DOS timestamp boundary and inspect both timestamp byte fields. Pin every ZIP fixture writer to one
fixed `mtime` using the supported `zipSync` options and streamed-entry property. Keep streamed
content acceptance and descriptor corruption refusal, along with all bounds, CRC, file-set, and
encryption oracles. On the fixed head, revert only `mtime` and require the forced-clock case to fail;
do not relax the parser. This proves boundary behavior, not the hosted failure's clock interval or
frequency.

### 2026-09-05 — the OS temporary directory was called app-owned (introduced via PR #2; retained by PR #3404; fixed by #3642)

PR #2 introduced `std::env::temp_dir()` as an implicit built-in root in commit
`eaf9b0687a322f4adb9633f3e45c914b9d0d5e5f`. PR #3404 later narrowed user-directory authority but
retained that root even though the same module defined `sourdaw_ipc` as Sourdaw's app-owned child.
Its review attacked grant and private-directory spellings but never proved ownership of every
built-in root, so an authorized renderer could read, list and write unrelated same-user temporary
files.

Blind spot: the root list's description was accepted as ownership evidence. No test placed an
ungranted sibling outside the app-owned child while remaining inside the broader OS temporary
directory.

Probe that would have caught it: enumerate every implicit root, create a synthetic ungranted
sibling one component outside each owned child, and drive every exposed read, list and write route.
Require the sibling to be refused without mutation while the owned child and an explicit recursive
grant remain positive controls.

### 2026-10-09 — an old receipt bypassed publication authority checks (issue #5111)

Receipt shape and exact owner alone did not prove that a modern dossier could adopt a landed
publication. The absent-lock replay branch exited before authenticating the reviewer, serializing
the write, and comparing the retained payload with stable live evidence.

Probe that would have caught it: present a foreign lock, a live original owner, and changed actor,
head, body, or payload one at a time to the production recovery route. Require no dossier mutation
or review POST. Permit exact adoption only under the native lock, and require a merged historical
approval to remain without delivery authorization.

### 2026-09-19 — the reviewer confirm token could not perform its own mutation (introduced via PR #4411)

`review:confirm` resolved threads through a reviewer installation token minted `contents: read`;
GitHub gates `resolveReviewThread` on repository write access, so every confirm failed with
"Resource not accessible by integration" and every lane silently fell back to author-side `Done` —
the public record never showed a reviewer-resolved thread.

Blind spot: review verified the flow's records and idempotence but never executed the identity's
own GitHub mutation, so a permission-set/mutation mismatch shipped; the universal author-side
fallback masked it from every later session.

Probe that would have caught it: for every GitHub mutation a shipped script performs, prove the
minted permission set admits that mutation class — resolve or create one real thread under the
minted identity in a fixture repository and require the mutation to succeed before the flow lands.

### 2026-09-19 — repair ancestry used the live tip instead of the finding revision (introduced via PR #4411)

PR #4411 (`ae4793d05f`) rejected a repair equal to the live PR head, forcing an unrelated follow-up
commit for an ordinary one-commit fix, while accepting commits already present when the finding
was reviewed. Both author recording and reviewer confirmation used the same wrong revision bound.

Blind spot: review accepted commit inequality as proof of a post-finding repair, and tests encoded
the tip refusal without binding the root finding to its associated review's commit.

Probe that would have caught it: require a one-commit repair at the live tip to record and confirm;
refuse the reviewed commit, its predecessors, and a merged sibling that does not descend it, with
zero mutations for the whole confirmation batch. Read the root comment's review commit from GitHub
in both production queries, preserve it across pagination, and refuse missing provenance. A reply's
review or a comment's moving diff commit must never replace the revision that received the finding.
