---
type: spec
id: SPEC-scala-tuning-formats
title: Scala tuning formats (.scl / .kbm / .ascl)
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Scala tuning formats (.scl / .kbm / .ascl)

## Intent

Read and write the Scala family — `.scl` scales, `.kbm` keyboard mappings, and Ableton
`.ascl` supersets — into the microtuning types, covering the full grammar (ratios and
cents, octave and non-octave periods, `x` unmapped keys, named degrees) and producing a
structured parse error (never a panic) on malformed input.

## Non-goals

- The tuning table and math the parser feeds (see `microtuning-engine`).
- MTS-ESP plugin retuning (see `mts-esp-host`).
- The microtonal piano roll that renders named degrees (see `microtonal-piano-roll`).

## Requirements

### AC-001 — Full .scl grammar

Parsing must handle `!` comments, description/count lines, ratio tones (incl. bare integer
= `/1`), cents tones (period-containing), implicit `1/1` degree 0, and the final period;
50 curated fixtures load with zero errors and frequencies within 1e-9 Hz of a reference CSV.

Verify with: `pnpm cargo:test -- -p daw-io scala_scl_fixture_conformance`

### AC-002 — .kbm mapping

The seven `.kbm` header values plus the cyclic mapping table (`x` = unmapped) must parse
and round-trip exactly, including `x` positions.

Verify with: `pnpm cargo:test -- -p daw-io kbm_roundtrip`

### AC-003 — .ascl round-trip with Live 12

An `.ascl` from Ableton Live 12's bundled set must round-trip through save/load with
identical named-degree metadata and reference pitch.

Verify with: `pnpm cargo:test -- -p daw-io ascl_live12_roundtrip`

### AC-004 — Write round-trips

Writing `.scl` must reproduce a byte-identical file for ratio-form tunings and a
frequency-equivalent (1e-12) file for cents-form tunings.

Verify with: `pnpm cargo:test -- -p daw-io scl_write_roundtrip`

### AC-005 — Malformed input never panics

A missing count line, non-numeric ratio, or out-of-range reference note must yield a
`TuningParseError` naming the line; when explicitly requested, a focused `pnpm cargo:fuzz -- <target>` run lasts ≥5 minutes without a
panic.

Verify with: `pnpm cargo:test -- -p daw-io scala_parse_errors`

## Open questions

- [ ] (non-blocking) Use the `tune` crate vs a first-party parser. Default: `tune` if it
  covers `.ascl`, else first-party.

## Affected areas

- `crates/daw-io/` (Scala parsers/writers), focused fuzz target
- `docs/architecture/traces/scala-fixture/`

## Dropped from sources

- None — scopes §10.5 directly.
