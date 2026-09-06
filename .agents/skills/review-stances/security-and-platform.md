# Review stance: security and platform boundaries

Dispatch guidance for the stance that attacks native authority, renderer trust, platform
capabilities, IPC exposure, filesystem access, secrets, or operating-system integration. Per the
Review section of `AGENTS.md`, an escape — a defect that reached `main` which this stance should
have caught — is recorded here as a lesson, and every future dispatch of this stance carries this
file's lessons. Lessons state the escape, the blind spot, and the probe that would have caught it.
Keep each lesson short enough to paste into a dispatch.

## Standing probes

- Enumerate every implicit authority root from the live implementation. For each one, prove why the
  application owns the whole root rather than an app-specific child.
- Put a synthetic ungranted sibling one component outside every claimed owned child and exercise
  each exposed access mode. Require refusal for the sibling, then require owned-child and explicit-
  grant positive controls to succeed.
- Trace internal native scratch producers separately from renderer-reachable file commands. An
  internal consumer of a broad platform directory does not grant the renderer authority over it.
- Follow canonical paths through existing symlinks and missing tails before evaluating a root or
  grant. Check component boundaries and platform spelling behavior rather than string prefixes.

## Lessons from escapes

### 2026-09-05 — the OS temporary directory was called app-owned (introduced via PR #2; retained by PR #3404; fixed by #3642)

PR #2 introduced `std::env::temp_dir()` as an implicit built-in root in commit
`eaf9b0687a322f4adb9633f3e45c914b9d0d5e5f`. PR #3404 later narrowed user-directory authority but
retained that root even though the same module defined `sourdaw_ipc` as Sourdaw's app-owned child.
Its review attacked grant and private-directory spellings but never proved ownership of every
built-in root, so an authorized renderer could read, list and write unrelated same-user temporary
files.

Blind spot: the root list's description was accepted as ownership evidence. No test placed an
ungranted sibling outside the app-owned child while remaining inside the broader OS temporary
directory.

Probe that would have caught it: enumerate every implicit root, create a synthetic ungranted
sibling one component outside each owned child, and drive every exposed read, list and write route.
Require the sibling to be refused without mutation while the owned child and an explicit recursive
grant remain positive controls.
