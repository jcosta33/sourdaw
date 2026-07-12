---
type: research
id: RESEARCH-plugin-identity
title: Plugin visual identity — supporting evidence and reference tables
status: recovered
sources:
  - specs/implemented/plugin-identity.md (pre-migration, git bb84b0e)
---

# Plugin visual identity — supporting evidence

This note preserves the reference and evidence tables that backed the
`plugin-identity` spec but are not themselves verifiable requirements. They are
restored verbatim from the pre-migration source
(`specs/implemented/plugin-identity.md` at git `bb84b0e`) so the measured
evidence and concrete assignments survive alongside the requirement-only spec.

The spec's `## Dropped from sources` section points here.

---

## Color Separation Analysis (recovered)

Backs spec **AC-007**. These are the specific near-collisions that were found and
the concrete colors chosen to resolve each one.

**Problematic overlaps identified and resolved:**

| Issue                                                 | Resolution                                            |
| ----------------------------------------------------- | ----------------------------------------------------- |
| Fermenter (yellow-green) too close to Bacteria (mint) | Fermenter → Sage `#8aa88a`                            |
| Dutch Oven (copper) identical to Crust (copper)       | Dutch Oven → Amber `#c4aa5f`, Crust → Peach `#c9a07a` |
| Yeast (pink) and Levain (coral) too similar           | Yeast → Rose `#c06070`, Levain stays Coral `#e07a6e`  |
| Scoring (steel) too close to Proof (cyan)             | Scoring → Indigo `#4a60a0`                            |
| Sampler lacked panel CSS                              | Created crumbs utilities, renamed from Sampler        |

---

## Plugin Color Matrix (recovered)

The full per-plugin primary/secondary hex assignments and rationale. The spec
states the *rules* (namespaced token, ≥30° separation, AA contrast); these are
the concrete *values* the implementation uses.

### Color Wheel Distribution

To ensure visual distinction, plugins are positioned around the color wheel with
**minimum 30° separation** between primary accents:

```
         Cyan (Proof)
            ↑
Lavender ←  ●  → Mint (Bacteria)
(Gluten)        (Fermenter-sage)

  Rose ←  ●  → Indigo (Scoring)
(Yeast)           (deep blade)

    Red ←  ●  → Amber (Dutch Oven)
  (Toaster)         (warm cast iron)

   Coral ←  ●  → Peach (Crust)
  (Levain)        (baked golden)

        Orange (Grinder)
            ↓
      (Grand Boule: Neutral)
```

### Primary & Secondary Assignments

| Plugin                   | Primary               | Secondary        | Rationale                                   |
| ------------------------ | --------------------- | ---------------- | ------------------------------------------- |
| **Grinder**              | Orange `#f1a54b`      | Amber `#c4aa5f`  | Mechanical, energetic, industrial machinery |
| **Bacteria**             | Mint-Bright `#66d2a5` | Cyan `#7fb8c4`   | Living, organic, microbial vitality         |
| **Fermenter**            | Sage `#8aa88a`        | Cyan `#7fb8c4`   | Natural fermentation, organic culture       |
| **Toaster**              | Red `#c49090`         | Orange `#f1a54b` | Heat, fire, intensity, warning              |
| **Levain**               | Coral `#e07a6e`       | Amber `#c4aa5f`  | Warm sourdough starter, active cultures     |
| **Gluten**               | Lavender `#a89bc4`    | Mint `#7db8a0`   | Elastic, stretchy, soft yet structural      |
| **Yeast**                | Rose `#c06070`        | Amber `#c4aa5f`  | Living culture, distinct from coral         |
| **Crust**                | Peach `#c9a07a`       | Copper `#b88868` | Baked, golden, distinct from Dutch Oven     |
| **Scoring**              | Indigo `#4a60a0`      | Cyan `#7fb8c4`   | Deep blade steel, distinct from Proof cyan  |
| **Proof**                | Cyan `#7fb8c4`        | Steel `#6a8aa8`  | Controlled, cool, measured, precise rise    |
| **Dutch Oven**           | Amber `#c4aa5f`       | Peach `#c9a07a`  | Warm cast iron, distinct from Crust         |
| **Crumbs** (was Sampler) | Lavender `#a89bc4`    | Peach `#c9a07a`  | Sample library, refined                     |
| **Grand Boule**          | Light Gray `#c0bebe`  | White `#ffffff`  | Classic, neutral, refined, pure             |

### Design Tokens Reference

```css
/* From tokens.css - use these variables */
--color-accent-orange: #f1a54b;
--color-accent-amber: #c4aa5f;
--color-accent-mint: #7db8a0;
--color-accent-mint-bright: #66d2a5;
--color-accent-cyan: #7fb8c4;
--color-accent-lavender: #a89bc4;
--color-accent-peach: #c9a07a;
--color-accent-coral: #e07a6e;
--color-accent-pink: #c18fa3;
--color-accent-red: #c49090;
--color-accent-copper: #b88868;
--color-accent-sage: #8aa88a;
--color-accent-steel: #6a8aa8;

/* Extended for distinct plugin colors */
--color-accent-rose: #c06070;
--color-accent-indigo: #4a60a0;
--color-accent-yellow-green: #8a9450;
```

---

## Quick Reference Contrast Ratios (recovered)

Backs spec **AC-003**. The measured evidence that each plugin primary actually
passes 4.5:1 AA against the panel surfaces `#111111` and `#050505`.

| Color               | On #111111 | On #050505 |
| ------------------- | ---------- | ---------- |
| Orange #f1a54b      | 8.2:1 ✅   | 10.4:1 ✅  |
| Mint-Bright #66d2a5 | 9.1:1 ✅   | 11.6:1 ✅  |
| Sage #8aa88a        | 6.2:1 ✅   | 7.8:1 ✅   |
| Red #c49090         | 6.2:1 ✅   | 7.8:1 ✅   |
| Coral #e07a6e       | 5.4:1 ✅   | 6.8:1 ✅   |
| Lavender #a89bc4    | 6.8:1 ✅   | 8.6:1 ✅   |
| Rose #c06070        | 5.1:1 ✅   | 6.4:1 ✅   |
| Peach #c9a07a       | 5.8:1 ✅   | 7.3:1 ✅   |
| Indigo #4a60a0      | 4.8:1 ✅   | 6.0:1 ✅   |
| Cyan #7fb8c4        | 7.4:1 ✅   | 9.3:1 ✅   |
| Amber #c4aa5f       | 6.1:1 ✅   | 7.7:1 ✅   |

---

## Glow Intensity / energy-level table (recovered)

An implementation nicety, not a verifiable requirement (the spec keeps it as a
deliberate drop). Recorded here so the tuning intent survives.

Faceplate glow intensity should vary by plugin "energy":

| Energy Level | Plugins                     | Glow Opacity |
| ------------ | --------------------------- | ------------ |
| High         | Toaster, Grinder, Fermenter | 12-16%       |
| Medium       | Levain, Yeast, Bacteria     | 10-14%       |
| Low          | Proof, Grand Boule, Scoring | 8-12%        |

Related saturation guidance from the source:

- Primary accents: 40-60% saturation (industrial muted)
- Secondary accents: 30-50% saturation
- Glow effects: 8-16% opacity of primary
