---
name: frontend-a11y
description: Apply when building or modifying UI components. Enforces WCAG 2.x AA compliance, semantic HTML, ARIA guidelines, and the required use of the Fondue design system (@frontify/fondue).
---

## Setup

```tsx
// Brand/presentations/components/CreateBrandDialog.tsx
import { type ReactElement } from 'react';
import { Dialog, Button, Label, TextInput } from '@frontify/fondue/components';

export const CreateBrandDialog = (): ReactElement => (
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

## Core Patterns

### Icon-only buttons with accessible names

```tsx
// Library/presentations/components/RemoveButton.tsx
import { type ReactElement } from 'react';
import { Button } from '@frontify/fondue/components';
import { IconTrashBin } from '@frontify/fondue/icons';
import { useTranslation } from 'react-i18next';

export const RemoveButton = (): ReactElement => {
    const { t } = useTranslation();
    return (
        <Button aria-label={t('LibraryList_remove')}>
            <IconTrashBin />
        </Button>
    );
};
```

Icon-only buttons require an `aria-label` to provide an accessible name.

### Announce dynamic content changes

```tsx
// Notification/presentations/components/Notifications.tsx
import { type ReactElement } from 'react';

type Message = {
    id: string;
    text: string;
};

export const Notifications = ({ messages }: { messages: Message[] }): ReactElement => (
    <div aria-live="polite" aria-atomic="true">
        {messages.map((msg) => (
            <div key={msg.id}>{msg.text}</div>
        ))}
    </div>
);
```

The `aria-atomic="true"` attribute ensures that the entire content of the region is announced as a whole, even if only a small part changes.

## Common Mistakes

### CRITICAL Simulating buttons with non-semantic elements

Wrong:

```tsx
// Common/presentations/components/SaveAction.tsx
import { type ReactElement } from 'react';

export const SaveAction = ({ onSave }: { onSave: () => void }): ReactElement => (
    <div onClick={onSave} className="tw-cursor-pointer">
        Save
    </div>
);
```

Correct:

```tsx
// Common/presentations/components/SaveAction.tsx
import { type ReactElement } from 'react';
import { Button } from '@frontify/fondue/components';

export const SaveAction = ({ onSave }: { onSave: () => void }): ReactElement => <Button onClick={onSave}>Save</Button>;
```

Never use a `<div>` with an `onClick` handler to simulate a button, as it will be inaccessible to keyboard and screen reader users.

Source: <root>/docs/accessibility.md

### HIGH Missing labels on form controls

Wrong:

```tsx
// Brand/presentations/components/NameInput.tsx
import { type ReactElement } from 'react';
import { TextInput } from '@frontify/fondue/components';

export const NameInput = (): ReactElement => <TextInput id="name" placeholder="Brand name" />;
```

Correct:

```tsx
// Brand/presentations/components/NameInput.tsx
import { type ReactElement } from 'react';
import { Label, TextInput } from '@frontify/fondue/components';

export const NameInput = (): ReactElement => (
    <>
        <Label htmlFor="name">Name</Label>
        <TextInput id="name" placeholder="Brand name" />
    </>
);
```

Relying on the `placeholder` attribute is not a substitute for a proper label bound via `htmlFor`.

Source: <root>/docs/accessibility.md

### HIGH Missing accessible names on icon-only buttons

Wrong:

```tsx
// Library/presentations/components/RemoveButton.tsx
import { type ReactElement } from 'react';
import { Button } from '@frontify/fondue/components';
import { IconTrashBin } from '@frontify/fondue/icons';

export const RemoveButton = (): ReactElement => (
    <Button>
        <IconTrashBin />
    </Button>
);
```

Correct:

```tsx
// Library/presentations/components/RemoveButton.tsx
import { type ReactElement } from 'react';
import { Button } from '@frontify/fondue/components';
import { IconTrashBin } from '@frontify/fondue/icons';
import { useTranslation } from 'react-i18next';

export const RemoveButton = (): ReactElement => {
    const { t } = useTranslation();

    return (
        <Button aria-label={t('LibraryList_remove')}>
            <IconTrashBin />
        </Button>
    );
};
```

Without an `aria-label`, screen readers cannot announce the action of an icon-only button.

Source: <root>/docs/accessibility.md
