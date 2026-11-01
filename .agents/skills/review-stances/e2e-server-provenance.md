# E2E server provenance

PR #5363 introduced the CI dev companion. The #5595 failure lacks the actual server's
post-readiness exit provenance; earlier local history, private review prompts and tiers, and the
original connection-loss cause remain unknown. Lifecycle diagnostics are preparation, not a fix
for the white boot.

Run a real child through the launcher and require its actual PID, checkout root, port, output, and
exit code or signal. Exercise requested cleanup and a failed spawn. Removing either the start or
exit lifecycle record must fail its corresponding subprocess assertion; a green test after either
mutation does not prove the record reaches the caller.

PR #5723 changed the E2E origin to literal IPv4 loopback so Vite's IPv4 listener remains reachable
when an IPv6 listener starts on the same port. The Grinder-only companion case added later by
PR #5437 retained `localhost` expectations for the same configured origins, so the named CI case
failed despite the correct server setup. The missed stance was post-integration host consistency
across every companion route. Keep the build and dev origins in that case equal to the configured
IPv4 origins, then temporarily make the origin factory return `localhost` and run the named Grinder
case: it must fail. Preserve project selection, ports, child command, output capture, and shutdown
assertions while correcting fixture expectations.

### 2026-10-30 — compiled persistence inspection must share the actual App build

The persisted acceptance added by #5812 used development-only module URLs even though its
contract is same-tab project hydration and replay. A compiled inspection entry must be an
e2e-only second input of the SAME index.html build, with live exports of all eight owning
namespaces. Preserve checkout identity and COOP/COEP on preview, and reject a split project
store through the unchanged acceptance oracle. Reuse the existing built shard; only a
selected local/nightly persistence fixture may build and own its temporary preview. Verify
its listener and output cleanup, and keep shipping builds free of the inspection entry.
Removing a source dependency changes the tested serving route; it does not identify the
physical actor behind prior source-graph cancellations.

### 2026-10-30 — a global HMR fence broke a required optimizer reload (#5874, pre-merge)

The DDSP cold-worker probe handles Vite's dependency reoptimization by awaiting a new document.
Applying `NO_HMR=1` to that profile filtered the optimizer's `full-reload` payload, so the
converter import received `504 Outdated Optimize Dep` without navigation. Trace the producer and
transport policy of every required reload, not only literal HMR consumers. Keep the cold-worker
profile's HMR enabled while ordinary immutable documents keep their disconnect fence; applying the
suppression to the cold-worker profile must fail that profile's case. A configuration-value
assertion cannot establish this policy.

## Rendered acceptance must come from the lane's own server (escaped via #4032)

Before treating rendered acceptance as evidence for a lane, verify that the served deciding source
and port belong to that lane. A reused shared dev server does not prove a lane's layout; isolate
the lane's server without stopping a foreign one. Probe by pointing the acceptance at a server
serving another checkout: the identity assertion must refuse it.
