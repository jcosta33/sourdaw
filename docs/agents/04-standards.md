# Standards

Writing and execution standards for all agents working in this repo.

---

## Clarity

Documents must be written for the reader, not the writer.

- Write in plain declarative statements. Avoid hedge words like "might", "could", "seems to", "probably" unless genuinely uncertain — in which case say explicitly that you are uncertain.
- Do not bury the important finding at the end of a long paragraph. State it first, then explain.
- Prefer specific over general. "The `AudioEngine` module allocates on the audio thread in `scheduleClip.ts:48`" is useful. "There may be allocation issues" is not.
- Use code references. When making a claim about the codebase, cite the file and line number.

---

## No false certainty

Do not state things you are not sure about as if they are facts.

If you are uncertain:

- Say so explicitly: "This is an assumption — not yet confirmed"
- Record it in `## Assumptions` in the task file
- Do not implement on top of an unverified assumption without flagging it

This rule exists because wrong assumptions that look like facts are harder to catch than flagged uncertainty. A clearly marked assumption can be verified. A buried guess causes bugs.

---

## Capturing unknowns

Every document type has a place for unknowns. Use it.

- Specs have `## Open questions`
- Research files have `## Open questions`
- Task files have `## Blockers` and `## Assumptions`

Unknown things that are not recorded do not exist for the next session. Record them even if you think they are obvious.

A blocker is anything that prevents correct or confident implementation:

- a design decision that was not made
- an API behavior that was not confirmed
- a performance constraint that was not measured
- a dependency on another module's change that has not landed

Record blockers immediately. Do not work around them silently.

---

## Citations in research files

Every significant factual claim in a research file must trace back to a source.

Acceptable sources:

- published papers (cite author, title, venue, year)
- official documentation (cite the doc URL and section)
- library source code (cite repo, file, and commit or version)
- real product behavior you have verified (describe how you verified it)
- standards documents (cite the spec and section number)

Not acceptable as citation:

- vague attribution ("according to common practice")
- circular reference to this codebase
- unverified memory

When you are not sure if something is true, say so. "This is the behavior documented in THAT Corporation datasheet §3.2" is useful. "This is how VCA compressors work" is not.

---

## Acceptance criteria

Acceptance criteria in specs must be verifiable — meaning a person or automated test can determine true or false for each item.

**Bad:**

- "The compressor sounds good"
- "The UI is responsive"
- "Performance is acceptable"

**Good:**

- "The gain computer produces ≤ 0.1 dB error at all threshold values compared to the reference formula from Giannoulis et al. (2012)"
- "The fader cap renders at correct position across 0 dB, -6 dB, and -∞ dB in Chromium and WebKit"
- "`pnpm deps:validate` passes with zero violations after the migration"

If you cannot write a verifiable criterion, the requirement is not well-defined enough to implement. Stop and clarify before proceeding.

---

## Tradeoffs and risks

When a significant design decision is made, record what was considered and why the other options were not chosen.

Do not record tradeoffs for trivial decisions. Do record them when:

- the choice has real performance, correctness, or maintainability consequences
- the choice will be hard or expensive to reverse
- a reviewer might reasonably ask "why didn't you do X instead?"

This is not defensive documentation. It is efficient communication — recording reasoning once prevents relitigating the same decision across multiple sessions.

---

## Updating existing documents

Documents must reflect the current state of reality, not the state at the time they were written.

If an audit was written two months ago and the codebase has changed, update the audit.
If a spec was written before implementation and the implementation diverged, update the spec.
If a research file's recommendation turned out to be wrong, update it with what was found.

A document that is wrong is worse than no document. It sends the next agent in the wrong direction.

---

## Findings vs assumptions

These are different things and must not be conflated.

**A finding** is an observation about the codebase that is verifiable by reading the code: "The `AudioEngine` module allocates a `Vec` on the audio thread in `scheduleClip.ts:48`." It is true regardless of who reads it.

**An assumption** is something believed to be true but not yet confirmed: "I assume the `Scheduler` processes clips in order of their start position." It may drive design decisions but has not been verified.

When writing audits, findings go in `## Findings` and `## Open issues`. When writing task files, unverified beliefs go in `## Assumptions` with a `[pending]` tag. Mixing them — presenting assumptions as findings, or failing to note that a finding is actually an assumption — is one of the most common sources of incorrect implementation.

---

## Handoffs

A handoff is a transfer of context between sessions. Its purpose is to make the next session productive immediately, without reconstructing context from scratch.

A useful handoff answers these questions:

- What work is actually complete (not what was planned — what was done and verified)?
- What is explicitly not done, and why?
- What should the next session watch out for — fragile areas, known gaps, surprising behaviour?
- Which durable documents (audits, specs, research) were created or updated?

A handoff that only lists files changed is not useful. A handoff that lists decisions made, assumptions confirmed or invalidated, and specific next steps is.

---

## Scope discipline

Work only what is assigned. If you discover related work that needs doing, record it — in the audit, the spec's open questions, or the task's handoff — but do not start it.

This is not about following rules. It is about the fact that unplanned work in a worktree produces changes that were not specced, not reviewed, and cannot be attributed to the task. The worktree's branch will contain unexpected changes. The audit will not cover them. The spec will not include them.

If the discovered work is urgent, surface it explicitly: write up what was found and why it matters. Let the person running the session decide whether to reprioritise.
