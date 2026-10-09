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
even when the SDK wraps the local cause in `APIConnectionError`. Abort before cache read, during a
synchronous cache callback, before handoff, after provider success, during body delivery, and during
retry wait; require no accepted answer or cache write after cancellation. Cache reads are synchronous:
refuse a Promise-shaped answer locally without awaiting it, before budget, provider, or cache-write
effects, even when that Promise never settles. A byte cap never establishes a
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

## Escape: opaque Bearer scheme values

[PR #4491](https://github.com/jcosta33/sourdaw/pull/4491), introduced by
`9effe3689c72384f30f60971ca40f26a44c0a355`, added the shared screen and semantic
adapter without recognizing opaque value-bearing HTTP authentication schemes outside vendor
prefixes and secret assignments. Issue #5144 retained synthetic offline captures through scan and
the installed SDK delegate, plus the stance CLI; these prove request admission and serialization,
not disclosure of a real credential or remote network egress. Historical stance name and tier
remain unestablished.

Probe runtime-composed opaque Bearer values in ordinary source on either side and beyond a named
hunk, verify evidence and every carried finding description, complete request leaves and keys,
and both stance admission fields through parser, manual builder, direct wrapper and offline CLI.
Require zero cache reads/writes, reservations, recording/provider calls and delegated fetches for
the rejected unit, including a schema-valid would-hit cache. Pair refusal with placeholder/reference
controls and a clean independent unit. A benign first candidate must not hide later material, and
repeated calls must not inherit regex state. Revert only the recognizer on a committed head and
require these caller oracles to fail. Keep the serialization-only screen probe independently
load-bearing; decoded Bearer rejection does not prove the final-envelope screen.

Bearer literals follow scheme-value rules: dotted or mixed-case alphabetic material is not a member
access or identifier, including in raw finding/stance descriptions and before explanatory words.
Actual interpolation/concatenation remains a reference. Explicit placeholders remain controls;
an uppercase name ending `_PLACEHOLDER` is deliberately treated as documentation, so real material
using that marker is an accepted residual. Other underscore-bearing values receive no name exemption.
Generic secret-assignment reference rules remain separate.

Only the explicit case-sensitive documentation descriptor `credential-shaped` receives a prose-context
exemption between surrounding ordinary words. The same descriptor alone, quoted as a scheme, or in an
Authorization header must be refused. Arbitrary lowercase hyphenated values remain literals even
between ordinary words: a broad alphabet-and-context exemption admitted runtime-composed opaque
material through the stance builder and SDK delegate. Restore that broad exemption on a committed
head and require the source, finding, complete-envelope and stance refusal cases to fail.

Actual credential material equal to the explicit descriptor in that prose context remains an accepted
documentation-marker residual, like the explicit placeholder marker above; this is not semantic prose
classification or sanitization of arbitrary source. Pair the exact descriptive sentence with a valid
matching-cache read and zero provider or fetch calls; keep dotted/alphabetic literals with trailing
words as refusal controls.

Explicit Authorization headers use RFC 6750's one-character minimum, including a quoted header
key paired with its value and the escaped representation inside serialized JSON. Do not borrow
the generic assignment screen's 16-character floor for that context. Probe one-, fifteen- and
sixteen-character literals and the public RFC example in complete request leaves and keys and
through source, finding and stance callers. An actual header object must refuse when neither
individual key nor short value triggers the screen: the final serialized envelope carries their
pairing. Keep these assertions load-bearing by reverting only the explicit-header handling.
Unqualified short scheme text retains the opaque-value floor; this bounded screen does not claim
universal credential detection. Header context cannot take the descriptor prose exemption.
