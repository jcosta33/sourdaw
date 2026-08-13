---
type: adr
id: 0022
title: 'Describe mechanisms, not resemblance: no comparative realism claims'
status: accepted
date: 2026-08-12
owner: The Sourdaw team
sources:
  - .agents/artifacts/sourdaw/CHANGE-grand-boule-spec-closure.md
  - .agents/artifacts/sourdaw/CHANGE-toaster-flagship-drum-workstation.md
---

# 0022 — Describe mechanisms, not resemblance: no comparative realism claims

**Accepted 2026-08-12.** Resolved from primary sources under the owner's standing direction that decision gates are research tasks. Resolves `CHANGE-grand-boule-spec-closure` DG-001 and
`CHANGE-toaster-flagship-drum-workstation` DG-004.

## Context

Two device campaigns are blocked on the same question in different clothes. Grand Boule asks what
reference corpus and listening method substantiate a realism claim against a real piano. Toaster asks
what corpus substantiates its circuit-voice claims — a 909 snare, LinnDrum/CEM voices, CR-78,
SP-1200, µ-law.

Both are gated as *critical*, and both have been read as "we need to run a listening test." The
research says otherwise, and for a reason that is technical rather than budgetary.

## MUSHRA disqualifies itself for this comparison

ITU-R BS.1534-3 is the obvious instrument — the well-known listening-test protocol. Its own §2 rules
it out here:

> If MUSHRA is used with appropriate content, it is ideal that listener scores should range between
> 20-80 MUSHRA points. **If scores for the majority of test conditions fall in the range of 80-100 it
> may be true that the results of the test are invalid.**

A good physically-modelled piano compared against a real piano lands in exactly the 80–100 band. The
test would produce numbers the standard tells us not to trust.

The same document points at the alternative — *considering* c) notes that BS.1116 "is intended for
the assessment of small impairments," which is precisely this comparison. But BS.1116 is a
double-blind protocol requiring experienced critical listeners and a licensed reference corpus. That
is a research programme, not a feature.

## What the category leader actually claims

Modartt's Pianoteq — the strongest shipping modelled piano — makes **no comparative claim at all**.
Its manual describes the mechanism: *"Notes are really played ('constructed' in real-time, as on a
real piano), not just read from the disk or the memory."* That is a statement about how it works, not
about what it resembles, and it is unfalsifiable in the good sense: it is simply true of the
implementation.

## Decision

**Drop comparative realism claims from both devices' acceptance criteria. Describe modelled
mechanisms and measurable properties instead.**

For Grand Boule: keep the mechanism tests that already exist (`soundboard.rs` impulse-response decay,
modal string partials, coupled unisons, sympathetic resonance) and keep a self-generated reference
corpus purely as a **regression baseline**, so audio changes stay detectable.

For Toaster: the engines stay exactly as they are — `bridged_t.rs`, `sp1200.rs`, `mu_law.rs`,
`adaa.rs`, `lofi.rs`, `tolerance.rs` are real DSP. **Drop the circuit brand names from shipped engine
identifiers** and present them as original designs. Nothing in the audio changes; only the claim does.

## Why this is the cheap answer as well as the correct one

The expensive thing was never the DSP — it was the claim. Option "run BS.1116 against a licensed
corpus" costs corpus licensing, listener recruitment and a conforming harness, for a built-in device.
Option "run MUSHRA" produces evidence the standard says may be invalid. Option "keep the labels
without proof" ships claims nothing supports, which is the exact outcome both gates exist to prevent.

Dropping the claim unblocks Grand Boule Wave 1/Wave 3 and Toaster Wave 7 immediately, and it does not
wait on a licensing negotiation that may never conclude.

## A hard constraint on the Toaster side

I could find **no primary source establishing that any officially licensed, redistributable
TR-808 / TR-909 / LinnDrum / SP-1200 corpus exists.** Roland Cloud's terms were not locatable.

**Treat the absence of a permissive licence as prohibition** until counsel says otherwise. Do not
acquire or ship reference material for these machines on the assumption that "everyone does it."

## Consequences

Grand Boule's acceptance criteria lose "competitive realism" and gain measurable mechanism
properties. Toaster's lose the named-circuit conformance criteria.

Both keep regression corpora, so a change that alters the audio is still caught — which is the
property that actually protects users, as distinct from a claim that impresses them.

## Sources

- ITU-R BS.1534-3 (10/2015) §2 and *considering* c): https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1534-3-201510-I!!PDF-E.pdf
- Modartt Pianoteq user manual: https://www.modartt.com/user_manual?product=pianoteq&lang=en

**Unverified:** whether ITU-R BS.1387 (PEAQ) could serve as an objective substitute. PEAQ is designed
for codec impairment against an aligned reference, which a synthesised note is not, so it is very
likely inapplicable — but this was not confirmed from the standard's own text.
