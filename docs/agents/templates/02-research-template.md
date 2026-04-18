# <Topic>

> **Note:** Research files can be authored by developers or agents. This template exists for capturing external technical findings to inform implementation. Agents are empowered to produce research when they need to validate assumptions or explore new APIs/approaches.

---

## Research question

What specific question this research answers. What decision or implementation it is meant to inform.
Be concrete: "Which Web Audio API scheduling approach minimises jitter at 10ms lookahead?" not "how does Web Audio work".

---

## Sources

All sources consulted. Every significant factual claim in Findings must trace to one of these.

- **[S1]** Author(s). _Title_. Venue/Publisher, Year. URL if available.
- **[S2]** Library/product name. Documentation section. URL.
- **[S3]** ...

---

## Key findings

Substantive technical content. Organised by sub-topic if the research covers multiple areas.
Include code where it clarifies understanding.

### <Sub-topic 1>

Findings. Source references inline as [S1], [S2], etc.

```rust
// Code example if relevant
```

### <Sub-topic 2>

Findings.

---

## Relevant patterns and snippets

Concrete examples — API usage, algorithm implementations, configuration patterns — that are
directly applicable to this repo's problem. These are the parts an implementer will reference.

---

## Comparison / tradeoffs

Where multiple options, algorithms, or libraries exist, compare them explicitly.

|             | Option A | Option B | Option C |
| ----------- | -------- | -------- | -------- |
| Criterion 1 |          |          |          |
| Criterion 2 |          |          |          |
| Criterion 3 |          |          |          |

---

## Applicability to this repo

How these findings apply given this repo's specific constraints (Web Audio, Tauri, real-time
audio thread, React 19, domain-driven architecture). Call out anything that applies differently
here than in the general case.

---

## Risks and uncertainties

What this research did not resolve. Where findings may not transfer directly. What assumptions
are being made. What would need to change if those assumptions are wrong.

---

## Recommendation

What to use or do, and why. Specific enough to act on.

If no clear recommendation is possible, explain why and what additional information is needed.
