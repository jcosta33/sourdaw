# Audit: Effects Layout & Categorisation

## Goal
The browser panel must provide an extremely intuitive and logically sound organisation for all plugins and effects. Users should be able to find a plugin based on its audio function (e.g., EQ, Compressor, Reverb), regardless of its underlying technology (Faust, Web Audio, Premium/Custom UI). The split between tabs should be semantically meaningful and free from arbitrary technology-based filtering.

## Current state

The current layout splits plugins across three main tabs: Instruments, Color, and Stage. The categorisation relies heavily on hardcoded ID matching and technology checks rather than plugin semantics.

- **Instruments Tab** (`src/modules/Workspace/presentations/views/Sidebar/InstrumentsTab.tsx`): 
  - Groups synth instruments and acoustic & percussion.
  - Excludes `CUSTOM_UI_DEVICE_TYPES` (e.g., `fermenter`, `toaster`, `levain`, `builtin-sampler`, `grand-boule`), rendering them as dedicated `InstrumentCard` components at the top.
- **Color Tab ("Tone FX")** (`src/modules/Workspace/presentations/views/Sidebar/ColorTab.tsx:32-52`):
  - Hardcodes premium UI plugins (`bacteria`, `grinder`, `yeast`) as cards.
  - Forces **all** Faust plugins into this tab: `if (p.id.startsWith('faust')) return true;`.
  - Filters remaining plugins by matching ID strings against categories like `distortion`, `chorus`, `filter`.
- **Stage Tab ("Mix Utilities")** (`src/modules/Workspace/presentations/views/Sidebar/StageTab.tsx:44-65`):
  - Hardcodes premium UI plugins (`proof`, `native-scoring`, `dutch-oven`, `gluten`, `crust`) as cards.
  - Explicitly excludes **all** Faust plugins: `if (p.id.startsWith('faust')) return false;`.
  - Filters remaining plugins by matching ID strings against categories like `eq`, `compressor`, `reverb`, `delay`.
- **Shared Grouping** (`src/modules/Workspace/presentations/views/Sidebar/effectsTabHelpers.tsx:23-56`):
  - Defines shared `EFFECT_GROUPS` (e.g., "EQ & Filter"). 
  - Because "filter" goes to Color and "eq" goes to Stage, the UI displays an "EQ & Filter" group in **both** tabs, but the Color tab's group only contains filters, and the Stage tab's group only contains EQs.

## Findings

1. **Technology dictates placement, breaking semantics:** The "Pro Parametric EQ" is built with Faust, so it is forced into the Color tab (Tone FX). Regular EQs match the `eq` string and go to the Stage tab (Mix Utilities). This results in two different EQ plugins being hidden in entirely separate tabs.
2. **Artificial "Color" vs "Stage" split:** The distinction between Tone FX and Mix Utilities is largely arbitrary and confusing for standard effect categories (e.g., filtering is tone, but EQ is mix; reverb is mix, but chorus is tone).
3. **Fragmented UI Groups:** The shared `EFFECT_GROUPS` definitions are applied *after* the tab-level filtering. This creates duplicated group headers across tabs with incomplete contents (e.g., seeing "EQ & Filter" in the Color tab but finding no EQs inside it).
4. **Premium plugins bypass normal discovery:** Premium plugins (like `proof` or `bacteria`) are hardcoded at the top of these tabs. While good for visibility, they are entirely excluded from the semantic category lists, meaning a user looking in the "Dynamics" folder won't find the premium compressor.

## Issues

1. **Faust plugins are categorically forced into Tone FX (Color)**
   - **Needed:** Remove the `p.id.startsWith('faust')` hardcoding. Faust plugins should declare their semantic category (e.g., `eq`, `distortion`) and be grouped based on that category, just like native plugins.
2. **EQ and Filter plugins are split across tabs**
   - **Needed:** Unify effects into a single logical hierarchy. If the Color/Stage split must remain, EQs and Filters must belong to the same parent tab to avoid splitting the `EQ & Filter` group.
3. **Color vs Stage tabs create an ambiguous UX**
   - **Needed:** Deprecate the arbitrary Color/Stage split in favor of a unified "Effects" (or "Audio FX") tab that houses all effects grouped purely by function (Dynamics, EQ & Filter, Time & Space, etc.).
4. **Premium plugins are missing from semantic folders**
   - **Needed:** Premium plugins should appear inside their respective semantic folders (e.g., `proof` inside Dynamics/EQ) in addition to (or instead of) the top-level promotional cards.

## Priorities

1. Unify the effect tabs (Color and Stage) into a single "Effects" tab.
2. Remove technology-based hardcoding (`p.id.startsWith('faust')`) from tab assignment logic.
3. Ensure all plugins, including Premium ones, are mapped to a standard `EFFECT_GROUPS` category and appear in those lists.
4. Clean up `effectsTabHelpers.tsx` to serve as the single source of truth for plugin categorisation.

## Risks

- **Discoverability failure:** Users will not find the plugins they need (like Parametric EQ) because they are looking in the logically correct place (Mix utilities -> EQ) but the plugin is hidden in Tone FX due to implementation details.
- **Maintenance overhead:** Adding a new plugin requires remembering to update hardcoded arrays in specific tabs (`premiumIds`, `colorCats`, `stageCats`) rather than just assigning it a standard category.

## Suggested approaches

1. **Consolidate to "Instruments" and "Effects" Tabs:**
   - Keep "Instruments" for generators (synths, samplers).
   - Merge "Color" and "Stage" into a single "Effects" tab.
   - Use the `EFFECT_GROUPS` (Dynamics, EQ & Filter, Time & Space, Saturation, Utility) as the primary navigation folders within the Effects tab.
2. **Metadata-driven categorisation:**
   - Rely entirely on the `category` or tags defined in the `PluginDescriptor` to place plugins in folders.
   - If a plugin is "Premium", add a `featured: true` flag to its descriptor rather than hardcoding its ID in the UI layer. The UI can then render a "Featured" section at the top of the tab by querying `plugins.filter(p => p.featured)`.
3. **Remove Faust isolation:**
   - Treat Faust plugins as regular plugins in the browser. Their DSP origin is irrelevant to the user looking for an EQ or a Phaser.

## Resolved

*(None yet)*