# ADR 0023: LLM clip editing

**Status:** Accepted

## Context

The provider-neutral executable command surface can control tracks, devices, sends, routing, tempo, and meter, but it does not expose clips in provider context or admit clip tools. Eight existing clip actions already execute through registered AppAction handlers with explicit inverses: ordinary and next-bar duplication, deletion, rename, start/end trim, nudge, and gain. Other clip actions still have inert undo entries, external work, or unresolved multi-target semantics and are not ready for provider execution.

## Decision

- Admit `duplicateClip`, `duplicateClipToNextBar`, `removeClip`, `renameClip`, `trimClipStart`, `trimClipEnd`, `nudgeClip`, and `setClipGain` through the executable action registry.
- Ground one clip by literal ID, unique exact name, one explicit selected clip, or a unique exact clip name qualified by its track; duplicate names without disambiguation fail closed.
- Expose selected clip identity and bounded clip metadata in provider project context, but continue treating that context as untrusted data rather than instructions.
- Require exact payload keys, safe names, finite explicit numeric values, non-negative non-empty trim ranges, non-zero non-underflowing nudges, and gain from zero through two; explicit percentages convert to ratios, while absolute values remain absolute and are rejected instead of clamped.
- Treat clip deletion as destructive-reversible and always require fresh explicit confirmation; deletion language must name a clip or explicitly identify the selected clip and cannot be inferred from another entity-removal request.
- Use existing handler-minted duplicate IDs and explicit inverses for compensation and undo. Ripple deletion records and reverses each collateral automation delta. Reject overlapping or coupled same-clip writes within one provider batch, removal combined with any other command on that clip, and removal combined with another clip command on the same track because ripple mode can move collateral clips.
- Show the resolved clip name in deletion confirmation and execution receipts.
- Defer clip movement and every clip action without an explicit inverse or safe single-target contract.

## Consequences

Hosted providers and WebLLM gain useful arrangement editing through the same strict grounding, revision-bound confirmation, atomic AppAction batch, Automerge receipt, and undo path. Ambiguous clips, locked edit targets, implicit numeric values, malformed ranges, and unsupported clip operations remain non-executable.
