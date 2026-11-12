# Launcher trust boundary

Trusted GitHub-write commands execute code pinned to GitHub's `main`, never lane files. The commands
that must run through the protected primary checkout's package route are listed once, in the
[protected primary package route](../SKILL.md#protected-primary-package-route). The author-token
commands `branch:prune` and `release:cut` are among them. Each role loads only its own credential.
Lanes predating the launcher or trailing `main` can publish and deliver without first merging.

## Pinning the commit

The launcher imports only Node builtins, so no repository module is evaluated before its check.
It pins the commit GitHub reports for `main`, read with `git ls-remote` over the explicit public HTTPS
URL. It never pins the local `refs/remotes/origin/main` or the `origin` remote, which any lane can
rewrite. Its `ls-remote` and fetch never read the shared repository's config, because any lane can
plant transport keys there. They run in a fresh bare repository the launcher creates and removes,
with global and system config ignored, so the only config read is the one the launcher writes. That
repository shares the primary's object store, so the fetched objects land where later reads find them.
Git does not re-hash a stored object on read, so a lane can plant forged bytes under a real id. The
launcher therefore hashes every commit, tree and blob it reads for the pinned commit and refuses a
mismatch. It verifies only sha1 repositories. The primary's
tracking ref seeds the fetch only as a negotiation hint, never as the pin. After verification the
launcher sets the tracking ref to the pinned commit. Every failure refuses; there is no offline mode.

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
Token-bearing Git children override fixed-name repository config: the hook directory, fsmonitor,
askpass, commit and push signing, and the alternate-refs command fetch negotiation runs for a planted
`objects/info/alternates` store. Environment-supplied config outranks repository config for the same
key, so those programs never run beside a token. Config-defined hooks (`hook.<name>.event` with
`hook.<name>.command`) ignore `core.hooksPath` and take a lane-chosen name, so a token-bearing Git
child refuses to start while its repository config defines any `hook.*` key. A child is
token-bearing when `GH_TOKEN` is in its environment or its arguments install a credential helper. Transports are an allowlist of `https` and `file`;
`ext::`, `ssh`, and `git` are each refused by their own override, because a repository-level
per-protocol key outranks the general one. Refusing `git` is what stops `core.gitProxy`, which no
environment value can override. The list is not complete. Keys whose names the lane chooses still
run for token-bearing Git commands working in a lane or the primary: `.gitattributes` filters, merge
and diff drivers, and custom `name::` remote helpers. Network settings that run no program still
apply: URL-scoped and plain `http.*` keys such as `http.curloptResolve`, `http.sslCAInfo`, and
`http.proxy` can redirect a token-bearing request. Any further fixed-name key the list omits is also
a residual, tracked in #6448. Keeping the token secret from same-account processes is outside this
boundary. Every Git-read environment
ignores replace refs. The
orchestrator User role discards inherited GitHub, Git, and Node overrides the same way during
credential lookup and isolated execution.
