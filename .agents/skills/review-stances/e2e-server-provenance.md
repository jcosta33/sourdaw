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
