# Lesson library: maintained end-to-end specs

A maintained browser spec is invalid when a diff strands the locator it uses, makes it ambiguous, leaves its pinned call
list stale, or never produces the state its step needs, and its evidence is invalid when the server, origin or build it
runs against is not the lane's own or drops a reload the case depends on.
Each probe answers the baseline question from the Review section of root `AGENTS.md` (what must break for this
check to fail, and does it observe what its name claims?) and carries its baseline mechanical probe unrestated:
revert the behavioral hunk or apply one targeted mutation, run the named spec, and a remaining green fails the
round. Run mutations only on a committed head through [reviewer isolation](README.md#reviewer-isolation).
Report a probe that cannot run with its exact mutation, named check and limitation, never as passed.

## Standing probes

Every non-draft head runs the affected end-to-end matrix from `.github/workflows/heavy-gates.yml`, and its
result decides `Gate`; nightly runs the full suite ([affected E2E](../../../docs/affected-e2e.md)). Browser
evidence for a head is therefore the `Affected end-to-end <id>` job that ran the spec on that head. A reviewer
cannot run Playwright: first confirm from the head's scope plan that the spec a probe names was selected, since
an unselected spec carries no evidence for that head, then read its job result and log.

1. **A changed control strands the specs that locate it.**
   Probe: when a diff renames, removes or replaces a control, or changes its enabled, disabled or
   visibility condition, search `tests/e2e/` for the union of every form that locates it (test id,
   aria-label or accessible name, placeholder, title, rendered text, role), never assertion names. In
   each spec found, recheck every state read (`toBeVisible`, `toHaveCount`, `toBeDisabled`,
   `toBeEnabled`, `toBeHidden`) and every `isDisabled()`, `isEnabled()` or `isVisible()` guard against
   the new condition. A spec found but not re-homed in the same change is the finding; a found spec the
   head's scope plan did not select is a selection finding for `validation-scope-selection.md`.
   (#4464, #4479)

2. **A new sibling makes a text locator ambiguous.**
   Runs: author. The decoy run is author work; the reviewer performs the locator search from the fixed commit.
   Probe: search `getByText`, `getByRole(..., { name })` and `getByLabel` arguments case-insensitively
   for the added element's text; keep each locator whose argument is a substring of the new text and
   whose role can select the new element. Each must stay unambiguous or move to a stable handle; a
   strict-mode violation or `.first()` selecting the wrong element is the finding. A slider case that
   selects the first slider regardless of subject is the blind form: add a wrong-subject decoy and require
   the intended control assertion to fail when its subject is absent.
   (#1515, #1647, #4473)

3. **A launch-route bridge crossing leaves a pinned call list stale.**
   Probe: when a diff adds, removes or reorders a desktop-bridge crossing on a launch or
   project-activation route, search `tests/e2e/` for the command string and the exact recorded runtime-call
   lists in `tests/e2e/desktopRuntime.spec.ts`; a list not updated in the same change is the finding.
   (#4568)

4. **A step's precondition is never produced, or its outcome cannot fail.**
   Runs: CI; the reviewer reads the `Affected end-to-end <id>` job that ran the spec on the head, and traces
   each step's precondition from the fixed commit.
   Probe: name the state each added Playwright step's locator needs and trace it to the helper that
   produces it (`launch_new_project` in `tests/e2e/e2eUtils.ts` yields zero tracks). Create the asserted
   track and clip deterministically, require editor admission before interacting, and give each advertised
   outcome a readout that fails when the deciding canvas or selector is removed. A case that accepts the
   first dialog instead of the named outcome is the blind form: an unrelated dialog must not satisfy it.
   Playback evidence needs two distinct valid Bars.Beats.Ticks positions after start.
   (#1871, #1536, #1590)

5. **The server lifecycle record never reaches the caller.**
   Probe: run a real child through the launcher in `scripts/e2eDevServer.ts` and require its actual PID,
   checkout root, port, output, and exit code or signal; exercise requested cleanup and a failed spawn.
   Removing either the start or the exit lifecycle record must fail its subprocess assertion under
   `pnpm guard --profile focused -- pnpm test:run scripts/__tests__/e2eDevServer.spec.ts`. Lifecycle
   diagnostics record provenance; they do not by themselves fix a boot failure.
   (#5363, #5595)

6. **A companion route keeps a stale host after an origin change.**
   Probe: the E2E origin is literal IPv4 loopback so Vite's IPv4 listener stays reachable when an IPv6
   listener starts on the same port. Every companion case must keep its build and dev origins equal to the
   configured IPv4 origins. Make `e2eOrigin` in `scripts/e2eServerIdentity.ts` return `localhost` and run
   "runs a shard selecting only Grinder PCM parity through its matching dev companion" under
   `pnpm guard --profile focused -- pnpm test:run scripts/__tests__/e2eServerIdentity.spec.ts`: it must
   fail. Preserve project selection, ports, child command, output capture and shutdown assertions while
   correcting fixture expectations.
   (#5723, #5437)

7. **A compiled inspection entry is not part of the App build it inspects.**
   Probe: a persisted same-tab hydration and replay acceptance needs inspection exports from the same module
   graph as the App, never development-only module URLs. The `sourdaw-e2e-persistence-entry` plugin in
   `vite.config.ts` must emit the inspection entry as an e2e-only second input of the same `index.html` build,
   with live exports of every owning namespace, and shipping builds must stay free of it. Removing the entry
   from the e2e build inputs, or adding it to a shipping build, must fail "keeps the real index entry and
   direct namespaces only in e2e builds" or "does not add the inspection entry or change entry signatures in
   a shipping build" under `pnpm guard --profile focused -- pnpm test:run
scripts/__tests__/viteE2ePersistenceEntry.spec.ts`. Preserve checkout identity and COOP/COEP on preview,
   and reject a split project store through the unchanged acceptance oracle. Reuse the existing built shard;
   only a selected local or nightly persistence fixture may build and own its temporary preview, with
   listener and output cleanup verified.
   (#5812)

8. **A global HMR fence drops a reload a profile requires.**
   Runs: CI; the reviewer reads the `Browser AI WebGPU admission` job on the head when the scope plan
   selects it, and from the fixed commit checks that `tests/e2e/browserAiWebGpuAdmission.playwright.config.ts`
   keeps `NO_HMR: '0'` while `scripts/e2eDevServer.ts` keeps `NO_HMR: '1'` for ordinary documents.
   Probe: the DDSP cold-worker probe awaits a new document after Vite's dependency reoptimization;
   suppressing HMR for that profile filters the optimizer's `full-reload` payload, so the converter import
   gets `504 Outdated Optimize Dep` without navigation. Trace the producer and transport policy of every
   required reload, not only literal HMR consumers. Applying the suppression to the cold-worker profile must
   fail that profile's case. A configuration-value assertion cannot establish this policy.
   (#5874)

9. **Rendered acceptance comes from another lane's server.**
   Probe: before treating rendered acceptance as evidence for a lane, verify the served deciding source and
   port belong to that lane; a reused shared dev server does not prove a lane's layout. Disable the root
   comparison in `assertServingCheckoutIdentity` (`scripts/e2eServerIdentity.ts`) and run "aborts with both roots and the origin when the marker
   names a different checkout" under `pnpm guard --profile focused -- pnpm test:run
scripts/__tests__/e2eServerIdentity.spec.ts`: it must fail. Isolating a lane's server never stops a
   foreign one.
   (#4032)
