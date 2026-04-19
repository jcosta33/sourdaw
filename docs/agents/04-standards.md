# Standards

Writing and execution standards for all agents working in this repo.

This file is about **documentation** (specs, audits, tasks, research). Rules for **TypeScript and implementation code** (sound typing, tests, assertions) are canonical in **`AGENTS.md`** (repo root) and summarized for humans in **`docs/07-conventions.md`**.

---

## Clarity

Documents must be written for the reader, not the writer.

- Write in plain declarative statements. Avoid hedge words like "might", "could", "seems to", "probably" unless genuinely uncertain — in which case say explicitly that you are uncertain.
- Do not bury the important finding at the end of a long paragraph. State it first, then explain.
- Prefer specific over general. "The `AudioEngine` module allocates on the audio thread in `scheduleClip.ts:48`" is useful. "There may be allocation issues" is not.
- Use code references. When making a claim about the codebase, cite the file and line number.

---

## No false certainty

Do not state assumptions as facts. If uncertain:

- Say so explicitly: "This is an assumption — not yet confirmed"
- Record it in `## Assumptions`
- Do not implement on top of an unverified assumption without flagging it

## Capturing unknowns

Record unknowns. Do not assume they are obvious.

- Specs and Research: `## Open questions`
- Tasks: `## Blockers` and `## Assumptions`

A blocker prevents correct or confident implementation (e.g., pending design decisions, unconfirmed APIs). Record blockers immediately; do not work around them silently.

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

A handoff is a transfer of context between sessions. Its purpose is to make the next session productive immediately, without reconstructing context from scratch. Task files do **not** use a dedicated `## Handoff` section — put this information in **Decisions**, **Findings**, **Next steps**, and **`## Self-review`** so each task file is self-contained.

Useful closure answers these questions:

- What work is actually complete (not what was planned — what was done and verified)?
- What is explicitly not done, and why?
- What should the next session watch out for — fragile areas, known gaps, surprising behaviour?
- Which durable documents (audits, specs, research) were created or updated?

A summary that only lists files changed is not useful. Record decisions made, assumptions confirmed or invalidated, and specific next steps in the sections above.

---

## Task focus vs opportunistic fixes

Each session has a **primary deliverable** (the Objective or the human’s ask). That is what you must complete.

If you discover a real problem or a clear improvement while doing that work — including outside the path you first expected — you **may** address it. Prefer documenting meaningful extra changes in the task file’s **Findings** or **Decisions** (what changed and why) so the branch stays reviewable. Large or risky tangents still deserve an explicit note or a separate follow-up; the point is not to treat “scope” as a reason to ignore obvious issues.

If you cannot safely take something on, record it in **Findings** / **Next steps** (or the spec’s **Open questions**) instead of losing it.
