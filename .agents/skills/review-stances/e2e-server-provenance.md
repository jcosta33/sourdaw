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
