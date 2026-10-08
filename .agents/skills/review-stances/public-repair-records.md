# Public repair record admission and refusal diagnostics

Public review replies become repair evidence only through the immutable author or reviewer App
actor ID. Keep that identity across the REST adapter and admit it before parsing a repair marker
or checking its root binding. Missing, unreadable, foreign, and orchestrator actor identities
contribute no repair evidence. Malformed records from either authorized App still fail closed.
Review verdict roles remain a separate contract: allowing author repair replies does not make
author reviews governed rounds.

## Standing probes

- Feed paginated REST comments through the production reader. Preserve both App node IDs, map
  absent or unreadable identities to null, and reject identity inferred from a matching login.
- Put the same malformed marker bytes under author, reviewer, foreign, and unknown identities.
  Only the authorized records may refuse reconstruction. Foreign valid markers must contribute
  no repairs, including when they answer an unknown root; authorized unknown-root records refuse.
- Exercise fresh `publishReview` below the escalation threshold through its real admission path.
  A malformed foreign reply must permit the publication POST; the same reply from either App must
  refuse before any POST or bundle write. A reconstruction-only check misses this availability
  boundary. Preserve valid historical repair order, root bindings, and review role classification.
- Select multiple refused threads alongside eligible and ignored threads. Require every exact
  `repair-refused:<pr>:<thread>:<reason>` diagnostic before the aggregate failure, preserve ignored
  diagnostics, and assert zero confirmation and resolution calls for the whole refused batch.
  Checking only an exception or a refusal count does not observe the operator's recovery evidence.
- Persist a finding path containing LF, CR, CRLF, U+2028, or U+2029 in a canonical repair record.
  Require its full refusal cause on one physical prefixed diagnostic line, alongside zero confirmation
  and resolution calls even when another repair is eligible. Escape separators only when logging;
  legitimate Git paths and canonical repair bytes must still parse unchanged. Check ignored thread IDs
  containing those separators at the same logging boundary.
- Retain the ordinary eligible and idempotent flows. Use offline injected ports for these probes;
  they establish local admission and mutation ordering, not live GitHub behavior or repair truth.

## Escape: a foreign marker becomes a publication blocker

[PR #4565](https://github.com/jcosta33/sourdaw/pull/4565), merged as
`8b682bc8f58a30d39bd395fcab1771ef96a63b9a`, introduced reconstruction that discarded REST comment
actors and parsed every reply marker. [PR #4588](https://github.com/jcosta33/sourdaw/pull/4588),
merged as `93dbaf0ebae4b6b79f8844749148a09ce784dceb`, put that reconstruction ahead of the fresh
publication threshold comparison. A foreign reply containing `sourdaw-repair-v1 {not json`
therefore refused a fresh publication even below the escalation threshold (#5007).

The retained final-head #4588 stance
`the-guard-change-leaves-plan-carrying-publication-unchanged` admitted below-threshold behavior
changes but did not name malformed foreign reply input. The missed probe was actor admission
before parsing through the publication caller. #4565's public approval reports reconstruction
mutation probes; its final-head bundle is unavailable, so its precise stance and tier cannot be
established from that evidence.

## Escape: computed refusal causes disappear

[PR #4411](https://github.com/jcosta33/sourdaw/pull/4411), merged as
`ae4793d05ff2fc310a151a55ebe455dd2d816084`, introduced confirmation that logged ignored selections
but threw only an aggregate count for refused selections (#5004). Its public approval describes
selection, paging, author handling, and refusal checks; the final-head bundle is unavailable.
The missing diagnostic probe supplied two refused threads and checked their exact IDs and causes
alongside the zero-mutation guarantee. An exception-only check preserved safety while leaving the
operator unable to identify the records to repair.

## Escape: a persisted path splits a refusal diagnostic

[PR #5078](https://github.com/jcosta33/sourdaw/pull/5078) added refusal causes but interpolated
the persisted finding path verbatim. A canonical path `scripts/first.ts\nforged` against root
`scripts/actual.ts` split one cause across physical lines, leaving the continuation without its
`repair-refused` prefix. Ordinary-path exact assertions and zero-mutation checks missed the line
contract. The required probe preserves the whole-batch refusal while asserting one prefixed physical
record with the escaped separator and retained cause; rejecting the persisted path would hide the
logging defect and change the repair-record contract.
