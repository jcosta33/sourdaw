# E2E server provenance

PR #5363 introduced the CI dev companion. The #5595 failure lacks the actual server's
post-readiness exit provenance; earlier local history, private review prompts and tiers, and the
original connection-loss cause remain unknown. Lifecycle diagnostics are preparation, not a fix
for the white boot.

Run a real child through the launcher and require its actual PID, checkout root, port, output, and
exit code or signal. Exercise requested cleanup and a failed spawn. Removing either the start or
exit lifecycle record must fail its corresponding subprocess assertion; a green test after either
mutation does not prove the record reaches the caller.

PR #5437's Grinder-only dev-companion case asserted `localhost`, while PR #5723 made
`e2eOrigin` return IPv4 loopback to match Vite's `127.0.0.1` listener. A hostname that can resolve
to a separate IPv6 listener is not the same serving origin. Keep the companion's `baseURL` and its
readiness URL on the explicit IPv4 origin, and check both in the shard-specific config case.
