# Lesson library: maintained end-to-end specs

A maintained browser spec is invalid when a diff strands the locator it uses, makes it ambiguous, leaves its pinned call
list stale, or never produces the state its step needs. Split out of `test-validity.md`.
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
