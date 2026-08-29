/**
 * The titlebar row's drag-region contract, written once.
 *
 * On the desktop builds that row is the window's drag region: the window
 * manager takes a press on it as the start of a window move, and the renderer
 * reads a double-click on it as maximize/restore. Both halves have to exempt
 * the same elements — an element the stylesheet opts out but the handler does
 * not is one the user can click and still have the window respond.
 *
 * `main.css` cannot import a constant, so it repeats this selector;
 * `__tests__/titlebarDragRegion.spec.ts` fails when the two drift apart.
 */

/** The titlebar row itself, on whichever desktop chrome the shell runs. */
export const TITLEBAR_DRAG_REGION_SELECTOR =
    ':is(.desktop-titlebar-region--overlay, .desktop-titlebar-region--frameless)';

/**
 * What takes its clicks back from that region: the controls the platform
 * already knows are interactive, plus popup surfaces named by ARIA role. The
 * row hosts menus, listboxes and dialogs rendered inline whose rows and labels
 * are plain divs, and naming the surface covers everything inside it.
 */
export const TITLEBAR_NO_DRAG_SELECTOR = `${TITLEBAR_DRAG_REGION_SELECTOR} :is(a, button, input, label, select, textarea, [role='button'], [role='dialog'], [role='listbox'], [role='menu'], [tabindex])`;
