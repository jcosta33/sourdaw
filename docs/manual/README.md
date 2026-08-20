# Sourdaw User Manual

How to use Sourdaw: every panel, every device, every shortcut. This manual describes what the
application does and how to operate it. It does not describe how it is built.

> **Note**: For architecture and contribution documentation, see [the developer docs](../README.md).
> Different audience, different book.

## Start here

- [Concepts](./02-concepts.md) — the ideas the rest of the manual assumes

## Device reference

Organized by what a device does, not by its name.

**Dynamics** — [Gluten](./devices/07-gluten.md) (compressor), [Crust](./devices/08-crust.md) (limiter)

**EQ & Filter** — [Proof](./devices/10-proof.md) (mastering)

**Time & Space** — [Dutch Oven](./devices/09-dutch-oven.md) (reverb)

**Amp and distortion** — [Grinder](./devices/11-grinder.md) (guitar amp and cabinet)

## Conventions used in this manual

Sourdaw is in active development. Where a feature is incomplete, this manual says so at the point
you would otherwise be confused, using one of two markers.

> [!NOTE]
> **Alpha.** The feature works and does what this page describes, but it is incomplete and will
> change.

> [!WARNING]
> **Not yet active.** The control is on screen and remembers its value, but has no effect yet. The
> marker states exactly which cases are affected.

Anything with no marker works as written. Features with no usable entry point are left out entirely
rather than promised — this is a manual, not a roadmap.

## Reading a device page

Every device page follows the same shape, so you can skip to what you need:

- **At a glance** and **First moves** get you a result in under a minute.
- One section per panel section, in the order the panel presents them, each a table of
  **Control · Range · Default · What it does**.
- Notes under a table cover only controls where the label and range do not tell the whole story.
- **Meters and readouts**, **Presets**, and **Automation and control** close the page.

Ranges and defaults are the real ones. Where a control behaves differently depending on another
control, the table says which.

## Names

This manual uses the names printed on screen.

The devices are named after baking. The interface does not explain why, and neither does this
manual, so every device page states its category next to its name and the reference above is
grouped by what things do rather than what they are called. You will not have to know that Gluten
is a compressor to find a compressor.

Internal names occasionally surface where the interface has no say — inside a saved project file,
for instance. When the manual gains a glossary, those go there.
