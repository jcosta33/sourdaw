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
