# Standing probes: AI action bridge, prompt segmentation and request authority

Defects where an AI-originated request reaches project state with context, qualifiers, authority or protections
other than the user's original text granted. Split out of `correctness.md`; a stance matching this class carries this
file instead of it.
Each probe names the failure mode, the input, state or mutation to run, and the check that must go red.
Report the concrete break or none.

## Standing probes

1. **Context and cancellation at every dispatcher route.** Drive execution context through single and
   batch dispatch and both runtime and project handlers; prove cancellation and deferred-work attempts
   at a real consumer; dropping context on the single-action entrypoint alone must fail a case.
2. **Segmentation keeps each action's qualifiers.** Vary connectors and punctuation; each action keeps
   its own exclusions and reference ambiguity without borrowing adjacent action text; mutate literal-ID
   vs display-name evidence and Unicode-overlap evidence. An exact identifier must not erase genuine
   ambiguity and a clause boundary must not widen a destructive action or collapse competing targets.
3. **Deterministic admission consumes the whole request.** Test a complete exact command across the
   registry before complexity heuristics; reserved context references resolve before unquoted names; an
   unquoted multiword value is semantic unless a bounded grammar proves it literal. Feed fuzzy rank,
   partial text, context availability or first registry match and require a refusal.
4. **Source authority and protections come from the original text.** Masked text serves discovery and
   segmentation only; it never proves literal source syntax or target authority. Deterministic, direct
   and compiler-backed proposals derive authority from the same original text and the same complete
   selection set: a primary selection field does not prove the selection is unique, and
   compiler-resolved identities validate selector structure only. Parse quote boundaries once,
   offset-preserving, in-word apostrophes as content;
   reserved selection phrases apply outside quotes only; mask spans are immutable and a generated marker
   never becomes evidence. Resolve each list member independently, union protected candidates, treat an
   incomplete protection as rejection, enforce after final target resolution including compiler
   overrides. When a value can contain the connector, enumerate quote-aware source boundaries, ground
   each prefix completely (including a complete known owner qualifier; a contained name is
   insufficient) and admit one unique interpretation, never letting a provider target choose between
   competing boundaries. Where a grammar permits an optional connector, classify source and value from
   one quote-aware parse and keep semantic whitespace inside a protection reference without joining
   separate punctuation-bounded clauses.
5. **Protection owner, polarity and exceptions.** Probe a name shared by track and clip
   (`leave Bass Verse unchanged` must not freeze the track, `leave Bass fader unchanged` is control
   authority, #2811); later admission against a frozen whole owner's actual descendants, and
   independent `leave Bass alone` and structural or frozen roots kept as whole restrictions beside a
   separately protected clip, with a track and a clip or device sharing the exact name; a reserved phrase colliding with a display name, quoted compound owners,
   title-cased qualities, unclosed VCA quality; a fader exception permitting gain but refusing pan and
   rename; selection retained through pending-card refinement and compiled replacement; independent
   clauses and later protections restricting, never widening; a compatibility mask consuming the whole
   clause (#5339). Catalog candidates come from fully consumed resolved spans with unknown protected
   objects clarified (#4128); a required insertion anchor is checked before optional-field omission,
   with missing and wrong anchors writing nothing (#1650/#2811).
6. **Direct-level inventory is catalog-wide.** Enumerate every planner-emittable direct-level command
   and trace schema, prompt binding, strategy, handler, stored value, undo and full/delta context;
   test absolute and relative decibels, the owning ceiling, silence and legacy linear values at actual
   execution (#4366); VCA and metronome fell outside the first enumerated family list, so a passing
   sample of those families cannot prove the remaining catalog.
7. **Read-only planning keeps the captured content authority across saves (#1989, #5852, #6240).** Hold a
   paused decision and a selected preset's planner across a real save timestamp and active-arrangement copy;
   require the original revision and intent to survive. Require saved and unflushed fader edits, edit then
   revert, child-document changes and root replacement to refuse before handoff. Replacing the save-aware
   content comparison with raw heads must fail the save case; accepting only the final snapshot must fail
   the reverted edit. A storage-owner write authorization is not read-only content admission; execution
   still requires its own write authority.
8. **Whole-owner protections apply before measured-run inventory (#6311).** Feed the original
   request a whole-track preservation clause and require that owner to be absent from both the recipe
   inventory and every initial measurement. Keep a compatible fader-only or pan-only protection
   eligible for processing, keep clip ownership separate, and refuse an unresolved explicit owner.
   Retain the later grounding guards: a candidate-stage exclusion never replaces them. Probing only
   continuation does not establish exclusion before initial collection. Mutating the planner to consult
   only brief locks while ignoring the original request must fail the production brief-to-measured-run
   case.
9. **Project content effects reach protected clips without target arguments (#5888, #5971).** Drive
   plain and real compiler-backed tempo proposals beside a named clip protection, with an admitted
   unprotected control. Require a whole-batch protection refusal, including a mixed tempo-and-gain
   request, a tempo-only whole-track protection, retained refinement facts, inactive alternative
   identities and approval-time checks. Read unconditional scope and dimensions from Command; target
   arguments alone cannot describe the reach. Keep clip protection separate from its track's fader,
   preserve facet-only restrictions, and admit unrelated project-timing effects. Conditional metadata
   does not establish unconditional content reach; its execution-time policy still applies.
   Attacking source/history and seam behavior does not establish the original-request protection
   boundary for targetless writes. Removing project-effect expansion must fail
   `src/modules/AiRuntime/useCases/agentReference/__tests__/plainTempoClipProtection.spec.ts`.
10. **Control receipt admission precedes semantic authority (#4128).** A parser that advances
    interpretation after bounding its receipt, without checking whether bounding replaced success with
    failure, lets staged authority survive an unadmitted control; schema-valid selector arguments hide it.
    Promote authority only after the actual bounded success receipt passes every carrier and byte
    admission. A compacted carrier, a failed receipt, or an oversized raw control cannot substitute for
    that witness: discard unadmitted staged intent and keep effectful schemas and calls closed. Select an
    otherwise-valid control from the actual published catalog, then drive effectful use through the real
    parser and the correction route; require no continuation, escaped authority or proposal, and the
    correlated failure preserved. Keep genuine in-budget local and hosted controls that restore the full
    effectful contracts. Remove only the responsible discard or admission edge and require the
    `src/modules/AiRuntime/useCases/__tests__/metricIntent.spec.ts` case "does not let the actual %s carry
    failed control authority into a following proposal" to fail independently of manifest pins. That case,
    "retains a genuine in-budget control and projects only the %s receipt copy" and "publishes complete
    semantic intake and safe reads before restoring exact effectful contracts after success" are partial
    coverage: none asserts the compacted-carrier input, so add one.
