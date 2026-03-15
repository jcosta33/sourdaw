# Accessibility (a11y)

This guide provides a process for building accessible user interfaces that conform to [WCAG 2.x AA](https://www.w3.org/WAI/standards-guidelines/wcag/) and [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/). For more information on best practices, see [Frontify a11y](https://weare.frontify.com/document/2399).

## How to build an accessible component

### 1. Understand the core principles

Before writing code, familiarize yourself with the foundational principles of accessibility. These concepts guide all implementation decisions.

- **Semantic HTML**: Use elements that match their intended purpose (`button`, `a`, `nav`, `header`, `main`, `form`).
- **Accessible Names**: Provide clear, descriptive names for all interactive and media elements.
- **Keyboard Operability**: Ensure every interactive element can be reached and operated using only the keyboard.
- **Sufficient Contrast**: Maintain proper color contrast and do not rely on color alone to convey information.
- **Progressive Enhancement**: Build on a resilient HTML foundation.

### 2. Implement with accessibility in mind

#### Prefer Fondue components

Your first and best option is to use components from `@frontify/fondue/components`. They are designed to be accessible out of the box, handling complex interactions like keyboard handling, ARIA roles, focus management, and announcements.

```tsx
// Brand/presentations/components/CreateBrandDialog.tsx

export const CreateBrandDialog = () => (
    <Dialog.Root>
        <Dialog.Trigger>
            <Button>Create brand</Button>
        </Dialog.Trigger>
        <Dialog.Content showUnderlay padding="comfortable">
            <Dialog.Header>
                <Dialog.Title>Create brand</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
                <Label htmlFor="name" required>
                    Name
                </Label>
                <TextInput id="name" placeholder="Brand name" />
            </Dialog.Body>
            <Dialog.Footer>
                <Button type="submit">Create</Button>
            </Dialog.Footer>
        </Dialog.Content>
    </Dialog.Root>
);
```

Why: Fondue manages focus trapping, escape/underlay behavior, roles, and aria attributes for dialogs and many other components. **Using Fondue is the best way to avoid common pitfalls like forgetting focus management or using non-semantic elements like a `<div>` for a button.**

#### Follow authoring guidance for custom elements

If a Fondue component is not available, you must manually ensure your custom components are accessible by following these guidelines.

- ✅ **Labels**: Always associate a visible `<Label>` with form controls using `htmlFor`. Relying on the `placeholder` attribute is not a substitute for a proper label.
- ✅ **Buttons**: Ensure `type` is set. **Icon-only buttons require an `aria-label` to provide an accessible name.**
- ✅ **Links vs. buttons**: Use `<Link>` for navigation and `<Button>` for actions. Never use a `<div>` with an `onClick` handler to simulate a button, as it will be inaccessible to keyboard and screen reader users.
- ✅ **Images**: Provide meaningful `alt` text. Decorative images should have an empty `alt=""`.
- ✅ **Forms**: Bind error messages via `aria-describedby` and manage `aria-invalid`. For more detailed patterns, see the main [forms](./forms.md) guide.

```tsx
// Library/presentations/components/RemoveButton.tsx

export const RemoveButton = () => (
    <Button aria-label={t('LibraryList_remove')}>
        <IconTrashBin />
    </Button>
);
```

#### Ensure proper keyboard and focus handling

- All interactive elements must be reachable via `Tab`/`Shift+Tab` and operable with `Enter`/`Space`.
- Focus must be visibly indicated and logically managed after UI changes (e.g., opening a dialog). It's critical to trap focus within modal dialogs and return focus to the trigger element when they close.
- In React 19, `ref` is a regular prop -- pass it directly to components that need imperative focus management without `forwardRef`.
- Provide visible focus styles (Fondue + Tailwind classes).

#### Maintain color and contrast

- Meet WCAG AA contrast ratios for all text and UI controls.
- Do not use color as the sole means of conveying information.

#### Announce dynamic content changes

For content that updates without a page reload (like status messages, live chat updates, or form errors appearing), you must announce these changes to screen reader users. Use `aria-live` regions to mark areas of the page that will change dynamically. Set the value to `polite` for most cases, or `assertive` for urgent updates.

The `aria-atomic="true"` attribute ensures that the entire content of the region is announced as a whole, even if only a small part of it changes. This is crucial for notifications and status messages, as it provides the full context to the user instead of just announcing the changed words.

```tsx
// Common/presentations/components/Notifications.tsx

const Notifications = ({ messages }) => {
    return (
        <div aria-live="polite" aria-atomic="true">
            {messages.map((msg) => (
                <div key={msg.id}>{msg.text}</div>
            ))}
        </div>
    );
};
```

### 3. Verify your implementation

After building your component, verify its accessibility through a combination of automated and manual testing.

- **Automated Testing**: Use Testing Library queries that target accessible roles and names (`getByRole('button', { name: /save/i })`). Our ESLint rules will also catch common violations. See our [testing](./testing.md) guide for more on this.
- **Manual Testing**:
    - Exercise all keyboard navigation paths. Can you reach and operate everything without a mouse?
    - Use browser developer tools to inspect the accessibility tree.
    - Perform spot-checks with a screen reader.
    - Use Frontify dev tools

---

## Further guidance and reference

### When to build custom components

Always prefer using Fondue. If a required pattern is missing:

- Start with semantic HTML as a base.
- Follow the official WAI-ARIA Authoring Practices for roles, states, and keyboard support.
- Ensure you provide proper focus management and that dynamic content updates are announced to screen readers.
- Propose the new component to the Fondue library for future reuse.

### Fondue

- Fondue docs: [fondue-components.frontify.com](https://fondue-components.frontify.com/)
- Fondue repo: [github.com/Frontify/fondue](https://github.com/Frontify/fondue)
