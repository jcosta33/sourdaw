# Bug: GlutenCurve canvas gradient — `addColorStop` rejects `var(...)22`

## Status

**Open**

## Symptom

Console error when the Gluten curve canvas draws (e.g. Gluten panel visible):

```text
SyntaxError: Failed to execute 'addColorStop' on 'CanvasGradient': The value provided ('var(--color-accent-peach)22') could not be parsed as a color.
    at … (GlutenCurve.tsx:94:13)
```

## Why the bug happens

### 1. What the code assumes

`GlutenCurve` builds canvas paint colors by taking an **accent** string and appending **two hex digits** for alpha, mimicking **8-digit hex** `#rrggbbaa` in CSS:

- `` `${accent}22` `` → intended ≈ 13% opacity
- `` `${accent}00` `` → fully transparent

That only works if **`accent` is already a 6-digit hex** like `#c9a07a`, producing `#c9a07a22` — a valid [CSS color](https://drafts.csswg.org/css-color/) string that `CanvasGradient#addColorStop` can parse.

### 2. What `resolveToken` actually returns

`resolveToken` in `#/helpers/UI/resolveToken` does **not** turn custom properties into pixel colors. It does:

```ts
getComputedStyle(document.documentElement).getPropertyValue(property).trim();
```

For custom properties (`--*`), `getPropertyValue` returns the **declared value** for that property on `:root` — often still a **reference**, e.g. `var(--some-other-token)` or `oklch(...)`, **not** guaranteed to be `#rrggbb`. If the theme chains variables, **`accent` can be the literal string `var(--color-accent-peach)`** (or another unresolved form), not `#c9a07a`.

### 3. Why the browser throws

Canvas 2D uses the **CSS color parser** for `fillStyle`, `strokeStyle`, and `addColorStop`. The string **`var(--color-accent-peach)22`** is invalid: you cannot append `22` to a `var()` function and get a color. The parser fails → `SyntaxError: … could not be parsed as a color`.

So the failure is **string concatenation that only matches the hex+alpha pattern**, combined with **`resolveToken` not guaranteeing a hex (or `rgb`/`rgba`) string** suitable for canvas.

### 4. Why React shows an error boundary

The draw runs inside a **`useEffect`** on `<GlutenCurve>`. When `addColorStop` throws, the effect throws, React logs the component stack (`GlutenCurve` → `CatchBoundaryImpl`). That is a **consequence** of the canvas error, not a separate bug.

## Intended behavior

The haze gradient should use the accent color at ~13% and 0% opacity (from the `22` / `00` hex alpha suffix pattern), but only when the accent is expressed in a **canvas-parseable** form (`#rrggbbaa`, `rgba(...)`, etc.).

## Suggested fix directions (not implemented here)

1. Resolve to **computed `rgb` / `rgba`** before any canvas API (e.g. temporary element + `getComputedStyle`, or a shared helper).
2. If the value is still a `var(...)`, use the **fallback hex** for canvas-only drawing or resolve the variable in a context where the cascade applies.
3. Pass **`accentColor` from the parent** as an already-resolved hex/rgba when possible.

## Verification (when fixed)

- Open Gluten panel with default theming; no console error; haze renders.
- Regression: `accentColor` still works when given `#rrggbb` or `rgba(...)`.

## References

- `src/modules/Gluten/presentations/components/GlutenCurve.tsx` — `haze.addColorStop`, `` `${accent}22` `` / similar.
- `#/helpers/UI/resolveToken.ts` — `getPropertyValue` on `:root` (declared token value, not always a hex).
