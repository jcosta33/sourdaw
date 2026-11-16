---
type: adr
id: 0061
title: Plugin folders are granted by a native folder pick
status: accepted
date: 2026-11-15
owner: The Sourdaw team (owner approved a native folder-picker grant, 2026-11-15)
sources:
    - crates/sourdaw-native/src/host/plugin_folder_grants.rs
    - crates/sourdaw-native/src/host/plugin_scan_policy.rs
    - crates/sourdaw-native/src/commands/plugin_folders.rs
    - docs/architecture/04-plugin-hosting-security.md
---

# 0061 — Plugin folders are granted by a native folder pick

## Context

ADR 0004 made plugin scan roots native-owned: the platform's default folders may be scanned, and a
custom folder needs a native or user grant, never a raw renderer path. It left open which grant
mechanism the product exposes and how a grant is revoked. Until now the scan policy had one
production constructor, the platform defaults, so a musician whose plugins live elsewhere could not
scan them at all.

## Decision

This resolves ADR 0004's first open question (the custom-root grant mechanism) and its revocation
question.

1. **A custom plugin folder is granted only by a native folder pick.** The desktop shell's main
   process opens the folder dialog and passes the path it returns straight to the addon's grant
   command. That command is denied to the renderer; a path a renderer sends without a matching
   grant stays refused.
2. **Grants live in the private native state directory**, which no file command reaches and no
   project or collaborator writes. The store is schema-versioned, bounded in size and count, and
   written by atomic replace.
3. **The store is not authority by itself.** Every policy construction reads it fresh and re-runs the
   pick's validation on each grant, which must still resolve to exactly the path that was granted. A
   grant that fails is excluded and reported unavailable with its reason; it is not deleted, so a
   reconnected drive works again.
4. **A pick may not overlap what the scan must never reach**: a filesystem root, the home folder or
   an ancestor of it, a default plugin folder, storage the renderer writes without a pick, or a path
   the renderer holds a read-write file grant on, whichever pick came first. Grants
   stay disjoint from one another.
5. **Granted folders rank after every default folder**, in grant order, and never take the
   symlink exception reserved for the platform's own folders.
6. **Revocation removes the stored grant.** The next policy built refuses the folder and every plugin
   under it. Revocation only narrows authority, so the renderer may request it.
7. **`CLAP_PATH` is still not read.** The user can pick a `CLAP_PATH` folder in the dialog like any
   other, which makes it a grant they can see and revoke.

Exactly one production constructor widens the scan policy past the platform defaults, and it reads
only this store.

## Alternatives considered

| Alternative                               | Why rejected                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A settings preference the renderer writes | The renderer would grant itself the authority to have the scan execute native code from any folder.                       |
| A signed policy file                      | No signer exists for a personal machine, and it gives the musician no way to add a folder.                                |
| Honour `CLAP_PATH` as grants              | Set by whatever launched the process, with no record the user can see or revoke.                                          |
| Cache grants in process                   | The scan runs in a separate utility process with its own addon instance and must see a grant the main process just wrote. |

## Consequences

- Positive: plugins outside the default folders can be scanned and loaded, under a grant the user
  made and can revoke.
- Negative: some folders a user might expect to pick, such as one containing the app's own project
  folder, are refused with a stated reason.
- Neutral: `get_default_plugin_paths` still reports the platform defaults alone; granted folders are
  listed by their own command.
