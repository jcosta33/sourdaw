# Standing probes: provider request content

Defects where a provider request carries caller content, credential-shaped material, unaccounted usage or internal
values the provider's question does not need, or where a byte reaches the wire after refusal or cancellation. Trace
the serialized body to every source field: a parser accepting a record proves its shape, not that every field is
necessary or safe to send. Compose synthetic credential shapes at runtime; offline captures through the real CLI,
installed SDK delegate and stance builder prove request admission and serialization, not disclosure of a real
credential or remote egress. A rejected unit must show zero cache reads/writes, reservations, recording or provider
calls and delegated fetches, including against a schema-valid would-hit cache. Revert only the production hunk on a
committed head and require the same caller oracles to fail without changing specs.

## Standing probes

1. **Caller records are projected and screened before the provider (#4484 `4504a6987b`, #4998).**
   `readStancesCheckRecord` returned raw state that `buildStancesCheckBody` copied and fetch serialized whole,
   admitting unknown fields and baseline-probe prose (the public review established only that the API key stayed in
   the Bearer header). Probe the real CLI with an offline fetch replacement: synthetic credential shapes in an
   intended admission field refuse before fetch with a diagnostic naming the field and reason but never its value;
   the same shapes in excluded metadata and baseline evidence disappear from the captured body while genuine
   admissions, indexed questions and verdicts stay aligned. Exercise the request builder directly: a manually built
   record must not bypass the `{ stance, admittedBy }` projection or the screen. The screen keeps its documented
   encoded or split-secret limits; advisory status never makes caller content safe to export.
2. **Admission covers the complete request across every awaited effect (#4491 `9effe3689c`).** The semantic adapter's
   cache lookup used caller objects, so offline regressions admitted unsafe would-hit requests. Screening a collected
   source region does not screen caller claims, reproduction notes, question instructions, criteria, property names
   or the final envelope: trace scan and verify into the shared preparation boundary and drive an unsafe request
   against a cache that would otherwise hit. Refuse descriptor accessors, serialization hooks, cycles, omitted JSON
   values, sparse arrays and invalid question unions without executing caller getters or `toJSON`; include exact
   UTF-8 caps and their next byte, the depth and visited-value boundaries, and repeated noncyclic occurrences.
3. **The installed SDK's wire bytes and cancellation are the oracle (#4491).** A measured request object is not the
   SDK's wire body: capture the installed SDK's actual `fetch` `init.body` and compare it with the frozen prepared
   string for escaping, multibyte text, nested descriptions, property order and mutation after preparation. Force a
   serialization mismatch and require refusal before delegated fetch, one caller attempt and no retry even when the
   SDK wraps the local cause in `APIConnectionError`. Abort before cache read, during a synchronous cache callback,
   before handoff, after provider success, during body delivery and during retry wait: no accepted answer or cache
   write after cancellation (#4491 accepted provider success after cancellation). Cache reads are synchronous: refuse
   a Promise-shaped answer locally without awaiting it, before budget, provider or cache-write effects, even when it
   never settles. A byte cap never establishes a token-count or dollar cap.
4. **Usage aggregation checks the sum, not the parts (#4933 `d03336ec91`).** The measurement fold's unchecked
   `actualInputTokens` addition let individually safe counts across stored scan/verification reports or
   evaluation-reader outcomes sum to an unsafe integer. Require `MAX_SAFE_INTEGER + 0` to succeed and
   `MAX_SAFE_INTEGER + 1` to refuse before a measurement record is returned or emitted. The per-run provider fold
   checks all additions atomically before cache write and keeps overflow terminal, with no partial total or retry.
5. **Billed usage survives rejected, partial and cached responses (#4393, #2648, #4407).** Use unequal raw, cache-read
   and cache-write counts and assert the provider's documented inclusive total and separate counters through the
   real producer, protocol accumulator, run budget and cost projection; a terminal output-only stream event must not
   add the input counters twice. Report each required counter as null in turn: the reservation stays non-final until
   both are known, settles once after a complete report, and every cost surface distinguishes a pending reservation
   from a final provider total. Stub an OpenAI-compatible 200 with two choices and inclusive usage 63/9 through the
   real adapter, inference and run accounting: one 72-token cost carrying the original attempt, provider and model, a
   typed retryable failure and zero executable tool calls. Dropping usage on the rejection path must fail.
6. **Internal level fields reach the provider wire (#4392).** #4392 asserted producer objects and a master/track-only
   projection. Inspect `buildAgentContext().message` in full and delta modes, change an unselected track's clip, send
   and gain lane independently of its gain and name, and require every linear value beside its decibel reading,
   removals represented, and exactly one law header.
7. **Opaque Bearer values are refused everywhere a caller reaches (#4491, #5144).** The shared screen did not
   recognize opaque value-bearing HTTP authentication schemes outside vendor prefixes and secret assignments. Probe
   runtime-composed opaque Bearer values in ordinary source on either side of and beyond a named hunk, verify
   evidence and every carried finding description, complete request leaves and keys, and both stance admission
   fields through parser, manual builder, direct wrapper and offline CLI. Pair refusal with placeholder/reference
   controls and a clean independent unit; a benign first candidate must not hide later material, and repeated calls
   must not inherit regex state. Keep the serialization-only screen probe independently load-bearing: decoded Bearer
   rejection does not prove the final-envelope screen.
8. **Bearer literals follow scheme-value rules with one documentation exemption (#5144).** Dotted or mixed-case
   alphabetic material is not a member access or identifier, including in raw finding/stance descriptions and before
   explanatory words; actual interpolation/concatenation remains a reference. Explicit placeholders remain controls:
   an uppercase name ending `_PLACEHOLDER` is treated as documentation (real material using that marker is an
   accepted residual); other underscore-bearing values get no name exemption, and generic secret-assignment reference
   rules stay separate. Only the case-sensitive descriptor `credential-shaped` between surrounding ordinary words gets
   a prose exemption; the descriptor alone, quoted as a scheme or in an Authorization header refuses, and arbitrary
   lowercase hyphenated values stay literals between ordinary words. Restoring the broad alphabet-and-context
   exemption (which admitted runtime-composed opaque material through the stance builder and SDK delegate) must fail
   the source, finding, complete-envelope and stance refusal cases. Actual credential material equal to the explicit
   descriptor in that prose context remains an accepted documentation-marker residual, like the explicit
   placeholder marker above; this is not semantic prose classification or sanitization of arbitrary source. Pair
   the exact descriptive sentence with a valid matching-cache read and zero provider or fetch calls; keep
   dotted/alphabetic literals with trailing words as refusal controls.
9. **Explicit Authorization headers use RFC 6750's one-character minimum.** Include a quoted header key paired with
   its value and the escaped representation inside serialized JSON; do not borrow the generic assignment screen's
   16-character floor. Probe one-, fifteen- and sixteen-character literals and the public RFC example in complete
   request leaves and keys and through source, finding and stance callers. An actual header object must refuse when
   neither its key nor its short value triggers the screen alone, since the final envelope carries their pairing.
   Unqualified short scheme text keeps the opaque-value floor, and header context cannot take the descriptor prose
   exemption. Reverting only the explicit-header handling must fail these cases; the screen does not claim universal
   credential detection.
10. **Every literal header binding form pairs key and value (#5156, three review rounds before merge).** The
    explicit-header branch first recognized only colon syntax (head `3f9217af2a`): a short literal in
    `headers.set`/`headers.append`, a source assignment or a two-element header tuple fell to the generic floor. Then
    (head `00db723361`) literal bracket assignments, computed literal object keys and leading whitespace inside quoted
    values still admitted short values. Then (head `1b4a063245`) terminated comments between literal setter arguments
    broke pairing and an Authorization record/tuple with a one-level array value admitted short material. Keep one
    bounded matrix across literal direct/object/assignment, setter/append, tuple and bracket/computed forms;
    single/double/backtick delimiters; raw and JSON-escaped space and tab (the tab escapes the final envelope
    produces); raw and JSON-serialized block/line comments between arguments; actual record/tuple arrays with every
    quoted candidate in placeholder-first and opaque-first order; one- and fifteen-character values. Actual
    object/tuple pairing refuses when short individual leaves pass, before both a valid would-hit cache and a cache
    miss reaching the installed SDK delegate, through both stance fields and scan/verify callers, with exact
    prepared/SDK wire bytes retained. Pair every form with placeholder, interpolation, concatenation, empty-value,
    unrelated-header-name, unpaired-prose, benign-only-array and unqualified short Bearer controls, and keep the
    generic sixteen-character floor. A screen-only reproduction proves recognition, not caller or cache/provider
    effects. Recognition stays lexical (colon, equals, quoted comma, literal brackets, JSON tab escapes, terminated
    comments, closed one-level arrays): runtime key expressions, concatenated values, nested arrays and arbitrary
    encodings are not evaluated.
