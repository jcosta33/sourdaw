# Accessibility (a11y)

This guide provides a process for building accessible user interfaces that conform to [WCAG 2.x AA](https://www.w3.org/WAI/standards-guidelines/wcag/) and [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/).

## How to build an accessible component

### 1. Understand the core principles

Before writing code, familiarize yourself with the foundational principles of accessibility. These concepts guide all implementation decisions.

- **Semantic HTML**: Use elements that match their intended purpose (`button`, `a`, `nav`, `header`, `main`, `form`).
- **Accessible Names**: Provide clear, descriptive names for all interactive and media elements.
- **Keyboard Operability**: Ensure every interactive element can be reached and operated using only the keyboard.
- **Sufficient Contrast**: Maintain proper color contrast and do not rely on color alone to convey information.
- **Progressive Enhancement**: Build on a resilient HTML foundation.

### 2. Implement with accessibility in mind

#### Prefer Shadcn UI components

Your first and best option is to use Shadcn UI components (built on Radix UI primitives). They are designed to be accessible out of the box, handling complex interactions like keyboard handling, ARIA roles, focus management, and announcements.

```tsx
// Project/presentations/components/ProjectSettingsDialog.tsx
import { type ReactElement } from 'react';

export const ProjectSettingsDialog = (): ReactElement => {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline">Project Settings</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Project Settings</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="bpm" className="text-right">
                            Tempo (BPM)
                        </Label>
                        <Input id="bpm" type="number" defaultValue="120" className="col-span-3" />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit">Save changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
```

Why: Shadcn UI manages focus trapping, escape/underlay behavior, roles, and aria attributes for dialogs and many other components. **Using Shadcn is the best way to avoid common pitfalls like forgetting focus management or using non-semantic elements like a `<div>` for a button.**

#### Follow authoring guidance for custom elements

If a Shadcn component is not available, you must manually ensure your custom components are accessible by following these guidelines.

- ✅ **Labels**: Always associate a visible `<Label>` with form controls using `htmlFor`. Relying on the `placeholder` attribute is not a substitute for a proper label.
- ✅ **Buttons**: Ensure `type` is set. **Icon-only buttons require an `aria-label` to provide an accessible name.**
- ✅ **Links vs. buttons**: Use `<Link>` for navigation and `<Button>` for actions. Never use a `<div>` with an `onClick` handler to simulate a button, as it will be inaccessible to keyboard and screen reader users.
- ✅ **Images**: Provide meaningful `alt` text. Decorative images should have an empty `alt=""`.
- ✅ **Forms**: Bind error messages via `aria-describedby` and manage `aria-invalid`. For more detailed patterns, see the main [forms](./02-forms.md) guide.

```tsx
// Track/presentations/components/RemoveTrackButton.tsx
import { type ReactElement } from 'react';

export const RemoveTrackButton = (): ReactElement => {
    return (
        <Button aria-label="Remove track" variant="ghost" size="icon">
            <Trash2Icon className="h-4 w-4" aria-hidden="true" />
        </Button>
    );
};
```

#### Ensure proper keyboard and focus handling

- All interactive elements must be reachable via `Tab`/`Shift+Tab` and operable with `Enter`/`Space`.
- Focus must be visibly indicated and logically managed after UI changes (e.g., opening a dialog). It's critical to trap focus within modal dialogs and return focus to the trigger element when they close.
- In React 19, `ref` is a regular prop -- pass it directly to components that need imperative focus management without `forwardRef`.
- Provide visible focus styles (Shadcn + Tailwind classes).

#### Maintain color and contrast

- Meet WCAG AA contrast ratios for all text and UI controls.
- Do not use color as the sole means of conveying information.

#### Announce dynamic content changes

For content that updates without a page reload (like status messages, live chat updates, or form errors appearing), you must announce these changes to screen reader users. Use `aria-live` regions to mark areas of the page that will change dynamically. Set the value to `polite` for most cases, or `assertive` for urgent updates.

The `aria-atomic="true"` attribute ensures that the entire content of the region is announced as a whole, even if only a small part of it changes. This is crucial for notifications and status messages, as it provides the full context to the user instead of just announcing the changed words.

```tsx
// AiRuntime/presentations/components/AiStatusBanner.tsx
import { type ReactElement } from 'react';

type Message = {
    id: string;
    text: string;
};

type AiStatusBannerProps = {
    messages: Message[];
};

export const AiStatusBanner = ({ messages }: AiStatusBannerProps): ReactElement => {
    return (
        <div aria-live="polite" aria-atomic="true" className="text-sm text-text-secondary">
            {messages.map((msg) => {
                return <div key={msg.id}>{msg.text}</div>;
            })}
        </div>
    );
};
```

### 3. Verify your implementation

After building your component, verify its accessibility through a combination of automated and manual testing.

- **Automated Testing**: Use Testing Library queries that target accessible roles and names (`getByRole('button', { name: /save/i })`). Our ESLint rules will also catch common violations. See our [testing](./06-testing.md) guide for more on this.
- **Manual Testing**:
    - Exercise all keyboard navigation paths. Can you reach and operate everything without a mouse?
    - Use browser developer tools to inspect the accessibility tree.
    - Perform spot-checks with a screen reader.
    - Use Sourdaw dev tools

---

## Further guidance and reference

### When to build custom components

Always prefer using Shadcn. If a required pattern is missing:

- Start with semantic HTML as a base.
- Follow the official WAI-ARIA Authoring Practices for roles, states, and keyboard support.
- Ensure you provide proper focus management and that dynamic content updates are announced to screen readers.
- Propose the new component to the UI library for future reuse.

### Shadcn UI

- Shadcn docs: [ui.shadcn.com](https://ui.shadcn.com/)
