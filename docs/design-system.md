# Control and surface design system

Use the development-only [`/dev/control-gallery`](../src/routes/dev.control-gallery.tsx) route to inspect the live token source and the shared knob, fader, toggle, LED, meter, and display controls. The gallery uses local demo state and does not write project data.

## Tokens and surfaces

Start with the semantic custom properties in [`src/styles/tokens.css`](../src/styles/tokens.css). Apply the shared surface utilities from [`src/styles/utilities/daw-surfaces.css`](../src/styles/utilities/daw-surfaces.css) instead of introducing a new palette or one-off panel treatment.

Build a panel from a dark base plus restrained layered gradients. A slight warm top wash and thin brighter top edge make a raised surface read as lit from the upper left; keep the highlight low enough that it does not compete with labels or signal colors. `daw-panel-surface` already applies that top-edge lighting.

For an inset well, reverse the edge cues: darken the top edge, add an inner shadow, and move the faint light catch to the lower edge. `daw-inset-surface` provides that recessed treatment. Keep a display face subtly raised inside the cavity with `daw-display-surface`.

If a smooth gradient bands on a target display, add a very low-opacity monochrome noise layer above the gradient. Keep it static, clipped to the surface, and `pointer-events: none`; check contrast and rendering cost before applying it to animated or frequently repainted surfaces. There is no shared anti-banding noise utility today, so keep any authored texture local to the surface that needs it until a shared primitive is justified.

## Shared controls

Use the existing control components and their real states:

- `RotaryKnob` for rotary values and learn/mapping feedback.
- `Fader` for vertical level controls.
- `DawPluginToggle` for a pressed on/off action.
- `LED` for discrete status such as idle, signal, or record.
- `DawMeterBar` for a live level projection.
- `DawDisplaySurface` for readouts and focused status.

Keep shared controls presentation-only. Pass values and callbacks through props; stores, use cases, and project writes stay with the owning module. For shadcn components, adapt the existing primitive in `src/components/ui/` with a CVA variant and token-based styles. Do not create a parallel component for a visual variation or accumulate long utility-class overrides at each call site.

## Fader travel

For an amplitude fader with a unity point and headroom above it, opt into the shared audio mapping with `valueScale="gain"`, bounds that include `0` and `1`, and `unityValue={1}`. The continuous monotone curve places unity at 70% of the travel, keeps true silence at the bottom, and leaves the upper endpoint unchanged. Fader callbacks still report the original linear amplitude; gesture, keyboard, and project-write semantics do not change. The unconfigured generic `Fader` remains linear.

For an existing decibel-valued control, use `valueScale="decibels"` and keep its admitted `min` and `max`. For example, `-70…+6 dB` remains the range; do not change that minimum to manufacture the 70% marker. The control maps those decibel values through amplitude for display travel and announces the truthful dB value to assistive technology. The Master and track mixer faders store and emit linear amplitude from hard zero to `FADER_MAX_GAIN`; their visual unity marker sits at 70%. The microphone level fader stores linear gain from silence to unity, so its 0 dB mark sits at the top; it has no above-unity headroom.

## Gallery

Open `/dev/control-gallery` while running the development app. The route returns not found in production. Its token list is parsed from `tokens.css`, so the page stays aligned with the actual declarations rather than a second hand-maintained inventory.
