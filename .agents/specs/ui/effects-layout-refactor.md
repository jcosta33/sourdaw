# Effects Layout Refactor

## Context

The browser panel currently splits audio effects across two tabs: "Color" (Tone FX) and "Stage" (Mix Utilities). This split relies on arbitrary technology-based checks rather than the semantic function of the plugins. Most notably, all Faust-based plugins are forced into the "Color" tab, even if their function (like "Pro Parametric EQ") logically belongs with mix utilities. Conversely, regular EQs are routed to the "Stage" tab. Premium plugins are hardcoded at the top of these tabs and are excluded from the standard semantic category lists (like "Dynamics" or "EQ & Filter"). 

This creates a fragmented, confusing user experience where plugins of the same type are hidden in completely different tabs based on implementation details the user does not care about.

Reference: `.agents/audits/effects-layout.md`

---

## Goal

Provide a unified, intuitive "Effects" tab in the browser panel where all plugins (Faust, Web Audio, Premium) are categorised exclusively by their semantic audio function (e.g., EQ & Filter, Dynamics, Time & Space) rather than their underlying technology.

---

## User-visible behavior

- The "Color" and "Stage" tabs in the browser panel sidebar will be replaced by a single "Effects" tab.
- All effect plugins will be discoverable within their corresponding semantic category folder (e.g., both the standard EQ and the Faust "Pro Parametric EQ" will be found under "EQ & Filter").
- Premium plugins will be visible inside their corresponding semantic folders, not just as isolated hardcoded cards at the top of the tab (though they may still have visually distinct cards if `featured`).
- The user will no longer need to guess whether a chorus is "Tone" or "Mix" — it will simply be under "Time & Space".

---

## Scope

**In scope:**
- Merging `ColorTab.tsx` and `StageTab.tsx` into a single `EffectsTab.tsx`.
- Updating the `SidebarRoute` definitions and routing logic to use `effects` instead of `color` and `stage`.
- Refactoring `effectsTabHelpers.tsx` to handle the unified plugin list.
- Removing all `p.id.startsWith('faust')` filtering logic.
- Mapping premium plugins to `EFFECT_GROUPS` categories so they appear in standard lists.

**Non-goals (explicitly out of scope):**
- Modifying the `InstrumentsTab.tsx`. (It correctly separates generators from effects).
- Changing the actual underlying DSP or implementation of any plugin.
- Renaming existing plugin IDs or categories in their definitions. We will adapt the grouping logic in `effectsTabHelpers` to catch them.

---

## Requirements

1. **Unified Tab** — There must be a single "Effects" tab replacing "Color" and "Stage" in the sidebar navigation.
2. **Semantic Grouping** — Plugins must be grouped into folders defined in `EFFECT_GROUPS` (e.g., Dynamics, EQ & Filter) based solely on their category or ID string, ignoring their technology stack.
3. **No Faust Isolation** — The UI code must not contain logic that explicitly isolates or redirects plugins based on `id.startsWith('faust')`.
4. **Premium Inclusion** — Premium plugins (`proof`, `dutch-oven`, `bacteria`, etc.) must appear in the semantic category lists alongside standard plugins.
5. **Route Migration** — Sidebar routing must support `effects` and its sub-routes (e.g., `effects-audiofx`, `effects-audiofx-group`), deprecating the old `color-*` and `stage-*` routes.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- UI styling must adhere to the existing design system tokens and Tailwind usage.
- `pnpm deps:validate` must pass with zero violations.

---

## Design decisions

### Decision: Single "Effects" Tab vs. Fixed "Color"/"Stage" Logic

**Chosen:** Merge into a single "Effects" tab.

**Considered and rejected:**
- *Fixing the logic but keeping the two tabs:* Rejected because the distinction between "Color" (Tone) and "Stage" (Mix) is highly subjective and overlapping for many standard effects. A single hierarchical Effects tab with clear sub-folders is the industry standard for DAWs.

### Decision: Handling Premium Plugins

**Chosen:** Map premium plugins to `EFFECT_GROUPS` categories based on their function (e.g., `proof` goes to EQ & Filter / Dynamics) so they are discoverable in standard lists. To maintain their visual prominence and carefully chosen colors, we will render them using their existing `InstrumentCard` (or a visually identical treatment) *inside* their respective semantic category folders, pinned to the top of the list, rather than isolated at the top of the entire tab.

**Considered and rejected:**
- *Removing premium cards entirely:* Rejected because premium plugins need visual prominence.
- *Standard rows for premium plugins:* Rejected because the existing colors and visual weight were carefully picked and must be preserved.

---

## Acceptance criteria

- [ ] The Sidebar displays an "Effects" tab instead of "Color" and "Stage".
- [ ] Clicking the "Effects" tab shows semantic folders (EQ & Filter, Dynamics, Time & Space, etc.).
- [ ] The "Pro Parametric EQ" and standard EQ plugins both appear inside the "EQ & Filter" group.
- [ ] Premium effect plugins appear inside their relevant semantic groups.
- [ ] The codebase contains no instances of `p.id.startsWith('faust')` used for tab isolation.
- [ ] `pnpm deps:validate` passes with zero violations.

---

## Implementation notes

- Start by creating `EffectsTab.tsx` as a combination of `ColorTab` and `StageTab`.
- Update `src/modules/Workspace/presentations/views/Sidebar.tsx` to mount the new tab and handle the new `effects` route.
- In `effectsTabHelpers.tsx`, ensure the `categories` array for each `EffectGroup` is comprehensive enough to catch all plugin variants (including the IDs of premium plugins if they don't use standard categories).
- The `FX Chain Presets` currently in `StageTab` should be moved into the new unified `EffectsTab`.

---

## Test plan

- [ ] Manual step 1 — Open the sidebar, verify only "Instruments", "Effects", and "Samples" (if applicable) are visible for plugins.
- [ ] Manual step 2 — Navigate to Effects -> EQ & Filter, verify "Pro Parametric EQ" is present alongside other EQs and filters.
- [ ] Manual step 3 — Type "eq" in the sidebar search, verify all EQs appear in the search results without being artificially split.
- [ ] Automated: Run `pnpm run typecheck` or equivalent to ensure routing changes did not break types.
- [ ] Automated: Run `pnpm deps:validate` to ensure boundary rules are respected.

---

## Open questions

- [ ] None.
---

## Tradeoffs and risks

- **Trade-off — merging tabs:** Unifying Color and Stage into a single Effects tab reduces the top-level surface but means the Effects tab carries more responsibility. Acceptable because users already think of effects as one category and splitting them was an implementation artifact.
- **Risk — missed plugin categorisation:** Premium plugins or new effects added after this refactor may land in the wrong group if their category metadata drifts. Mitigation: a unit test asserts every registered effect plugin maps to exactly one `EffectGroup`.
- **Risk — route regression:** Existing users' URL bookmarks or deep links may reference the old `color` / `stage` routes. Mitigation: redirect old routes to the unified `effects` route during mount; add a smoke test for the redirect.
