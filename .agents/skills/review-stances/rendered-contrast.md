# Rendered text contrast

## Standing probe

When a component selects foreground color through a token class and declares its own background
gradient, render the component in each active variant. Read the class actually applied to its text,
resolve that class through the current design tokens, and parse every declared gradient color stop,
including color mixes. Calculate WCAG sRGB relative luminance contrast for each foreground/background
pair. Require the product's stated contrast threshold at every stop. Do not hardcode the old token
values or infer that the class name itself proves legibility. A useful regression mutation changes the
foreground back to the failing state token and reruns the named contrast spec.

## Escape: red latch text was too dim on its active surface

On 2026-10-26, issue #4627 identified that active red `LatchButton` text used
`--color-state-record: #c45040`, while its active gradient used `--surface-default: #13110f`, an
intermediate sRGB mix, and `--surface-raised: #1c1917`. The text yielded 4.098:1 against the first
stop, below this product's 4.5:1 foreground contract. The final stop was lower still. The same red
class drove the record glow, but that glow was not the foreground text and did not provide a
contrast guarantee. The fix selects the existing `text-accent-red` foreground token and retains the
record-colored glow.

The exact palette change was introduced by commit
`5aae4754d6926d3a3b847ef86bed4882bf77d98b`; the `LatchButton` red text mapping predates it at
`d9c1c4ca43d400cebe9008c3e21bdc85ab97b136`. GitHub's REST commit-to-pull-request association for
the palette commit returned no pull requests, so an introducing pull request or historical review
stance cannot be established from this checkout. The missed probe was active foreground contrast
against the component's declared gradient stops, separate from checking its state or glow styling.

The regression spec renders all five active variants, reads the foreground class and live token
values, reads the active gradient from the rendered button, resolves its declared stops, and checks
the contrast ratio at each stop. Changing the red class back to `text-state-record` must fail at
4.098:1 on the first stop.
