# Lesson library: security and platform boundaries

### 2026-10-29 — diagnostic words inside a Darwin pathname rejected usable storage evidence (introduced by PR #5274)

PR #5274 (`40baa0716b`) matched inspection-error words anywhere in an `lsof` name. A pure
`tREG` fixture named `/tmp/no info.txt` therefore rejected a complete catalog. The public final
review covered startup routing, borrower retention, interrupted reclamation, account admission and
failure reporting; a pathname-versus-diagnostic admission probe was missing. Historical private
prompts and tiers are unestablished. This counterexample does not identify the cause of a later
uninstrumented census failure.

Probe absolute REG/DIR paths containing diagnostic words without opening those filenames on the
shared host. Require the parsed path to veto storage reclamation. Keep unrooted errors and ambiguous
stat/readlink suffixes fail-closed, preserve whole/scoped replacement proof and the five-second bound,
and retain only bounded PID, descriptor, type and matched-category context, never unrelated catalog
names or environment text. Reverting the pathname distinction must fail the parser assertion;
dropping the retained context must fail the whole/scoped diagnostic assertions.

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
- Admit every managed-directory component before creating its children or publishing scheduler
  files. PR #5869's pre-delivery installer probe showed that a symlinked `Library` or `LaunchAgents`
  could replace an unrelated external plist before launchd inspection. Require an existing canonical
  home anchor, refuse each parent alias without external child creation or scheduler calls, and
  preserve an external plist sentinel byte-for-byte. Keep canonical directory creation and
  reinstallation positive controls. This was caught before delivery, not a main escape.
- Trace every authoritative field from its native response parser through the final equality
  witness. PR #5627's new historical-parent observation cut exposed an inherited omission of the
  child's live `baseRef`; cached `baseRefOid` did not bind its name, repository, target or presence.
  The omission is source-established at the base, and the reviewed head has a native-adapter
  reproduction; no base-head execution or live/main occurrence is claimed. Change each ref field,
  remove it, or recreate it after an admitted cleanup while returning the final parent marker
  response. Require the actual final child core to observe and refuse the change before closure or
  replay success, retaining owner and markers after an attempted close. An inspected null ref is
  bound absence; an internal core-only projection omitting the field is not an observed absence.
  Keep stable present-ref and cleanup-replay controls, and reject an explicitly owned undefined
  expectation. A selected native response field must exist: omitted or undefined `baseRef` is
  unavailable evidence, never the explicit null that admits cleanup. Probe native parser admission
  and CLOSED replay with a moved underlying ref but the selected key omitted; require no writes or
  success. These are finite client observations, not a server snapshot or protection from later
  external changes.
- Keep native selected-field requirements separate from optional internal proof projections.
  PR #5627's cached `baseRefOid` reader accepted an omitted selected nonnull SHA; the resulting
  undefined skipped cached ancestry and became null in a fresh historical binding. A controlled
  native-adapter reproduction rejected a present divergent SHA but closed when only that wire key
  was omitted; no live/main occurrence is claimed. Pair those inputs and require zero writes for
  both. Reject missing, null or malformed native cached SHAs before comment inspection, while
  preserving valid cached SHAs and explicit null live-ref cleanup on CLOSED replay. An absent live
  ref does not erase its cached commit, and deliberate non-native optional projections do not
  weaken the selected native response contract.
- Bind registered historical provenance to the source identity its registration actually attests.
  PR #5627's protected-primary lane fallback attests same-repository children; branch spelling and
  a shared fork commit cannot authorize a foreign source. Preserve the observed child source in the
  canonical record and require the same identity on replay after descriptor and ref cleanup. A
  registered source becoming null or foreign refuses; a record missing that required field is not
  upgraded. Keep real-DAG and native-adapter controls for native registration and for fork children
  with actual final-parent containment. The latter must ignore an unrelated same-named local
  ledger; a recorded null source is eligible only through that independent containment route and
  only while its observed identity still matches. These are reviewed source-contract reproductions,
  not claims of live/main occurrences or an established historical reviewer omission.

## Lessons from escapes

### Merged lane cleanup must prove release and survive removal refusal (introduced by PR #1802)

PR #1802 introduced lane removal (`4404e50fdc`) and cwd-only activity inspection (`2a13a418e1`).
A process outside the lane could hold a lane file open without blocking deletion, and a refused
native removal after unlock lost the original author lock. Historic private stance, prompt and
model are unestablished. A manual-only exit also left merged worktrees behind when delivery or its
caller stopped before removal.

Probe native removal with a spawned process whose cwd is elsewhere but whose descriptor holds a
lane file; incomplete/denied lsof catalogs and omitted live same-user PIDs must retain the lane.
Inject a native removal refusal after unlock and require the original author lock restored.
Kill the worker after durable queue publication and require a later process to reclaim only after
fresh merged-head proof. Race a second worker, move HEAD, reuse the same directory path, and tamper
with the installed runtime/manifest; stale authority or unverifiable bytes must never delete work.

Merge state alone does not prove that work reached `main`: an exact PR head merged into an open
stack parent is still unlanded. Require a live `main` base and valid merge timestamp for author and
review heads, and for the merged replacement of a closed superseded lane. Missing metadata stays
unproven; a missing `merged_at` must never map to merged. Probe non-main and unknown bases, missing
or malformed timestamps, open-state/timestamp contradictions and a base transition between the two
ownership reads. Preserve valid main merges and closed stack lanes whose truthful replacement landed
on main. The pre-publication integration probe exposed this eligibility gap before automatic cleanup
was shipped; historical review dispatch details remain unestablished.

### 2026-10-29 — private install ownership omitted cross-environment settings (introduced in PR #2)

PR #2's `10f24a6f03` pinned pnpm 11.6; CI defaults an unset virtual-store setting to false, but
local freshness comparison still sees unset. Existing ownership checks could accept the install
while an ordinary local package command refused it. Historical private prompts and tiers are
unestablished; this refusal does not establish a security exposure.

Probe the real pinned runner with a private offline install under CI followed by local and CI
package commands using repository workspace policy. Require unchanged lock/ownership metadata and
a checkout-private virtual tree while retaining shared download-cache policy and freshness checks.
Removing the explicit false pin must expose the same setting mismatch; a precheck bypass, metadata
rewrite or different CI environment cannot carry that proof.

### 2026-10-29 — a replacement PR left its public fixture in scanned history (#5746 and #5748)

PR #5746's original commit `cc52a482abc4b62519a79e1984e683893c31cbc0` quoted the RFC 6455
section 1.2 WebSocket nonce. Replacement #5748 composed it at runtime and excluded the original
commit from its PR range, but Nightly's `--all` scan still reached the retained original branch.
The missed proof route was retained history after replacement; private reviewer prompts and tiers
are unestablished. The value is a published protocol example, not an issued credential.

Read the exact historical finding and its public source. Prove detection with the pinned scanner,
then admit only that commit/path/rule/line fingerprint. A wrong fingerprint and independent synthetic
credentials, including `gitleaks:allow`, must remain detected under the same trusted configuration
and flags. A clean replacement diff does not establish a clean full-history scan.

### 2026-10-28 — PR security scan lacked its main comparison configurations (PRs #3170 and #4854)

PR #3170 moved the main CodeQL producer from Health gates to Nightly, leaving the older main
configuration in its analysis history. PR #4854 later added a PR scan under Health gates' default
identity, distinct from Nightly's main category. Successful scans and Gate did not prove all main
configurations were compared. Historical private reviewer prompts and tiers are not established.

Paginate all main analysis configurations, not just the newest results, and compare their identities,
scan scope and the hosted PR summary with actual uploads. Before any authorized retirement, inspect
alert continuity and the documented deletion and historical-data consequences. Mutate or omit the
PR category and require the independent contract to fail after re-recording the workflow snapshot.

### 2026-10-28 — desktop fallback filenames lost the selected File authority (issue #5767)

Commit `4f410257b212` introduced a native-dialog rejection fallback that returned browser
`File.name` strings; the desktop consumer read those strings as native paths. GitHub reports no
associated PR. PR #2's `4faaa241a461` retained that earlier fallback while removing a later
native-read-error retry, and #2181 retained it through Electron cutover. Historical reviewer
prompts and models are unknown. The missed boundary was selection provenance through the actual
byte consumer: separate mocked fallback-name and native-path checks stayed self-consistent.

Reject the native opening, drive the real browser input with real Files, and read the returned
bytes with the platform FileReader. Require original File identity, contents, MIME type,
lastModified, order and same-basename separation, with zero native path reads. Keep granted-native
byte reads and cancellation controls, and require native byte-read failures to propagate without
another picker. A handle-only consumer must refuse browser-only authority before registration,
without exposing a path, File or raw error. Removing provenance dispatch or that refusal must
redden the owning case. These renderer-boundary probes establish neither OS-dialog execution nor
a security exposure.

### 2026-10-27 — accepted NAM dimensions exceeded the runtime input width (introduced by PR #5209)

PR #5209 (`54ff77cd1f930903d6e5a6f9024a45c87b67b063`) added the LSTM loader with
deeper cells sized to `hidden_size` while rendering passed a one-element input to every cell.
The source establishes the length contradiction for `num_layers > 1 && hidden_size > 1`;
no trap on the introducing head was measured. The missing coverage obligation was the layer/width
cross-product. Historical private reviewer prompts, assigned stances and model tiers are unknown.

Pass an exact-layout, finite-weight two-layer/hidden-size-2 file through the actual loader and
prewarm entry. Require a named refusal before construction/prewarm, paired with successful
single-layer/wide and stacked/hidden-size-1 controls. Count initial hidden/cell state and the head
in the fixture, rather than guessing its length. Exercise the public import boundary and rebuilt
WASM bytes too; a validated metadata object alone cannot prove runtime admission.

### 2026-10-27 — immutable identity proof could not cross the remote schema (introduced by PR #5705)

PR #5705 (`7f4299b2f4bca1afd57b2cfce9656f3705d5a588`) selected `author { id }` from
GitHub's Actor interface, which does not expose `id`. Live GitHub rejected the query before
historical admission could observe either author. Parser fixtures supplied IDs directly. The
public approval describes lineage and native-reader probes; private prompts and tiers are unknown.
The missed stance was remote identity availability across the actual query/parser boundary.

Validate the native query against the remote schema, selecting immutable IDs only on supported
concrete Node types. Pair real Bot/User responses with missing and unsupported author refusals;
never substitute a mutable login or silently admit absent identity. Restoring direct Actor.id must
fail the emitted-query regression and the read-only live query.

### MIDI Learn armed without an available input route (introduced in `4f410257b2`)

The earliest observed MIDI Learn start route, `4f410257b2` (`src/modules/Track/useCases/midiLearnUseCases.ts`), set learning state and a target without checking platform input capability. Later moves retained the route; #401 and #1853 are retention evidence, not introducing changes. No associated introducing PR or historical reviewer stance is established, and exact historical prompts are unavailable. The missed risk was capability admission across real entries and direct start, not just UI messaging.

Follow platform capability through every real MIDI Learn entry and direct start action. With both input routes unavailable, require a new start to leave learning state and target unchanged and schedule no new learn timeout; pair with browser and native available-route controls. Remove the start guard as a mechanical negative control and require the unsupported-route check to fail. Preserve cancellation of an active learn, mapping removal and ordinary parameter edits. These checks do not establish physical-controller or native-hardware acceptance.

### 2026-10-25 — a current branch ref substituted an unrelated historical parent (introduced by PR #5615)

PR #5615 (`8d1d45758b7abe5fc74ea7319f27052f4656af5f`) bound the child's current base
ref to the named parent's final head but never established that parent belonged to the old child's
history. Source inspection establishes the older same-replacement gap; base-head execution was
not performed. PR #5627's new distinct-replacement path reproduced it with real Git commits:
the old child's original parent work was absent from the merged replacement, while a reused
parent ref and genuine replacement ancestry still permitted closure. Two unbound child markers
also permitted deleted-ref replay through the wrong parent. No live occurrence is claimed.
The public #5615 approval describes changed-target probes; exact historical prompts/tier are
unavailable. The missed risk was historical association, beyond present ref equality.

Use a real content-bearing Git DAG with unrelated parents sharing a base. Require final-parent
containment or previously registered native fork provenance, and reject cached/common ancestry
alone. Keep a genuine late-parent control whose final head is absent from the old child. Preserve
the exact admitted binding in an authorized canonical marker; delete local metadata and the ref
before replay, then substitute another parent or malformed/missing binding and require zero writes.
Never reconstruct missing provenance from reviews, workflow associations or prose.

### 2026-10-25 — dependency authority changed during its final thread response (introduced by PR #5615)

PR #5615 (`8d1d45758b7abe5fc74ea7319f27052f4656af5f`) introduced stacked supersession
whose parent core was read before separate marker and thread requests. Source inspection shows
the older same-replacement route retained that split; a base-head execution was not performed.
PR #5627 carried it into distinct replacements. Controlled native-adapter cases at its reviewed
head reopened the parent during its last thread response while head, branch and child ref stayed
unchanged; post-close verification and CLOSED replay still reported success. No live occurrence is
claimed. The published #5615 approval describes changed-target and late-finding probes; exact
historical reviewer prompts and tier are unavailable. The missed risk was movement inside each
dependency authority's composed proof, beyond the child-only final witness.

For every proof subject, mutate its core during its last dependent response. Drive actual shell
adapters and the serialized transaction at pre-write, mid-proof, post-close and replay boundaries.
Require an independent current core for parent and both replacements after all dependent reads,
then the existing final child witness. Preserve compensation before close and retained owner and
markers after uncertain closure. These observations bound client composition, not later remote
changes or a server-side compare-and-swap.

### 2026-10-24 — split PR metadata could close a head that arrived during comment reads (introduced by PR #2357, retained by #4420)

PR #2357 (`1f249ee008f428ec6a4b8c251802bdf8d601cd4c`) read PR core metadata before a
separate comment request, then closed by node ID alone. PR #4420 (`789351350ae323da1bac0aa68fc35b80a294c328`)
extracted the same mechanism into `supersedePullRequestGh.ts`. Primary GitHub source at those named
commits establishes the path; later Toaster integration #5413 is not its introduction. A controlled
production-adapter probe moved the head during the final comment response and observed CLOSE before
the command refused. No live occurrence is established. The missed risk is head movement inside
metadata composition; unavailable historical reviewer prompts do not establish whether its stance
was missing, mis-prompted or mis-tiered.

Drive the real inspection and close adapters together, move the head between core and comment
responses, and require refusal before CLOSE. Observe an independent, bound core response after all
composite marker/review reads, directly before mutation; malformed or wrongly bound witnesses must
refuse too. Finish post-close and CLOSED replay proof with the same witness. Preserve a stable
control and ambiguous-close evidence. `ClosePullRequestInput` carries no expected-head CAS: this
bounds client composition, not external changes after observation.

### 2026-10-24 — an acknowledged marker vanished from reads and released its owner (introduced by PR #5639)

PR #5639 (`256933a3bf60c17801ab8867f9d6dd2b998a1f2d`) added the serialized owner and
`VerifiedSupersessionCompensationError` release path around preexisting visibility-dependent
cleanup. An acknowledged comment ID omitted from later inspections received no delete, yet an
apparently original OPEN comment set certified rollback and released ownership. The final review
record included a strongest-tier ambiguous-write/altered-rollback stance; the acknowledged-write,
omitted-read input was missed. Exact historical raw prompts are unestablished. This is a controlled
source/reproduction escape, not evidence of a physical or API-lag production occurrence.

Keep a real marker after a valid creation receipt while every later inspection omits its ID. Drive
both serialized retirement and supersession; require zero unverified deletes, the real journaled
owner retained, and its exact native recovery command. Pair that with observed exact deletion and
verified OPEN rollback release. A missing read cannot discharge a known remote write.
After shared-owner recovery on stable OPEN or CLOSED state, require guidance to rerun the original
operation with its original bound inputs. Clearing a shared owner does not select delivery or
authorize a merge.

### 2026-10-24 — supersession bypassed its trusted process-tool launcher (introduced by PR #5639)

PR #5639 added a process-fenced supersession owner without routing its native package command
through the trusted write bootstrap. Its injected-fence lock tests passed while the real command
had no trusted `ps` pin and refused before PR I/O. Strongest-tier review was present; native CLI
and platform-tool admission was the missed stance.

Require the command registry, static source closure, risk-classification union and fenced-command
set to cover the actual package route. Drive its default process-fence consumer with a launcher-
resolved POSIX `ps`; verify Windows PowerShell selection independently. Inherited forged pins
must not survive snapshot isolation, and a missing platform tool must refuse rather than fall
back to ambient execution. A direct-script route and removal from the fenced set must each break
the real admission probe before any remote port call.

### 2026-10-24 — Linux cleanup proof went stale across process arrival, exit settlement, and output attribution (introduced by PR #5274, retained by PR #5443)

PR #5274 introduced two Linux whole-account observations, terminal file release only after an
ENOENT inspection, and immediate emission of the first unavailable-proof diagnostic. Its final
review did probe one unrelated newborn under `unrelated-process-churn-prevents-safe-reclamation`,
but not successive arrivals beyond that replacement. The retained review records contain no
EACCES-during-exit probe; the exact blind prompt and tier for that gap are unestablished. PR #5443
retained eager diagnostic output while adding final warning/leak classification. Its review
measured those outcomes and explicitly noted that a first-attempt diagnostic remained, but did not
require byte-exact parseable child output after startup recovery or a superseding release proof;
the exact blind prompt for that output path is unestablished.

Probe: run `bounds complete Linux replacement proof` with one new same-UID PID in each fresh
catalog; require reclamation when arrivals settle and bounded retention when they do not. Run
`counts a denied same-UID process as released only once it is gone or a zombie` with an EACCES FD
list progressing through live, reaped, and multithreaded-to-single-thread-zombie states; persistent
live and cwd denials stay unknown. Run `never proves Linux release from an observation that waited
on an exit` and require a new complete process observation after any wait, including retention when
a previously inspected process becomes a borrower. Run `keeps storage proof evidence out of the
child output unless it explains retention`; startup, superseded, and successful proofs leave
byte-exact parseable child output, while a retained run emits only its own final obstruction.

### 2026-10-21 — a capped catalog count could not converge on a busy Mac (introduced by PR #5274, retained by PR #5331)

PR #5274 allowed two Darwin `lsof` observations and PR #5331 three, within one five-second
deadline. `lsof` intermittently omits live same-UID processes, newborn or already listed, so under
real load every allowed catalog could miss one: guarded runs whose own work succeeded ended
`FAILED (leak)` and stopped their lanes (issue #5337). Both reviews accepted a fixed catalog count
as the conservative bound; no stance measured availability under natural process churn. This
supersedes the three-observation limit in the 2026-10-12 Darwin lesson below.

Probe: omit a listed live same-UID process from one whole catalog and require reclamation from a
fresh one; omit it from every catalog and require retention naming it at the deadline; alternate
the omission of two processes and require retention, never pooled coverage. For a missed holder
that forks into storage and exits before its liveness check, state sample, or scoped read, require
a fresh whole observation that finds the heir; one that forks after the closing process list and
stays an unreaped zombie must still reach the closing parent listing. Require a missed process gone
before the closing list to cost no fresh observation. Require the closing parent listing to catch a
heir handed storage by a live missed holder, including one reparented to launchd, and to ignore an
unrelated newcomer and another account's launchd children. Measure convergence with repeated
guarded real specs beside the base guard.

### 2026-10-21 — the start-time excuse ended with the live supervisor, so recovery kept the leak (introduced by PR #5345)

PR #5345 excused an uninspectable same-UID process only when it predated the run's live
supervisor. Every runner-account row that reclaims an exited or crashed run through a later guard
start, including a moved claim, still met the boot-time process denying `/proc/<pid>/cwd` and
retained that storage indefinitely, so the "Review tooling unit suite" stayed red on main. The
review accepted "recovery excuses nothing" as the safe side without running a recovery row beside
an older denied process; a dead owner's start still bounds what could have inherited from it.

Probe: recover a dead owner's storage, directly and from a moved claim, beside a denied process
older than that owner, and require reclamation. Bound the excuse by the start ticks the creating
supervisor recorded in its ownership record, never by the reclaimer's start; require retention for
a denied process started at or after that owner and for a record that carries no start ticks.

### 2026-10-21 — the storage census attributed foreign same-UID processes to every run (introduced by PR #5274)

PR #5274 proved its Linux file census only in a fresh isolated account. In the runner account a
long-lived same-UID process with EACCES on `/proc/<pid>/cwd` made every cleanup unknown, so nightly
unit shards and the runner-account "Review tooling unit suite" reported `leak`. That suite was
skipped on #5274 because its profile was broad, and the isolated unit shards have no foreign
processes.

Probe: run a guarded no-op in a populated Linux account beside an uninspectable process that
predates the supervisor, and require reclamation. Keep the denial retained for a process started
at or after the supervisor that created the storage, and for every denial whose owner start cannot
be established; the next escape shows why recovery must still apply the dead owner's recorded start.

### 2026-10-12 — transient Darwin descriptor omission exhausted complete-census admission

PR #5274 (`40baa0716b`) added conservative whole-account file proof but allowed only two
observations. Live account captures later showed complete/incomplete/complete catalogs;
the incomplete records had `f,n` without `t`. A vnode can have that shape, so skipping
nonabsolute unknown records cannot prove safe deletion. The historical review stance,
prompt and tier are unestablished; the uncovered risk was bounded census availability.

Probe: inject two successive missing-type catalogs, then a wholly usable third catalog
with fresh before/after PID coverage. Require owned release only from the complete catalog.
Persistent omissions, a third live borrower, expiry of the original five-second budget,
and an uncovered live PID in the final catalog must retain storage. Descriptor omissions and
exclusively new, same-UID live PID gaps may each discard a whole catalog only while another
of the three observations remains. A previously missing PID still present in the next
pre-sample is not new. Never merge partial catalogs or extend the deadline.

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
same-UID cwd or file descriptor. Keep denial unknown and retain storage, except for a process that
started before the supervisor that created the storage (read live, or from its recorded start ticks
during recovery) and so inherited no cwd or descriptor from it; that start time does not prove it
never opens a storage path it is later handed. For hosted test isolation,
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

### Process-group inspection EPERM — bounded settlement

Do not infer a foreign UID from inspection EPERM. Apple's XNU group signal traversal excludes
zombies, so an existing all-zombie group may return EPERM until reap removes its membership
([signal traversal](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c#L1549-L1624),
[reap](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exit.c#L2601-L2624)).
Current main source is not an installed-kernel binding, and the saved PR #5240 run did not observe
zombie state. Its earlier interrupted failure's errno is unknown.

Only inspection EPERM may be provisional; it is never absence. Require direct-child close and
exact ESRCH before settling or restoring source, retain unchanged escalation/confirmation bounds,
and reject persistent uncertainty with typed diagnostics. Inject EPERM then ESRCH around a real
owned child, persistent EPERM through the deadline, and termination EPERM followed by absence;
require only the first case to recover, with no extra group signals or loss of prior fatal evidence.

### 2026-10-29 — a declared Body choice never entered the worklet schema (PR #5254)

PR #5254 (`07182eab40171c11502e287c0da15a808fe09f11`) exposed the numeric Body chooser
while the existing finite Bacteria runtime schema omitted `convolutionIr`. Choosing Metal
could store `band0_convolutionIr = 2` without posting a control to the actual worklet.
Historical private review prompts and tiers are unknown; the missed probe was production
parameter admission between the real caller and receiver.

Pair positive admission of all six declared Body keys and indices -1/0/1/2/3 through
the real factory and production processor target with refusal of synthetic keys, band 6,
nonfinite values, forged identity, wrong generation and replay. Caller project parameter
maps must not widen the finite runtime schema. Remove only the declared Body key to
make the positive factory probe fail; a hand-built permissive target cannot establish
that valid controls cross the production trust boundary.

### Package-manager trust reaches the final caller

PR #4222 (`120c9e2b418`) introduced the setup action whose bootstrap could block the selected
JavaScript pnpm on unused native-engine signature metadata (#5806). PR #5464 (`eded998aebf`)
introduced the Corepack-producer and later Node/cache-consumer arrangement in push checks.
When that selected Node directory contains a Corepack shim, its later PATH prepend can override
an already verified target. These revisions identify the escaped contracts; historical private
reviewer prompts and tiers remain unknown, and public approval prose does not prove which
unrecorded probes ran.

The needed stance follows the executing tool through acquisition, activation and its final
consumer. Distinguish a reviewed bootstrap byte pin from runtime signature verification. Bind the
selected engine's name, version and installed integrity to a trusted signature before activation;
verify any platform package it actually executes. Then prepend the later runtime's directory and
prove the cache caller still resolves the authenticated target. Before disabling Corepack aliases,
validate the whole affected set of leaf symlinks and real targets against that selected Node's
official distribution. Refuse unrecognized launchers without deleting recognized peers, and
preserve Node, npm, npx, Yarn and unrelated files.

### A scheduler install must observe its first real launch (introduced by PR #5869)

PR #5869 introduced the cleanup installer, which ended at `launchctl bootstrap` and `launchctl print`.
That proves only registration. With the primary on an external volume, launchd refused the job before
it ran (`Unable to open stdout path ... Operation not permitted`), and `print` showed a rising `runs`
with `last exit code = 78: EX_CONFIG` at every interval while install reported success. Historic
private stance, prompt and model are unestablished.

Probe a scheduler install by observing the first RunAtLoad launch (`runs`, `last exit code`) on the
actual volume the job must write to, not a temporary directory. Stub `print` as `runs = 1` with
`last exit code = 78: EX_CONFIG` and as `runs = 0` for the whole wait; require boot-out, plist removal
and an error naming the pinned binary and remediation. Delete the launch observation to make both fail.
