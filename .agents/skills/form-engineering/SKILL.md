---
name: form-engineering
description: Use when creating or updating inputs / forms. Enforces the internal Form wrapper, React Hook Form, Zod schemas and integrated Fondue form fields instead of manual state management.
---

## Setup

```tsx
// Library/presentations/components/SchemaForm.tsx
import * as z from 'zod';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';
import { Button } from '@frontify/fondue/components';
import { useTranslation } from 'react-i18next';

const getLibrarySchema = (t: (key: string) => string) =>
    z.object({
        name: z.string().min(1, t('Form_error_nameRequired')),
    });

type LibraryFormData = z.infer<ReturnType<typeof getLibrarySchema>>;

export const SchemaForm = ({ onSubmit }: { onSubmit: (data: LibraryFormData) => void }) => {
    const { t } = useTranslation();

    return (
        <Form id="library-form" schema={getLibrarySchema(t)} onSubmit={onSubmit} initialValues={{ name: '' }}>
            <FormTextInput name="name" label={{ children: 'Name', required: true }} />
            <Button type="submit" form="library-form">
                Submit
            </Button>
        </Form>
    );
};
```

## Core patterns

### Accessing form context in nested components

```tsx
// User/presentations/components/ConditionalCompanyFields.tsx
import { useEffect } from 'react';
import { useFormContext } from 'Common/Form/Context/FormContext';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

export const ConditionalCompanyFields = () => {
    const { watch, setValue } = useFormContext<{ userType: string; companyName: string }>();
    const userType = watch('userType');

    useEffect(() => {
        if (userType !== 'business') {
            setValue('companyName', '');
        }
    }, [userType, setValue]);

    if (userType !== 'business') {
        return null;
    }

    return <FormTextInput name="companyName" label={{ children: 'Company Name', required: true }} />;
};
```

For deeply nested components that need access to form methods without prop drilling, use the `useFormContext` hook.

### Dynamic form arrays

```tsx
// Team/presentations/components/TeamMembersFieldArray.tsx
import { useFieldArray, type Control } from 'react-hook-form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';
import { Button } from '@frontify/fondue/components';

type TeamMembersFieldArrayProps = {
    control: Control<{ members: { name: string }[] }>;
};

export const TeamMembersFieldArray = ({ control }: TeamMembersFieldArrayProps) => {
    const { fields, append, remove } = useFieldArray({
        control,
        name: 'members',
    });

    return (
        <>
            {fields.map((field, index) => (
                <div key={field.id}>
                    <FormTextInput name={`members.${index}.name`} label={{ children: 'Name' }} />
                    <Button type="button" onClick={() => remove(index)}>
                        Remove
                    </Button>
                </div>
            ))}
            <Button type="button" onClick={() => append({ name: '' })}>
                Add Member
            </Button>
        </>
    );
};
```

Extract the `control` prop from the `<Form />` component using the function-as-children pattern and pass it to `useFieldArray`.

## Common mistakes

### CRITICAL Managing form state manually

Wrong:

```tsx
// Library/presentations/components/ManualForm.tsx
import { useState, type FormEvent } from 'react';
import { TextInput, Button } from '@frontify/fondue/components';

export const ManualForm = () => {
    const [name, setName] = useState('');

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        // manual submission logic
    };

    return (
        <form onSubmit={handleSubmit}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit">Submit</Button>
        </form>
    );
};
```

Correct:

```tsx
// Library/presentations/components/SchemaForm.tsx
import * as z from 'zod';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';
import { Button } from '@frontify/fondue/components';

const schema = z.object({ name: z.string().min(1) });

export const SchemaForm = () => {
    const handleSubmit = (data: z.infer<typeof schema>) => {};

    return (
        <Form schema={schema} initialValues={{ name: '' }} onSubmit={handleSubmit}>
            <FormTextInput name="name" label={{ children: 'Name' }} />
            <Button type="submit">Submit</Button>
        </Form>
    );
};
```

Managing form state manually with `useState` is an anti-pattern that leads to boilerplate, bugs, and excessive re-renders.

Source: <root>/docs/forms.md

### HIGH Using standard HTML inputs or unintegrated Fondue inputs

Wrong:

```tsx
// Library/presentations/components/MyForm.tsx
import { Form } from 'Common/Form/Form';
import { TextInput } from '@frontify/fondue/components';

export const MyForm = () => (
    <Form schema={schema} onSubmit={handleSubmit} initialValues={{ name: '' }}>
        <TextInput id="name" placeholder="Name" />
    </Form>
);
```

Correct:

```tsx
// Library/presentations/components/MyForm.tsx
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

export const MyForm = () => (
    <Form schema={schema} onSubmit={handleSubmit} initialValues={{ name: '' }}>
        <FormTextInput name="name" label={{ children: 'Name' }} placeholder="Name" />
    </Form>
);
```

The integrated components (like `FormTextInput`) automatically hook into React Hook Form to handle validation, errors, and labels. Standard components do not.

Source: <root>/docs/forms.md

### HIGH Putting complex business logic directly in the component

Wrong:

```tsx
// Library/presentations/components/CreateLibraryDialog.tsx
import { useCallback } from 'react';
import { Form } from 'Common/Form/Form';

export const CreateLibraryDialog = () => {
    const handleSubmit = useCallback(async (formData) => {
        const response = await fetch('/api/libraries', {
            method: 'POST',
            body: JSON.stringify(formData),
        });
        const data = await response.json();
        // handle UI updates manually
    }, []);

    return (
        <Form schema={schema} onSubmit={handleSubmit}>
            {/* ... */}
        </Form>
    );
};
```

Correct:

```tsx
// Library/presentations/components/CreateLibraryDialog.tsx
import { Form } from 'Common/Form/Form';
import { useCreateLibrary } from '../hooks/useCreateLibrary';

export const CreateLibraryDialog = () => {
    const { createLibrary } = useCreateLibrary();

    const handleSubmit = async (formData) => {
        await createLibrary(formData);
    };

    return (
        <Form schema={schema} onSubmit={handleSubmit}>
            {/* ... */}
        </Form>
    );
};
```

It is critical to delegate complex submission and business logic to use cases (often TanStack Query mutations) rather than placing that logic directly inside the component.

Source: <root>/docs/forms.md
