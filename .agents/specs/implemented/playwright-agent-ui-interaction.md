# Playwright Agent UI Interaction System

## Context

Currently, testing relies on Vitest for unit and integration testing. While agents use this setup to write and verify specs, Vitest lacks a way for agents to dynamically interact with the actual rendered UI in a real browser environment. Playwright solves this by allowing full browser testing. Crucially, Playwright will serve not just as a traditional end-to-end testing framework, but as an interactive bridge. It will allow AI agents to dynamically interact with, investigate, and assert the state of the live application visually and behaviorally.

Reference relevant research if any: N/A

---

## Goal

Establish a Playwright-based structure that supports both traditional automated E2E tests and ephemeral, ad-hoc scripts used by agents to interact with, explore, and debug the live application UI.

---

## User-visible behavior

- Developers and CI pipelines run robust end-to-end UI tests via standard commands (e.g., `pnpm test:e2e`).
- AI Agents write and execute dedicated Playwright Node scripts to autonomously inspect the DOM, trigger complex UI interactions (like manipulating canvas elements or Web Audio graph nodes), and scrape visual/stateful context into stdout for further analysis.

---

## Scope

**In scope:**

- Playwright installation and fundamental configuration within the repository.
- Establishing file structure conventions that separate standard E2E tests from agent-driven UI interaction scripts.
- Creation of scripts/commands to easily execute Playwright tests and agent UI interactions against a local dev server.
- Guidelines for how agents should structure ad-hoc interaction scripts to maximize reliability and output useful data.

**Non-goals (explicitly out of scope):**

- Migrating existing Vitest unit or integration tests to Playwright.
- Implementing the actual complex UI interactions/tasks for the project features (this spec covers the infrastructure only).
- Visual regression testing (pixel-matching screenshots). Focus is on DOM state, element visibility, and behavioral interactions.

---

## Requirements

1. **Playwright Configured:** Playwright must be configured to automatically manage the local development server (e.g., Vite) via its `webServer` configuration.
2. **Distinct Execution Modes:** The structure must support standard `@playwright/test` files for assertions and raw Node scripts (using the `playwright` core library) for ad-hoc agent investigations.
3. **Directory Separation:** Standard tests and agent interaction scripts must be kept in separate directories to prevent ad-hoc investigations from polluting the CI test suite.
4. **Agent Interaction Output:** Agent interaction scripts must output structured data (JSON or formatted text) to `stdout` so the calling agent can easily parse the result of its interaction. This includes the ability to output file paths to captured screenshots for visual analysis by the agent's multi-modal capabilities.
5. **Robust Selectors:** Both tests and interaction scripts must prioritize robust locators (e.g., `getByRole`, `getByTestId`) to minimize fragility during UI refactors.

---

## Constraints

- Must be non-blocking for normal development workflows.
- Agent interaction scripts must execute quickly and cleanly clean up their browser processes to prevent memory leaks in the agent's environment.

---

## Design decisions

### Decision: Directory Structure

**Chosen:**

- `tests/e2e/` for standard, CI-bound automated tests using `@playwright/test`.
- `.agents/ui-scripts/` for ephemeral, agent-authored scripts using the `playwright` library directly.

**Considered and rejected:** Mixing agent interaction scripts into `tests/e2e/`. Rejected because standard tests are meant for asserting correctness and pass/fail states in CI, whereas agent scripts are often purely for gathering context, debugging a specific state, or validating a layout dynamically. Mixing them would bloat the test runner.

### Decision: Agent Interaction Execution Pattern

**Chosen:** Agents will write standard TypeScript/Node scripts utilizing `playwright` directly and execute them via `npx tsx .agents/ui-scripts/<script-name>.ts`.
**Considered and rejected:** Forcing agents to use the `@playwright/test` runner for ad-hoc investigations. The test runner adds overhead and formats output in a way that is optimized for humans/reporters, making it harder for agents to scrape arbitrary JSON or plain text data returned from an investigation.

---

## Acceptance criteria

<acceptance_criteria>

- [ ] Playwright is installed and `playwright.config.ts` is configured to boot the local web server.
- [ ] `tests/e2e/` directory exists and a basic E2E smoke test passes via a `test:e2e` script.
- [ ] `.agents/ui-scripts/` directory exists with a sample investigation script demonstrating how to navigate, interact, and print data to stdout.
- [ ] Documentation (e.g., in `AGENTS.md` or a new skill) details how agents should use this system for UI investigations.
- [ ] `pnpm deps:validate` passes with zero violations.

</acceptance_criteria>

---

## Implementation notes

- To avoid agents having to write boilerplate for every interaction, consider providing a `setupAgentBrowser()` helper inside `.agents/ui-scripts/utils.ts` that handles browser launch, context creation, and navigation to the local dev server.
- The Vitest setup can run in parallel; Playwright tests will be an entirely separate suite, likely running on a different port if needed.

---

## Test plan

- [ ] Manual step: An agent creates an ad-hoc script in `.agents/ui-scripts/`, executes it via the shell, and successfully reads the custom output from stdout.
- [ ] Automated: Run `pnpm test:e2e` to ensure the smoke test passes and the Vite server lifecycle is handled correctly.

---

## Open questions

- [ ] **[MINOR]** Should we provide a unified helper library for agents that includes common routines like authenticating (if applicable) or resetting app state before interaction?
- [ ] **[MINOR]** Is there a need to keep a background browser instance running (via WebSockets/CDP) to speed up sequential agent interactions, or is the overhead of a headless browser launch acceptable per script?

---

## Tradeoffs and risks

- **Fragility:** Agents might write brittle scripts that depend on exact DOM structures. To mitigate this, guidelines must heavily enforce semantic HTML and testing-library-style locators.
- **Speed:** Launching a full headless browser is significantly slower than running Vitest. Agents might over-rely on UI investigations when a unit test would be faster and more appropriate.
  would be faster and more appropriate.
