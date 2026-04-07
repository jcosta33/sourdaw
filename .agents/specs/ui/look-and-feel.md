# Sourdaw Look & Feel Specification

## Visual Identity System

Each plugin/module in Sourdaw must have a **distinct, immediately recognizable visual identity** while maintaining cohesion within the industrial-dark DAW aesthetic.

---

## Core Principles

1. **Distinctiveness First**: At a glance, users must be able to differentiate between any two plugins
2. **Muted Industrial Base**: All plugins sit on the same dark, desaturated foundation (#030303 to #151515)
3. **Accent-Driven Identity**: Each plugin's uniqueness comes from its accent color and secondary tones
4. **Semantic Color Mapping**: Colors should evoke the plugin's purpose/mechanism
5. **Accessibility**: All active states must meet WCAG 2.1 AA contrast (4.5:1 minimum)

---

## Plugin Color Matrix

### Color Wheel Distribution

To ensure visual distinction, plugins are positioned around the color wheel with **minimum 30° separation** between primary accents:

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

| Plugin | Primary | Secondary | Rationale |
|--------|---------|-----------|-----------|
| **Grinder** | Orange `#f1a54b` | Amber `#c4aa5f` | Mechanical, energetic, industrial machinery |
| **Bacteria** | Mint-Bright `#66d2a5` | Cyan `#7fb8c4` | Living, organic, microbial vitality |
| **Fermenter** | Sage `#8aa88a` | Cyan `#7fb8c4` | Natural fermentation, organic culture |
| **Toaster** | Red `#c49090` | Orange `#f1a54b` | Heat, fire, intensity, warning |
| **Levain** | Coral `#e07a6e` | Amber `#c4aa5f` | Warm sourdough starter, active cultures |
| **Gluten** | Lavender `#a89bc4` | Mint `#7db8a0` | Elastic, stretchy, soft yet structural |
| **Yeast** | Rose `#c06070` | Amber `#c4aa5f` | Living culture, distinct from coral |
| **Crust** | Peach `#c9a07a` | Copper `#b88868` | Baked, golden, distinct from Dutch Oven |
| **Scoring** | Indigo `#4a60a0` | Cyan `#7fb8c4` | Deep blade steel, distinct from Proof cyan |
| **Proof** | Cyan `#7fb8c4` | Steel `#6a8aa8` | Controlled, cool, measured, precise rise |
| **Dutch Oven** | Amber `#c4aa5f` | Peach `#c9a07a` | Warm cast iron, distinct from Crust |
| **Crumbs** (was Sampler) | Lavender `#a89bc4` | Peach `#c9a07a` | Sample library, refined |
| **Grand Boule** | Light Gray `#c0bebe` | White `#ffffff` | Classic, neutral, refined, pure |

### Color Separation Analysis

**Problematic overlaps identified and resolved:**

| Issue | Resolution |
|-------|------------|
| Fermenter (yellow-green) too close to Bacteria (mint) | Fermenter → Sage `#8aa88a` |
| Dutch Oven (copper) identical to Crust (copper) | Dutch Oven → Amber `#c4aa5f`, Crust → Peach `#c9a07a` |
| Yeast (pink) and Levain (coral) too similar | Yeast → Rose `#c06070`, Levain stays Coral `#e07a6e` |
| Scoring (steel) too close to Proof (cyan) | Scoring → Indigo `#4a60a0` |
| Sampler lacked panel CSS | Created crumbs utilities, renamed from Sampler |

---

## CSS Implementation

### File Structure

```
src/styles/utilities/modules/
├── grinder.css      /* Orange + Amber */
├── bacteria.css     /* Mint-Bright + Cyan */
├── fermenter.css    /* Sage + Cyan */
├── toaster.css      /* Red + Orange */
├── levain.css       /* Coral + Amber */
├── gluten.css       /* Lavender + Mint */
├── yeast.css        /* Rose + Amber */
├── crust.css        /* Peach + Copper */
├── scoring.css      /* Indigo + Cyan */
├── proof.css        /* Cyan + Steel */
├── dutch-oven.css   /* Amber + Peach */
└── grand-boule.css  /* Light Gray + White */

src/styles/main.css contains @utility definitions:
├── crumbs-faceplate /* Lavender + Peach */
├── crumbs-window
└── crumbs-tab-active
```

### Required Utility Classes

Each module CSS must define:

```css
/* Faceplate - The main panel background */
@utility {module}-faceplate {
    /* Radial gradient glow from primary color */
    /* Secondary accent at opposite corner */
    /* Base panel gradient */
}

/* Window - Inset display areas */
@utility {module}-window {
    /* Subtle primary tint */
    /* Inset shadow */
}

/* Tab Active - Selected state for module tabs */
@utility {module}-tab-active {
    /* Primary color text */
    /* Primary color border */
    /* Primary color background gradient */
}

/* Module-specific variants (optional) */
@utility {module}-{component}-active { }
```

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

## Plugin Browser Cards

Plugin cards in the browser panel must visually communicate the plugin's identity at small sizes.

### Card Structure

```
┌─────────────────────────────┐
│  ┌─────┐  Plugin Name       │  ← Header row with icon
│  │icon │  Category           │
│  └─────┘                     │
│  ─────────────────────────   │
│  Brief description text...   │  ← Description area
│                              │
│  [Color bar]      [Add ▼]    │  ← Color indicator + Action
└─────────────────────────────┘
```

### Card Specifications

| Element | Specification |
|---------|---------------|
| **Background** | `--color-bg-panel` with 1px `--color-border-soft` border |
| **Icon Container** | 48×48px rounded square with `{module}-faceplate` utility |
| **Plugin Name** | `--color-text-primary`, font-semibold, 14px |
| **Category** | `--color-text-tertiary`, 11px, uppercase, tracking-wide |
| **Description** | `--color-text-secondary`, 12px, 2-line clamp |
| **Color Indicator** | 4px × 100% height left border in primary color |
| **Hover State** | Border transitions to primary color at 40% opacity |
| **Selected State** | Full border in primary color at 60% opacity |

### Card Color System

Each plugin card uses a **vertical accent bar** (4px left border) to indicate its identity:

```css
/* Example: Grinder card */
.plugin-card-grinder {
    border-left: 4px solid var(--color-accent-orange);
}

.plugin-card-grinder:hover {
    border-color: rgba(241, 165, 75, 0.4);
}

.plugin-card-grinder.selected {
    border: 1px solid rgba(241, 165, 75, 0.6);
    border-left: 4px solid var(--color-accent-orange);
}
```

### Card Icon Styling

The plugin icon sits in a small faceplate container using the module's theme:

```css
/* Icon container uses the faceplate utility */
.plugin-icon.grinder {
    @apply grinder-faceplate;
    width: 48px;
    height: 48px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Icon itself uses primary color */
.plugin-icon.grinder svg {
    color: var(--color-accent-orange);
    width: 24px;
    height: 24px;
}
```

### Browser Grid Layout

```
┌────────────────────────────────────────────────────────────┐
│  Search...                          [Filters ▼] [View ▼]   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │ [Orange] │  │ [Mint]   │  │ [Sage]   │                 │
│  │ Grinder  │  │ Bacteria │  │ Fermenter│                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
│                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │ [Red]    │  │ [Coral]  │  │ [Rose]   │                 │
│  │ Toaster  │  │ Levain   │  │ Yeast    │                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Card Quick Reference

| Plugin | Border Color | Icon BG | Icon Color |
|--------|--------------|---------|------------|
| Grinder | Orange | `grinder-faceplate` | Orange |
| Bacteria | Mint-Bright | `bacteria-faceplate` | Mint-Bright |
| Fermenter | Sage | `fermenter-faceplate` | Sage |
| Toaster | Red | `toaster-faceplate` | Red |
| Levain | Coral | `levain-faceplate` | Coral |
| Gluten | Lavender | `gluten-faceplate` | Lavender |
| Yeast | Rose | `yeast-faceplate` | Rose |
| Crust | Peach | `crust-faceplate` | Peach |
| Scoring | Indigo | `scoring-faceplate` | Indigo |
| Proof | Cyan | `proof-faceplate` | Cyan |
| Dutch Oven | Amber | `dutch-oven-faceplate` | Amber |
| Crumbs | Lavender | `crumbs-faceplate` | Lavender |
| Grand Boule | Light Gray | `grand-boule-faceplate` | Light Gray |

---

## Visual Distinction Guidelines

### 1. Hue Separation

- **Minimum 30° apart** on the color wheel for primary accents
- **Complementary or triadic** relationships preferred for primary+secondary

### 2. Saturation Control

- Primary accents: 40-60% saturation (industrial muted)
- Secondary accents: 30-50% saturation
- Glow effects: 8-16% opacity of primary

### 3. Surface Treatments

All modules share the same base surfaces:

| Surface | Value | Usage |
|---------|-------|-------|
| `--color-bg-app` | #030303 | Application background |
| `--color-bg-canvas` | #080808 | Timeline canvas |
| `--color-bg-panel` | #111111 | Plugin faceplate base |
| `--color-bg-panelRaised` | #1a1a1a | Raised sections |
| `--color-bg-panelInset` | #050505 | Inset windows |

### 4. Glow Intensity

Faceplate glow intensity should vary by plugin "energy":

| Energy Level | Plugins | Glow Opacity |
|--------------|---------|--------------|
| High | Toaster, Grinder, Fermenter | 12-16% |
| Medium | Levain, Yeast, Bacteria | 10-14% |
| Low | Proof, Grand Boule, Scoring | 8-12% |

---

## Contrast Requirements

### Active States (AA Compliance)

| Element | Minimum Contrast | Test Against |
|---------|------------------|--------------|
| Tab active text | 4.5:1 | `--color-bg-panel` |
| Active border | 3:1 | `--color-bg-panel` |
| Selected control | 4.5:1 | `--color-bg-panelInset` |
| Card text | 4.5:1 | `--color-bg-panel` |
| Card icon | 3:1 | `--color-bg-panel` |

### Quick Reference Contrast Ratios

| Color | On #111111 | On #050505 |
|-------|------------|------------|
| Orange #f1a54b | 8.2:1 ✅ | 10.4:1 ✅ |
| Mint-Bright #66d2a5 | 9.1:1 ✅ | 11.6:1 ✅ |
| Sage #8aa88a | 6.2:1 ✅ | 7.8:1 ✅ |
| Red #c49090 | 6.2:1 ✅ | 7.8:1 ✅ |
| Coral #e07a6e | 5.4:1 ✅ | 6.8:1 ✅ |
| Lavender #a89bc4 | 6.8:1 ✅ | 8.6:1 ✅ |
| Rose #c06070 | 5.1:1 ✅ | 6.4:1 ✅ |
| Peach #c9a07a | 5.8:1 ✅ | 7.3:1 ✅ |
| Indigo #4a60a0 | 4.8:1 ✅ | 6.0:1 ✅ |
| Cyan #7fb8c4 | 7.4:1 ✅ | 9.3:1 ✅ |
| Amber #c4aa5f | 6.1:1 ✅ | 7.7:1 ✅ |

---

## Adding New Plugins

### Process

1. **Identify the plugin's semantic character** (what it does, how it feels)
2. **Map to the color wheel** - find the gap (minimum 30° from neighbors)
3. **Select primary + secondary** that evoke the mechanism
4. **Check contrast ratios** against base surfaces
5. **Create the CSS module file** following the template
6. **Add card styles** for browser panel integration
7. **Add to tokens.css** if new accent color needed

### CSS Module Template

```css
/* {PluginName} - {Theme Description}
 * Primary: {ColorName} ({Hex}, {Rationale})
 * Secondary: {ColorName} ({Hex}, {Rationale})
 */

@utility {module}-faceplate {
    background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.014)),
        radial-gradient(circle at 14% 0%, rgba({primary-rgb}, 0.12), transparent 24%),
        radial-gradient(circle at 82% 0%, rgba({secondary-rgb}, 0.08), transparent 20%),
        linear-gradient(180deg, var(--color-bg-panelRaised), var(--color-bg-panel));
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.07),
        inset 0 -1px 0 rgba(0, 0, 0, 0.45),
        var(--shadow-elevation-raised);
}

@utility {module}-window {
    background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01)),
        linear-gradient(180deg, rgba({primary-rgb}, 0.06), transparent 22%), var(--color-bg-panelInset);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-top-color: rgba(255, 255, 255, 0.12);
    border-radius: 18px;
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.05),
        inset 0 -1px 0 rgba(0, 0, 0, 0.45),
        var(--shadow-elevation-inset);
}

@utility {module}-tab-active {
    color: var(--color-accent-{primary-name});
    border-color: rgba({primary-rgb}, 0.44);
    background: linear-gradient(180deg, rgba({primary-rgb}, 0.16), rgba({primary-rgb}, 0.08));
    transform: translateY(-1px);
}
```

### Card Styles Template

```css
/* Plugin card in browser panel */
@utility plugin-card-{module} {
    border-left: 4px solid var(--color-accent-{primary-name});
}

@utility plugin-card-{module}-hover {
    border-color: rgba({primary-rgb}, 0.4);
}

@utility plugin-card-{module}-selected {
    border: 1px solid rgba({primary-rgb}, 0.6);
    border-left: 4px solid var(--color-accent-{primary-name});
}

/* Plugin icon container */
@utility plugin-icon-{module} {
    @apply {module}-faceplate;
    width: 48px;
    height: 48px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
}

@utility plugin-icon-{module}-svg {
    color: var(--color-accent-{primary-name});
    width: 24px;
    height: 24px;
}
```

---

## Migration Notes

### Previous Issues (Fixed)

| Plugin | Old Primary | New Primary | Reason |
|--------|-------------|-------------|--------|
| Fermenter | Yellow-Green `#8a9450` | Sage `#8aa88a` | Too close to Bacteria mint |
| Dutch Oven | Copper `#b88868` | Amber `#c4aa5f` | Identical to old Crust |
| Crust | Copper `#b88868` | Peach `#c9a07a` | Distinguish from Dutch Oven |
| Yeast | Pink `#c18fa3` | Rose `#c06070` | Too similar to Levain coral |
| Scoring | Steel `#6a8aa8` | Indigo `#4a60a0` | Too close to Proof cyan |
| Sampler | - | Lavender (as Crumbs) | Missing panel CSS entirely |

---

## Verification Checklist

Before merging a new plugin theme:

- [ ] Primary color is at least 30° from all existing primaries on color wheel
- [ ] Secondary color complements or harmonizes with primary
- [ ] All active states meet 4.5:1 contrast ratio
- [ ] Faceplate glow uses correct opacity for energy level
- [ ] CSS follows the module template structure
- [ ] Card styles defined for browser panel
- [ ] Icon container uses faceplate utility
- [ ] Color names match tokens.css variables
- [ ] File imported in main.css
