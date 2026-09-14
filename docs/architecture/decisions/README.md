# Architecture decision records — closed archive

This directory is a **closed historical archive**: the LLM command-surface
decision series (`0012` through `0037`), recorded between 2026-07-27 and
2026-08-15 and kept as written. No new decision is filed here.

**The canonical, live ADR ledger is [`/agents/decisions/`](../../../.agents/decisions/).**
New decisions go there and only there. Resolve every bare "ADR NNNN" reference
in the repository against that ledger, not against this archive.

## Numbering collision

Both ledgers issue `NNNN-short-title.md` numbers independently, so every number
in this archive also names a **different** decision in the canonical ledger.
For example, `0029` here is the LLM MIDI note-transform command surface, while
`0029` there fixes the Electron desktop shell. A bare number is therefore
ambiguous by construction:

- "ADR NNNN" in repository prose means the canonical ledger's ADR.
- Cite a file in this archive by path, never by number alone.

## Desktop-shell references

`0035`, `0036`, and `0037` were written while the desktop shell was Tauri. The
Tauri shell has since been removed in favour of Electron over the
shell-agnostic native crate — canonical
[ADR 0029](../../../.agents/decisions/0029-electron-desktop-shell.md), landed by
PR #2181. Each of the three files carries a dated amendment mapping its
Tauri statements to the current arrangement; the record of what was decided at
the time is otherwise untouched.
