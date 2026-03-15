# Forms

This guide provides a step-by-step process for building robust, type-safe forms with the Form component (using [React Hook Form](https://react-hook-form.com/) ) and [Zod](https://zod.dev) for schema validation.

> **Note:** This is our current standard for building forms. The codebase contains legacy forms using manual state management (`useState`, `useReducer`, or custom hooks). When building new forms or refactoring existing ones, follow the patterns described in this guide.

---

## How to build a form

Our forms follow a schema-driven approach that ensures consistency, type safety, and excellent performance. The process involves two main steps.

### 1. Define the validation schema

First, define a Zod schema to specify the shape and validation rules for your form data. This schema is the single source of truth for validation.

```typescript
// Library/presentations/helpers/getLibraryCreationFormSchema.ts

export const getLibraryCreationFormSchema = (t: TFunction) => {
    return z.object({
        name: z
            .string()
            .trim()
            .min(1, t('CreateLibrary_form_nameRequired'))
            .min(3, t('CreateLibrary_form_nameMinLength'))
            .max(50, t('CreateLibrary_form_nameMaxLength')),
        type: z.enum(['design', 'brand', 'content'], {
            errorMap: () => ({ message: t('CreateLibrary_form_typeRequired') }),
        }),
        budget: z.number().min(0, t('CreateLibrary_form_budgetMinimum')).nullish(),
    });
};

export type LibraryCreationFormData = z.infer<ReturnType<typeof getLibraryCreationFormSchema>>;
```

### 2. Implement the form component

Use the `<Form />` component wrapper to build your form UI. The `<Form />` component handles all React Hook Form setup internally, including schema validation, form state management, and submission handling.

```tsx
// Library/presentations/views/CreateLibraryDialogContent.tsx

import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';
import { FormDropdown } from 'Common/Form/Dropdown/Dropdown';

type CreateLibraryDialogContentProps = {
    brandId: number;
    closeDialog: () => void;
};

export const CreateLibraryDialogContent = ({ brandId, closeDialog }: CreateLibraryDialogContentProps) => {
    const { t } = useTranslation();
    const { createLibrary, isPending } = useCreateLibrary();

    const handleCreateLibrarySubmit = async (formData: LibraryCreationFormData) => {
        await createLibrary({
            name: formData.name,
            type: formData.type,
            brandId,
        });
        closeDialog();
    };

    return (
        <Dialog.Content>
            <Dialog.Header>{t('CreateLibrary_dialogTitle')}</Dialog.Header>
            <Form
                id="library-creation-form"
                schema={getLibraryCreationFormSchema(t)}
                initialValues={{
                    name: '',
                    type: undefined,
                    budget: null,
                }}
                onSubmit={handleCreateLibrarySubmit}
            >
                <Dialog.Body>
                    <div className="tw-flex tw-flex-col tw-gap-2">
                        <FormTextInput
                            name="name"
                            label={{ children: t('CreateLibrary_form_libraryName'), required: true }}
                        />
                    </div>
                    <div className="tw-flex tw-flex-col tw-gap-2">
                        <FormDropdown
                            name="type"
                            label={{ children: t('CreateLibrary_form_libraryType'), required: true }}
                            options={[
                                { label: t('CreateLibrary_form_typeDesign'), value: 'design' },
                                { label: t('CreateLibrary_form_typeBrand'), value: 'brand' },
                                { label: t('CreateLibrary_form_typeContent'), value: 'content' },
                            ]}
                        />
                    </div>
                </Dialog.Body>
                <Dialog.Footer>
                    <Button type="button" onClick={closeDialog} disabled={isPending}>
                        {t('Form_cancel')}
                    </Button>
                    <Button type="submit" form="library-creation-form" disabled={isPending}>
                        {t('CreateLibrary_form_submit')}
                    </Button>
                </Dialog.Footer>
            </Form>
        </Dialog.Content>
    );
};
```

The `<Form />` component provides:

- **Automatic schema validation** via the `schema` prop
- **Form state management** without explicit `useForm` hook
- **Built-in form context** for child components
- **Integrated form field components** like `FormTextInput`, `FormSwitch`, etc.

It is critical to delegate complex submission and business logic to use cases called from your submission handler, rather than placing that logic directly inside the component.

---

## Further guidance and patterns

The following sections provide additional details, advanced patterns, and best practices for building forms.

### Form architecture principles

- **[React Hook Form](https://react-hook-form.com/)**: Manages form state and performance.
- **[Zod](https://zod.dev)**: Provides schema validation and type safety (Zod is the only supported validation library).
- **TypeScript integration**: Types are inferred directly from your Zod schema.

> **Note on React 19 form actions:** React 19 introduces native `<form action={fn}>`, `useActionState`, and `useFormStatus` APIs. Our `<Form />` wrapper + React Hook Form + Zod remains the standard for all forms because it provides schema-driven validation, integrated Fondue field components, and a consistent architecture. Do not use the native React 19 form action APIs directly.

### Advanced patterns

#### Accessing form methods

The `<Form />` component provides access to form methods via the function-as-children pattern. All methods from React Hook Form's `useForm` hook are available, along with a `submitForm` method for programmatic submission.

**Available methods:**

- `watch` - Subscribe to field changes
- `setValue` - Update field values programmatically
- `getValues` - Get current form values
- `reset` - Reset form to initial or provided values
- `resetField` - Reset a specific field
- `setError` - Set custom field errors
- `clearErrors` - Clear field errors
- `getFieldState` - Get field-specific state (error, isDirty, etc.)
- `formState` - Access form state (isValid, isSubmitting, errors, etc.)
- `control` - React Hook Form control object (for use with `useFieldArray`, `useController`, etc.)
- `submitForm` - Programmatically submit the form

#### Using `useFormContext` in nested components

For deeply nested components that need access to form methods without prop drilling, use the `useFormContext` hook. This hook provides the same form methods available through the function-as-children pattern.

```tsx
import { useFormContext } from 'Common/Form/Context/FormContext';

const NestedFormComponent = () => {
    const { setValue, watch } = useFormContext();
    const iconUrl = watch('icon.url');

    const handleIconChange = (newIcon) => {
        setValue('icon', newIcon);
    };

    return <div>{/* Component that interacts with form */}</div>;
};

// Parent form
export const ParentForm = () => {
    return (
        <Form schema={schema} onSubmit={handleSubmit}>
            <FormTextInput name="name" label={{ children: 'Name' }} />
            <NestedFormComponent />
            <Button type="submit">Submit</Button>
        </Form>
    );
};
```

**When to use:**

- Deeply nested components that need form access
- Custom form field components
- Extracting reusable form logic into separate components

**When to use function-as-children instead:**

- Top-level form logic
- Conditional rendering based on form values
- Simple forms where nesting isn't an issue

#### Conditional field rendering

For conditional field rendering based on form values, extract the conditional logic into a separate component that uses `useFormContext`. This ensures proper hook usage and component lifecycle management.

```tsx
import { useEffect } from 'react';
import { Form } from 'Common/Form/Form';
import { useFormContext } from 'Common/Form/Context/FormContext';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

export const UserRegistrationForm = () => {
    const handleSubmit = (formData: UserRegistrationFormData) => {
        // Handle submission
    };

    return (
        <Form schema={userRegistrationSchema} initialValues={{ userType: 'personal' }} onSubmit={handleSubmit}>
            <FormTextInput name="userType" label={{ children: 'User Type', required: true }} />

            <ConditionalCompanyFields />

            <Button type="submit">Register</Button>
        </Form>
    );
};

const ConditionalCompanyFields = () => {
    const { watch, setValue } = useFormContext<UserRegistrationFormData>();
    const userType = watch('userType');
    const showCompanyFields = userType === 'business';

    // Clear company fields when switching away from 'business'
    useEffect(() => {
        if (userType !== 'business') {
            setValue('companyName', '');
            setValue('companySize', undefined);
        }
    }, [userType, setValue]);

    if (!showCompanyFields) {
        return null;
    }

    return (
        <>
            <FormTextInput name="companyName" label={{ children: 'Company Name', required: true }} />
            <FormTextInput name="companySize" label={{ children: 'Company Size' }} />
        </>
    );
};
```

#### Dynamic form arrays (`useFieldArray`)

Use the `useFieldArray` hook to manage dynamic lists of inputs, such as adding multiple team members to a project. Extract the `control` prop from the `Form` component using the function-as-children pattern and pass it to `useFieldArray` at the component level.

```tsx
import { useFieldArray, type Control } from 'react-hook-form';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';
import { Button } from '@frontify/fondue/components';

type TeamMemberData = {
    name: string;
    email: string;
    role: string;
};

type TeamMembersFormData = {
    members: TeamMemberData[];
};

export const TeamMembersForm = () => {
    const handleSubmit = (formData: TeamMembersFormData) => {
        // Handle submission
    };

    return (
        <Form
            schema={teamMembersSchema}
            initialValues={{
                members: [{ name: '', email: '', role: 'member' }],
            }}
            onSubmit={handleSubmit}
        >
            {({ control }) => <TeamMembersFieldArray control={control} />}
        </Form>
    );
};

const TeamMembersFieldArray = ({ control }: { control: Control<TeamMembersFormData> }) => {
    const { fields, append, remove } = useFieldArray({
        control,
        name: 'members',
    });

    return (
        <>
            {fields.map((field, index) => (
                <div key={field.id} className="tw-flex tw-flex-col tw-gap-2">
                    <FormTextInput name={`members.${index}.name`} label={{ children: 'Name', required: true }} />
                    <FormTextInput name={`members.${index}.email`} label={{ children: 'Email', required: true }} />
                    <FormTextInput name={`members.${index}.role`} label={{ children: 'Role' }} />

                    {fields.length > 1 ? (
                        <Button type="button" onClick={() => remove(index)}>
                            Remove Member
                        </Button>
                    ) : null}
                </div>
            ))}

            <Button type="button" onClick={() => append({ name: '', email: '', role: 'member' })}>
                Add Member
            </Button>

            <Button type="submit">Save Team</Button>
        </>
    );
};
```

#### Complex validation

Use Zod's advanced features for complex validation scenarios like cross-field validation or conditional logic.

```typescript
const complexSchema = z
    .object({
        email: z.string().email('Please enter a valid email address'),
        confirmEmail: z.string().email(),
        age: z.number().min(18, 'Must be at least 18 years old'),
        terms: z.boolean().refine((val) => val === true, 'You must accept the terms'),
    })
    .refine((data) => data.email === data.confirmEmail, {
        message: 'Email addresses must match',
        path: ['confirmEmail'],
    });

// Conditional validation
const userSchema = z.discriminatedUnion('userType', [
    z.object({
        userType: z.literal('personal'),
        name: z.string().min(1),
    }),
    z.object({
        userType: z.literal('business'),
        companyName: z.string().min(1),
        businessId: z.string().min(1),
    }),
]);
```

### Server integration

Connect your form's submission handler to a TanStack Query mutation to process the data and handle server-side responses. For more details on this pattern, see the [data fetching](./data-fetching.md#modifying-data-with-mutations) guide.

```tsx
// Library/presentations/views/CreateLibraryDialogContent.tsx

import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';
import { FormDropdown } from 'Common/Form/Dropdown/Dropdown';

export const CreateLibraryDialogContent = ({ brandId, closeDialog }: CreateLibraryDialogContentProps) => {
    const { t } = useTranslation();
    const { createLibrary, isPending } = useCreateLibrary();

    const handleCreateLibrarySubmit = async (formData: LibraryCreationFormData) => {
        await createLibrary({
            name: formData.name,
            type: formData.type,
            brandId,
        });

        closeDialog();
    };

    return (
        <Dialog.Content showUnderlay padding="comfortable">
            <Dialog.Header>
                <Dialog.Title>
                    <Heading size="x-large">{t('CreateLibrary_dialogTitle')}</Heading>
                </Dialog.Title>
            </Dialog.Header>

            <Form
                id="library-creation-form"
                schema={getLibraryCreationFormSchema(t)}
                initialValues={{
                    name: '',
                    type: undefined,
                    budget: null,
                }}
                onSubmit={handleCreateLibrarySubmit}
            >
                <Dialog.Body>
                    <FormTextInput
                        name="name"
                        label={{ children: t('CreateLibrary_form_libraryName'), required: true }}
                    />
                    <FormDropdown
                        name="type"
                        label={{ children: t('CreateLibrary_form_libraryType'), required: true }}
                        options={[
                            { label: t('CreateLibrary_form_typeDesign'), value: 'design' },
                            { label: t('CreateLibrary_form_typeBrand'), value: 'brand' },
                            { label: t('CreateLibrary_form_typeContent'), value: 'content' },
                        ]}
                    />
                </Dialog.Body>

                <Dialog.Footer>
                    <Button type="button" emphasis="default" disabled={isPending} onClick={closeDialog}>
                        {t('Form_cancel')}
                    </Button>
                    <Button type="submit" form="library-creation-form" disabled={isPending}>
                        {t('CreateLibrary_form_submit')}
                    </Button>
                </Dialog.Footer>
            </Form>
        </Dialog.Content>
    );
};
```

### Best practices

#### Form field patterns

Always use our schema-driven approach with the `<Form />` component. Managing form state manually with `useState` is an anti-pattern that leads to boilerplate and bugs.

```tsx
import { type FormEvent, useState } from 'react';

// ❌ Bad: Managing form state manually
export const ManualForm = () => {
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (!name) {
            setError('Name required');
            return;
        }
        // ... submit
    };
    return (
        <form onSubmit={onSubmit}>
            <input value={name} onChange={(event) => setName(event.target.value)} />
            {error ? <span>{error}</span> : null}
        </form>
    );
};

// ✅ Good: Form component + Zod schema handle validation and state efficiently
import { Button } from '@frontify/fondue/components';
import * as z from 'zod';

import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

const schemaFormSchema = z.object({ name: z.string().min(1, 'Name required') });

export const SchemaForm = () => {
    const handleSubmit = (data: z.infer<typeof schemaFormSchema>) => {
        // ... submit
    };

    return (
        <Form schema={schemaFormSchema} onSubmit={handleSubmit}>
            <FormTextInput name="name" label={{ children: 'Name', required: true }} />
            <Button type="submit">Submit</Button>
        </Form>
    );
};
```

#### Using integrated form field components

The `<Form />` component ecosystem provides integrated field components that automatically handle errors, labels, and validation. Use these components for consistency and reduced boilerplate.

```tsx
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';
import { FormSwitch } from 'Common/Form/Switch/Switch';

// ✅ Integrated form fields automatically show errors
<Form schema={schema} onSubmit={handleSubmit}>
    <FormTextInput
        name="name"
        label={{ children: t('Form_field_name'), required: true }}
        placeholder={t('Form_field_namePlaceholder')}
    />
    <FormSwitch name="enableFeature" label={t('Form_field_enableFeature')} />
</Form>;
```

Available integrated form components:

- `FormTextInput` - Text inputs with validation
- `FormSwitch` - Toggle switches
- `FormCheckbox` - Single checkboxes
- `FormChecklist` - Multiple checkboxes
- `FormGroupedCheckbox` - Grouped checkboxes with hierarchy
- `FormDropdown` - Dropdown select
- `FormMultiSelect` - Multi-select dropdown
- `FormColorPicker` - Color picker input
- `FormTagInput` - Tag input field
- `FormSegmentedControls` - Segmented control buttons
- `FormRichTextEditor` - Rich text editor
- `FormLegacyTextarea` - Textarea input

#### Validation timing and field change events

The `<Form />` component's validation behavior depends on whether you provide the `onValidFieldChange` prop:

**Without `onValidFieldChange` (default):**

- Validation runs **only on form submission**
- No validation occurs during field changes
- Errors are displayed only after submit attempts

**With `onValidFieldChange`:**

- Validation runs on **every field change** (debounced)
- The callback is **only called when the field value is valid**
- Useful for real-time validation feedback and dependent field updates

```tsx
// Submit-only validation (default)
<Form schema={schema} onSubmit={handleSubmit}>
    {/* Validation only runs when form is submitted */}
</Form>;

// Field-level validation with onValidFieldChange
// Callback receives: (fieldName: string, value: unknown, formState: FormState)
// formState includes: isDirty, isValid, isSubmitting, errors, etc.
const handleValidFieldChange = (fieldName, value, formState) => {
    // Called ONLY when a field changes AND passes validation
    // This will NOT be called if the field value is invalid
    console.log(`${fieldName} changed to valid value:`, value);
    console.log('Form is valid:', formState.isValid);
};

<Form
    schema={schema}
    onSubmit={handleSubmit}
    onValidFieldChange={handleValidFieldChange}
    debounceInMs={500} // Debounce validation (default: 500ms)
>
    {/* Validation runs on every field change (debounced) */}
</Form>;
```

#### Form component configuration options

The `<Form />` component accepts several configuration options:

```tsx
<Form
    // Submission
    onSubmit={handleSubmit} // Optional, defaults to no-op
    // Validation
    schema={zodSchema} // Zod schema for validation
    // Initial values
    initialValues={{ name: '', email: '' }}
    resetOnInitialValueChange // Reset form when initialValues change (default: true)
    // Field change handling
    onValidFieldChange={handleFieldChange} // Called when a field changes and is valid
    debounceInMs={500} // Debounce delay for field validation (default: 500ms)
    // Field visibility behavior
    keepHiddenValues={false} // Keep values of unmounted fields (default: false)
    // HTML attributes
    id="my-form"
    className="tw-flex tw-flex-col"
    data-test-id="my-form"
>
    {/* Form fields */}
</Form>
```

**Key options:**

- `onSubmit`: Submit handler function (optional, defaults to no-op if not provided)
- `schema`: Zod schema for validation (optional, but recommended)
- `initialValues`: Default form values
- `onValidFieldChange`: Called when a field changes and passes validation
- `keepHiddenValues`: Whether to preserve values of conditionally hidden fields (default: false)
- `resetOnInitialValueChange`: Automatically reset form when `initialValues` prop changes (default: true)
- `debounceInMs`: Debounce delay for `onValidFieldChange` validation (default: 500ms)
- `id`: HTML form id attribute
- `className`: CSS classes to apply to the form element
- `data-test-id`: Test identifier for automated testing

#### When to use the direct hook approach

While the `<Form />` component is recommended for most cases, you may need to use `useForm` directly in these scenarios:

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// Use direct hook when you need:
// 1. Fine-grained control over validation modes
// 2. Complex imperative form operations
// 3. Integration with non-standard form libraries

const myComplexFormSchema = z.object({
    email: z.string().email('Valid email required'),
    // ... other fields
});

const MyComplexForm = () => {
    const {
        register,
        handleSubmit,
        formState: { errors },
        trigger,
        setFocus,
    } = useForm({
        resolver: zodResolver(myComplexFormSchema),
        mode: 'onBlur', // Custom validation mode
        reValidateMode: 'onChange',
    });

    // Complex imperative operations
    const validateAndFocus = async () => {
        const isValid = await trigger('email');
        if (!isValid) {
            setFocus('email');
        }
    };

    const onSubmit = (data: z.infer<typeof myComplexFormSchema>) => {
        // Handle submission
    };

    return <form onSubmit={handleSubmit(onSubmit)}>{/* fields */}</form>;
};
```

For standard forms, prefer the `<Form />` component for cleaner code and better integration with our form field components.

---

## Migrating from legacy patterns

If you're updating an existing form that uses manual state management, follow this migration guide to adopt our current standard.

### From `useState` to `<Form />`

**Before: Manual state management**

```tsx
import { type FormEvent, useState } from 'react';
import { TextInput } from '@frontify/fondue/components';

export const LegacyForm = () => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        const newErrors: Record<string, string> = {};

        if (!name) newErrors.name = 'Name is required';
        if (!email) newErrors.email = 'Email is required';

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        // Submit logic
    };

    return (
        <form onSubmit={handleSubmit}>
            <TextInput
                value={name}
                onChange={(event) => setName(event.target.value)}
                status={errors.name ? 'error' : 'neutral'}
            />
            <TextInput
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                status={errors.email ? 'error' : 'neutral'}
            />
            <Button type="submit">Submit</Button>
        </form>
    );
};
```

**After: Schema-driven with `<Form />`**

```tsx
import { Button } from '@frontify/fondue/components';
import * as z from 'zod';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

const modernFormSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Valid email is required'),
});

type FormData = z.infer<typeof modernFormSchema>;

export const ModernForm = () => {
    const handleSubmit = (data: FormData) => {
        // Submit logic - data is already validated
    };

    return (
        <Form schema={modernFormSchema} initialValues={{ name: '', email: '' }} onSubmit={handleSubmit}>
            <FormTextInput name="name" label={{ children: 'Name', required: true }} />
            <FormTextInput name="email" label={{ children: 'Email', required: true }} />
            <Button type="submit">Submit</Button>
        </Form>
    );
};
```

**Benefits:**

- **Less code**: No manual state variables or error tracking
- **Type safety**: Form data types inferred from Zod schema
- **Better validation**: Centralized validation logic with clear error messages
- **Performance**: React Hook Form optimizes re-renders automatically

### From custom hooks to `<Form />`

**Before: Custom form hook**

```tsx
const useMyForm = () => {
    const [formData, setFormData] = useState({ name: '', email: '' });

    const updateField = (field: string, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    return { formData, updateField };
};

export const ComponentWithCustomHook = () => {
    const { formData, updateField } = useMyForm();
    // ...
};
```

**After: Use `<Form />` directly**

```tsx
import * as z from 'zod';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

const modernComponentSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
});

export const ModernComponent = () => {
    const handleSubmit = (data: z.infer<typeof modernComponentSchema>) => {
        // Submit logic
    };

    return (
        <Form schema={modernComponentSchema} initialValues={{ name: '', email: '' }} onSubmit={handleSubmit}>
            <FormTextInput name="name" label={{ children: 'Name' }} />
            <FormTextInput name="email" label={{ children: 'Email' }} />
        </Form>
    );
};
```

### Migration checklist

When migrating a form to the new pattern:

1. ✅ **Define a Zod schema** with validation rules
2. ✅ **Replace `useState` calls** with `<Form />` component
3. ✅ **Use integrated form components** (`FormTextInput`, `FormDropdown`, etc.)
4. ✅ **Remove manual error handling** - let the schema handle it
5. ✅ **Add translation keys** for all error messages
6. ✅ **Type the submit handler** with `z.infer<typeof schema>`
7. ✅ **Test validation** - ensure all edge cases are covered
8. ✅ **Update tests** to work with React Hook Form patterns
