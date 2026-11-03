# Lesson library: maintained end-to-end specs

A maintained browser spec is invalid when a diff strands the locator it uses, makes it ambiguous, leaves its pinned call
list stale, or never produces the state its step needs, and its evidence is invalid when the server, origin or build it
runs against is not the lane's own or drops a reload the case depends on. Split out of `test-validity.md`.
Each probe answers the baseline question from the Review section of root `AGENTS.md` (what must break for this
check to fail, and does it observe what its name claims?) and carries its baseline mechanical probe unrestated:
revert the behavioral hunk or apply one targeted mutation, run the named spec, and a remaining green fails the
round. Run mutations only on a committed head through [reviewer isolation](README.md#reviewer-isolation).
Report a probe that cannot run with its exact mutation, named check and limitation, never as passed.

## Standing probes

Browser specs run only in the admitted run after approval and in nightly, so the reviewing head
carries no browser evidence for these probes.

1. **A changed control strands the specs that locate it.**
   Probe: when a diff renames, removes or replaces a control, or changes its enabled, disabled or
   visibility condition, search `tests/e2e/` for the union of every form that locates it (test id,
   aria-label or accessible name, placeholder, title, rendered text, role), never assertion names. In
   each spec found, recheck every state read (`toBeVisible`, `toHaveCount`, `toBeDisabled`,
   `toBeEnabled`, `toBeHidden`) and every `isDisabled()`, `isEnabled()` or `isVisible()` guard against
   the new condition, and re-home it in the same change.
   (#4464, #4479)

2. **A new sibling makes a text locator ambiguous.**
   Probe: search `getByText`, `getByRole(..., { name })` and `getByLabel` arguments case-insensitively
   for the added element's text; keep each locator whose argument is a substring of the new text and
   whose role can select the new element. Each must stay unambiguous or move to a stable handle; a
   strict-mode violation or `.first()` selecting the wrong element is the finding.
   (#4473)

3. **A launch-route bridge crossing leaves a pinned call list stale.**
   Probe: when a diff adds, removes or reorders a desktop-bridge crossing on a launch or
   project-activation route, search `tests/e2e/` for the command string and exact runtime-call lists
   (`desktopRuntime.spec.ts`) and update them in the same change.
   (#4568)

4. **A step's precondition is never produced, or its outcome cannot fail.**
   Probe: name the state each added Playwright step's locator needs and trace it to the helper that
   produces it (`launch_new_project` yields zero tracks). Create the asserted track and clip
   deterministically, require editor admission before interacting, and give each advertised outcome a
   readout that fails when the deciding canvas or selector is removed. Playback evidence needs two
   distinct valid Bars.Beats.Ticks positions after start. Inspect the selected E2E result in PR CI.
   (#1536, #1590)

5. **The server lifecycle record never reaches the caller.**
   Probe: run a real child through the launcher and require its actual PID, checkout root, port, output, and exit
   code or signal; exercise requested cleanup and a failed spawn. Removing either the start or the exit lifecycle
   record must fail its subprocess assertion. Lifecycle diagnostics are preparation, not a fix for the white boot;
   the actual server's post-readiness exit provenance and the original connection-loss cause remain unknown.
   (#5363, #5595)

6. **A companion route keeps a stale host after an origin change.**
   Probe: #5723 moved the E2E origin to literal IPv4 loopback so Vite's IPv4 listener stays reachable when an IPv6
   listener starts on the same port, while the later Grinder-only companion case kept `localhost` expectations. Keep
   the build and dev origins in every companion case equal to the configured IPv4 origins, then make the origin
   factory return `localhost` and run the named Grinder case: it must fail. Preserve project selection, ports,
   child command, output capture and shutdown assertions while correcting fixture expectations.
   (#5723, #5437)

7. **A compiled inspection entry is not part of the App build it inspects.**
   Probe: a persisted same-tab hydration and replay acceptance used development-only module URLs. A compiled
   inspection entry must be an e2e-only second input of the same `index.html` build, with live exports of all eight
   owning namespaces. Preserve checkout identity and COOP/COEP on preview, and reject a split project store through
   the unchanged acceptance oracle. Reuse the existing built shard; only a selected local or nightly persistence
   fixture may build and own its temporary preview, with listener and output cleanup verified, and shipping builds
   stay free of the inspection entry. Removing a source dependency changes the tested serving route; it does not
   identify the physical actor behind prior source-graph cancellations.
   (#5812)

8. **A global HMR fence drops a reload a profile requires.**
   Probe: the DDSP cold-worker probe awaits a new document after Vite's dependency reoptimization; applying
   `NO_HMR=1` to that profile filtered the optimizer's `full-reload` payload, so the converter import got
   `504 Outdated Optimize Dep` without navigation. Trace the producer and transport policy of every required reload,
   not only literal HMR consumers. Keep the cold-worker profile's HMR enabled while ordinary immutable documents keep
   their disconnect fence; applying the suppression to the cold-worker profile must fail that profile's case. A
   configuration-value assertion cannot establish this policy.
   (#5874)

9. **Rendered acceptance comes from another lane's server.**
   Probe: before treating rendered acceptance as evidence for a lane, verify the served deciding source and port
   belong to that lane; a reused shared dev server does not prove a lane's layout. Isolate the lane's server without
   stopping a foreign one, then point the acceptance at a server serving another checkout: the identity assertion
   must refuse it.
   (#4032)
