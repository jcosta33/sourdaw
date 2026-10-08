# Provider request content

When caller-authored records feed a provider request, trace the serialized body to every source
field. A production parser accepting a record proves its shape, not that all of its fields are
necessary or safe to send. Unknown metadata and reviewer baseline evidence must stay local when
the provider's questions need only stance names and admission lines.

Probe the real CLI with an offline fetch replacement. Put runtime-composed synthetic credential
shapes in an intended admission field and require refusal before fetch, with a diagnostic naming
the field and reason but never its value. Put the same shapes in excluded metadata and baseline
evidence and require those fields to disappear from the captured body while genuine admissions,
indexed questions, and verdicts remain aligned. Exercise the request builder directly too: a
manually constructed record must not bypass projection or screening.

## Escape: stance-checker caller content

[PR #4484](https://github.com/jcosta33/sourdaw/pull/4484), merged as
`4504a6987b8d4e8ec43ca2d408e7f1b8077d4eb6`, introduced the raw-state route:
`readStancesCheckRecord` returned `state: raw`, `buildStancesCheckBody` copied that state, and fetch
serialized the entire body. That admitted unknown fields and baseline-probe prose to the provider;
issue #4998 recorded an offline synthetic reproduction, not proof of live credential disclosure.

The missed risk was caller-content egress. The public review against the final head
`7c7a2bfc8662e3fb8df9802f14a44705de529b56` established that the API key appeared only in a Bearer
header and that the checker had no trusted-write or Gate authority. Those checks did not observe
credential-shaped values in the caller's request state. The retained local review bundle is
unavailable, so the historical stance name and dispatch wording cannot be established; the public
record supports a missing content probe, not a claim about a particular reviewer's tier.

The repair projects only `{ stance, admittedBy }` and uses the existing content screen on those
intended fields again at request construction. This is bounded defense in depth: the screen's
documented encoded or split-secret limitations still apply, and advisory status never makes
caller content safe to export.

## Escape: complete request admission and actual SDK bytes

[PR #4491](https://github.com/jcosta33/sourdaw/pull/4491), introduced by
`9effe3689c72384f30f60971ca40f26a44c0a355`, added the semantic adapter's cache lookup using caller
objects and its unchecked per-run token addition. Offline regressions admitted unsafe would-hit
cache requests and accepted provider success after cancellation. The missed risk is complete
request admission and cancellation across awaited effects; historical dispatch wording and tier
are not established here. Structural limits and actual SDK wire enforcement add defensive refusal
boundaries beyond those reproduced failures.

Screening a collected source region does not screen caller claims, reproduction notes, question
instructions, criteria, property names, or the final envelope. Trace both scan and verify into the
shared preparation boundary and exercise an unsafe request against a cache that would otherwise hit.
Require zero cache reads, reservations, recording calls, and delegated fetches. Descriptor accessors,
serialization hooks, cycles, omitted JSON values, sparse arrays, and invalid question unions must be
refused without executing caller getters or `toJSON`. Include exact UTF-8 caps and their next byte,
the depth and visited-value boundaries, and repeated noncyclic occurrences.

A measured request object is insufficient evidence of the SDK's wire body. Capture the installed
SDK's actual `fetch` `init.body` and compare it with the frozen prepared string for escaping,
multibyte text, nested descriptions, property order, and mutation after preparation. Force an SDK
serialization mismatch and require refusal before delegated fetch, one caller attempt, and no retry
even when the SDK wraps the local cause in `APIConnectionError`. Abort before cache read, during an
awaited cache read, before handoff, after provider success, during body delivery, and during retry
wait; require no accepted answer or cache write after cancellation. A byte cap never establishes a
token-count or dollar cap.

## Escape: usage aggregation after valid responses

[PR #4933](https://github.com/jcosta33/sourdaw/pull/4933), introduced by
`d03336ec91adeeb3ec8e084d8401151223688f97`, added the measurement fold's unchecked
`actualInputTokens` addition. Individually safe counts can sum to an unsafe integer across stored
scan/verification reports or evaluation-reader outcomes. The missed probe is the aggregate boundary;
historical reviewer stance and tier are not established here. Require `MAX_SAFE_INTEGER + 0` to
succeed and `MAX_SAFE_INTEGER + 1` to refuse before a measurement record is returned or emitted.
The per-run provider fold must likewise check all additions atomically before cache write and keep
overflow terminal, with no partial total update or retry.
