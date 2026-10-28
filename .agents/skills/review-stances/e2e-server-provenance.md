# E2E server provenance

PR #5363 introduced the CI dev companion. The #5595 failure lacks the actual server's
post-readiness exit provenance; earlier local history, private review prompts and tiers, and the
original connection-loss cause remain unknown. Lifecycle diagnostics are preparation, not a fix
for the white boot.

Run a real child through the launcher and require its actual PID, checkout root, port, output, and
exit code or signal. Exercise requested cleanup and a failed spawn. Removing either the start or
exit lifecycle record must fail its corresponding subprocess assertion; a green test after either
mutation does not prove the record reaches the caller.
