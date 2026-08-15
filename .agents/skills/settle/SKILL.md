---
name: settle
description: >-
    Resolve technical and procedural uncertainty without handing engineering work to the user.
    ALWAYS apply when a technical choice survives direct inspection, is costly to reverse, has
    conflicting evidence, or is about to be escalated. Skip unresolved product-owner intent between
    supported product or business outcomes.
---

# Settle

Technical uncertainty belongs to the team lead. A delegated team member investigates, never contacts
the user or owns the final decision, and returns evidence with a recommendation.

## Method

1. State the decision, constraints, and evidence that would settle it.
2. Inspect the live code, tests, repository decisions, and existing precedent.
3. Close remaining gaps with primary sources, standards, established DAW behavior, and the smallest
   decisive experiment.
4. If the choice is costly to reverse or remains unresolved after conflicting evidence, launch exactly
   three fresh advisers concurrently. Give each the same question and frozen evidence, hide peer work,
   state its team-member boundary, and assign distinct scrutiny: repository fit, external authority,
   and failure risk.
5. Verify every material claim. Reject unsupported opinion. The lead chooses and proceeds; a delegated
   adviser returns its evidence and recommendation.

The advisers advise. They do not vote, negotiate, question the user, or own the decision. The lead
judges their evidence.

Escalate only when evidence leaves unresolved product-owner intent between supported product or
business outcomes. Explain the product or business consequence, present clear options, and recommend
one. Engineering effort, schedule, patch breadth, delivery mechanics, and technical risk never qualify.
