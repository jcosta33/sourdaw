# Standing probes: public repair record admission and refusal diagnostics

Defects where public review replies become, or block, repair evidence without the right identity, ordering,
serialization or diagnostics. Replies count as repair evidence only through the immutable author or reviewer App
actor ID, admitted before parsing a marker or checking its root binding; missing, unreadable, foreign and
orchestrator identities contribute nothing, while malformed records from either authorized App still fail closed.
Review verdict roles are a separate contract: allowing author repair replies does not make author reviews governed
rounds. Use offline injected ports; they establish local admission and mutation ordering, not live GitHub behavior
or repair truth, and every probe keeps the ordinary eligible and idempotent flows as controls.

## Standing probes

1. **Actor identity survives the REST adapter (#4565 `8b682bc8f5`, #5078).** Feed paginated REST comments through the
   production reader. Preserve both App node IDs, map absent or unreadable identities to null, and reject identity
   inferred from a matching login.
2. **Malformed markers are judged by actor before parsing (#4565).** Put the same malformed marker bytes under author,
   reviewer, foreign and unknown identities: only the authorized records may refuse reconstruction. Foreign valid
   markers contribute no repairs, including when they answer an unknown root; authorized unknown-root records refuse.
3. **A foreign marker must not block a fresh publication (#4588 `93dbaf0eba`, #5007).** #4588 put reconstruction ahead
   of the fresh-publication threshold comparison, so a foreign reply containing `sourdaw-repair-v1 {not json`
   refused a publication below the round threshold (now the ADR 0054 freeze threshold); its stance
   `the-guard-change-leaves-plan-carrying-publication-unchanged` never named malformed foreign input. Exercise fresh
   `publishReview` below the freeze threshold through its real admission path: a malformed foreign reply permits the
   publication POST; the same reply from either App refuses before any POST or bundle write. A reconstruction-only
   check misses this availability boundary. Preserve valid historical repair order, root bindings and review role
   classification.
4. **Every refused thread is named before the aggregate failure (#4411 `ae4793d05f`, #5004).** Confirmation logged
   ignored selections but threw only an aggregate count for refused ones. Select multiple refused threads beside
   eligible and ignored threads; require every exact `repair-refused:<pr>:<thread>:<reason>` diagnostic before the
   aggregate failure, preserve ignored diagnostics, and assert zero confirmation and resolution calls for the whole
   refused batch. An exception or a refusal count alone leaves the operator unable to identify the records to repair.
5. **A persisted path must not split a refusal diagnostic (#5078).** #5078 interpolated the finding path verbatim, so
   canonical path `scripts/first.ts\nforged` against root `scripts/actual.ts` split one cause across physical lines.
   Persist a finding path containing LF, CR, CRLF, U+2028 or U+2029 in a canonical repair record; require its full
   cause on one physical prefixed diagnostic line with the escaped separator, alongside zero confirmation and
   resolution calls even when another repair is eligible. Escape separators only when logging; legitimate Git paths
   and canonical repair bytes still parse unchanged (rejecting the path would hide the defect and change the
   repair-record contract). Check ignored thread IDs containing those separators at the same boundary.
6. **A reviewer marker must postdate its selected author repair (#4411).** A matching reviewer marker with comment ID
   9001 could confirm a selected author record with ID 9002, because the selected reply ID was dropped before live
   admission and replay. For compact and legacy confirmations, make the author repair ID precede the reviewer
   confirmation ID through selection and replay; shuffle reply arrays, test earlier and equal IDs, and put an
   invalid later thread after a valid one: the whole batch refuses before any confirmation post or resolution.
   Preserve valid descendant-head replay exactly once.
7. **A confirmation links the repair by digest instead of copying it (#4411, #4565, #5078).** Confirmations copied
   the full `sourdaw-repair-v1` payload and cold reconstruction admitted author and reviewer into one collection,
   duplicating evidence bytes and reporting a confirmation as another author repair. With a populated, safe V1
   record, a new reviewer marker carries a digest of the canonical whole record without its evidence, and cold
   reconstruction keeps one author repair and a separate confirmation linked to that digest. Replay a posted
   confirmation after a resolve failure, and refuse mixed or doubled confirmations before any remote mutation.
8. **Concurrent repair writers are serialized (#4411).** Repair and confirmation writers did not serialize their
   read-absence/post transactions, and GitHub echoes `clientMutationId` without deduplicating, so two callers could
   both post the same confirmation and later replay refused the duplicates. Hold the real production coordinator
   after its per-PR v4 owner acquisition with an explicit barrier: a competing repair or confirmation refuses before
   authentication or remote reads while another PR stays independent; assert one authoritative post after release
   and replay. Use the existing Git owner and recovery runner in a disposable repository; bypassing the
   coordinator's serializer must fail. Core selection functions stay unlocked.
9. **A write that may have landed retains its owner for recovery (#4411).** For each write port (author reply,
   reviewer confirmation, reviewer resolve) make the remote apply the write then throw, or fail a resolve after an
   existing confirmation: require a retained `remote-mutation-attempted` v4 owner and its exact
   `deliver --recover-lock` command. Recover only after controlled dead-fence proof and two stable reads, then
   replay without a second post, a descendant head included; receipt replay needs no new authentication or remote
   read. Removing any write port's attempt marking must fail its retention probe. Keep whole-batch refusal,
   immutable actor/root binding, ancestry and duplicate refusal intact.
10. **The trusted route carries the lock and its governance classification (#4411; #5701 pre-merge).** Exercise the
    real trusted snapshot route: both commands need the lock source in their pinned closures and trusted process
    tools with detached POSIX groups; unit core success cannot prove launcher fencing or recoverable ownership, and
    removing either command's fence classification must fail the integration probe. Extracting a helper from a
    trusted writer must preserve both its exact source closure and the semantic governance-classification union:
    closure-only probes passed while `gitAncestry.ts` was missing from `GOVERNANCE_TRANSITION_PATHS`. Run the
    existing `reviewRiskPolicy.spec.ts` union-equality and every-closure-path `native-security` assertions beside
    the closure probes before publication, preserving their expected sets and classifications.
11. **Repair ancestry binds the finding revision, not the live tip (#4411 `ae4793d05f`, 2026-09-19).** #4411 rejected a
    repair equal to the live PR head (forcing an unrelated follow-up commit for a one-commit fix) while accepting
    commits already present when the finding was reviewed, in both author recording and reviewer confirmation.
    Require a one-commit repair at the live tip to record and confirm; refuse the reviewed commit, its predecessors
    and a merged sibling that does not descend it, with zero mutations for the whole confirmation batch. Read the
    root comment's review commit from GitHub in both production queries, preserve it across pagination, and refuse
    missing provenance. A reply's review or a comment's moving diff commit never replaces the revision that
    received the finding.
