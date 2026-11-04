# Launcher trust boundary

## Launcher trust boundary

Run `lane:publish`, `deliver`, `pr:supersede`, `pr:retire`, `issue:claim`, and `issue:reconcile` through the
protected primary checkout's package route; `review:accept` remains only for
legacy pre-policy heads. This
is the snapshot-backed write trust boundary: launcher and whole script closure
must match one pinned `origin/main` commit and come only from the primary
repository. Lane files are data, never executable delivery code. Lanes
predating the launcher or trailing `main` can publish and deliver without
first merging.

This isolates lane-controlled files, not operator-running code. The pre-launcher
operator environment is trusted; same-account processes can read credentials.
Snapshot and token-bearing children discard redirecting overrides (Node
loaders/preloads; Git, GitHub CLI, GitHub Actions, and App configuration) and
use launcher-resolved `git` and `gh`. During credential lookup and isolated
execution for the orchestrator User role, discard inherited GitHub, Git, and
Node overrides the same way.
