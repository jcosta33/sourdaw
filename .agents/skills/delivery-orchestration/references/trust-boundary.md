# Launcher trust boundary

Trusted GitHub-write commands execute code pinned to GitHub's `main`, never lane files. The commands
that must run through the protected primary checkout's package route are listed once, in the
[protected primary package route](../SKILL.md#protected-primary-package-route). The author-token
commands `branch:prune` and `release:cut` are among them. Each role loads only its own credential.
Lanes predating the launcher or trailing `main` can publish and deliver without first merging.

## Pinning the commit

The launcher imports only Node builtins, so no repository module is evaluated before its check.
It pins the commit GitHub reports for `main`, read with `git ls-remote` over the explicit public HTTPS
URL. It never reads the local `refs/remotes/origin/main` or the `origin` remote, which any lane can
rewrite. Its `ls-remote` and fetch ignore global and system Git config. Their `-c` overrides beat
repository config for hooks, fsmonitor, TLS verification, proxy, credential helper and askpass. A
repository `insteadOf` that rewrites that URL refuses, because no override can undo it. Any URL-scoped
`http.<url>.*` setting refuses for the same reason. Every failure refuses; there is no offline mode.

## Running the snapshot

The launcher compares its own file with its blob at the pinned commit and refuses on any difference.
It then executes the command's module closure read from that commit, in a temporary snapshot. The only
module resolved outside the snapshot is the `yaml` package, which `deliver` loads lazily from the
primary checkout's `node_modules`. That package is not verified. Executables resolve only from
absolute `PATH` entries; an empty or relative entry is skipped.

## Lane tools without a credential

`lane:open` and `lane:identity` hold no GitHub credential and run outside the launcher. Each refuses
unless its whole relative-import closure matches `origin/main`. A file with no blob there refuses as
unverifiable. Their reference is the local tracking ref, not the commit GitHub reports. The check runs
after the module graph is evaluated, so it guards behaviour, not import-time side effects.

## Child environments

This isolates lane-controlled files, not operator-running code. The pre-launcher operator environment
is trusted, and same-account processes can read credentials. Snapshot and token-bearing children
discard redirecting overrides: Node loaders and preloads, and Git, GitHub CLI, GitHub Actions, and App
configuration, matched without regard to case. They use the launcher-resolved `git` and `gh`.
Token-bearing Git children ignore repository hooks and fsmonitor, so a program planted in the shared
repository config never runs beside a token. Every Git-read environment ignores replace refs. The
orchestrator User role discards inherited GitHub, Git, and Node overrides the same way during
credential lookup and isolated execution.
