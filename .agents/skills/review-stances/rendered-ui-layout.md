# Lesson library: rendered UI layout and disclosure

Standing probes for layout, space allocation and responsive disclosure in React chrome. A class or
state assertion on one pane cannot prove the rendered result; inspect the rendered viewports.

## Dock allocation must be judged on the rendered viewports (escaped via #4027)

Exercise the editor and the virtual keyboard together and inspect the rendered main and editor
viewports. Individual pane state or class assertions cannot prove that the remaining canvas stays
usable. The case must fail when the docked panes together leave the canvas unusable.

## A fixed-height status strip must hold at every UI scale (escaped via #4054)

Measure the effective CSS viewport at every admitted UI scale. Keep engine and active monitoring
states direct, and move optional metrics or actions through one React-owned disclosure. CSS-hidden
duplicate trees leave stale portals, focus and mutable DOM refs; a case that finds a second copy of
the hidden tree in the DOM fails this probe.

## A footer disclosure that owns a portaled menu must hand focus off safely (escaped via #4056)

Track the menu content ref in each responsive mode. On a mode change, both portals must close, and
focus is restored only when the active element belongs to the footer or that portal. Recheck focus
immediately before an asynchronous handoff and cancel it on cleanup. Choose an outside target
during the handoff: it must keep keyboard control. A restore that steals focus from the newly
chosen target fails this probe.

## A layout assertion must check the requested size and the allocated rectangle separately

An element's inline `style.height` (or flex basis) is the requested CSS size; its bounding rect is
what layout actually allocated, and flex can shrink a panel below its request. Assert both values,
each on its own: the requested value and the allocated bounding rect. A case that asserts only one
of them must fail this probe. Make a sibling push the panel below its request: a case asserting only
`style.height` or the flex basis stays green and must go red, and a case asserting only the rect
must go red when the request itself is changed.
