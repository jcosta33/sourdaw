# Accessibility guidance

Detailed accessibility rules referenced from `ui-patterns/SKILL.md` rule 4
("Accessibility is part of component design"). A11y is not a post-processing step:
transport controls, faders, toggles, lists, dialogs, and dense surfaces must be designed
with semantics and keyboard behavior in mind.

## Use semantic controls first

Prefer real buttons, inputs, sliders, lists, dialogs, menus, and labels.

Only drop to custom semantics when native semantics genuinely cannot represent the
interaction.

## Toggle semantics must be explicit

Transport buttons, mute/solo controls, arm buttons, and similar controls must expose clear
pressed/selected/checked semantics.

## Keyboard support is required for core workflows

Core operations should remain keyboard-operable where feasible:

- transport
- dialogs
- track navigation
- selection movement
- common editor interactions

## Dense surfaces still need accessible support around them

Canvas/WebGL/WebGPU surfaces may own the pixels, but surrounding UI still needs to expose
accessible pathways, status, and controls where possible.
