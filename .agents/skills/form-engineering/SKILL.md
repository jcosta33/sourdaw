---
name: form-engineering
description: >
    Use when creating or updating inputs and forms. Enforces React Hook Form + Zod schemas + Shadcn UI form components instead of manual state management. Apply even when the user says "input", "form", "validation", "settings dialog", "rename", "tempo", or "controlled input".
---

## Setup

```tsx
// src/modules/Transport/presentations/components/TempoForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const tempoSchema = z.object({
    bpm: z
        .number({ invalid_type_error: 'BPM must be a number' })
        .min(20, 'Minimum tempo is 20 BPM')
        .max(300, 'Maximum tempo is 300 BPM'),
});

type TempoFormData = z.infer<typeof tempoSchema>;

export const TempoForm = ({ currentBpm, onSubmit }: { currentBpm: number; onSubmit: (data: TempoFormData) => void }) => {
    const form = useForm<TempoFormData>({
        resolver: zodResolver(tempoSchema),
        defaultValues: { bpm: currentBpm },
    });

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-center gap-2">
                <FormField
                    control={form.control}
                    name="bpm"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Tempo</FormLabel>
                            <FormControl>
                                <Input
                                    type="number"
                                    {...field}
                                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                                    className="w-24"
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit">Set</Button>
            </form>
        </Form>
    );
};
```

Install: `pnpm add react-hook-form @hookform/resolvers zod`. Shadcn UI form components are generated with `pnpm dlx shadcn@latest add form`.

## Core Patterns

### Inline track rename form

```tsx
// src/modules/Track/presentations/components/TrackNameInput.tsx
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const trackNameSchema = z.object({
    name: z.string().min(1, 'Track name cannot be empty').max(64, 'Track name is too long'),
});

type TrackNameFormData = z.infer<typeof trackNameSchema>;

type TrackNameInputProps = {
    trackId: string;
    currentName: string;
    onRename: (data: TrackNameFormData & { trackId: string }) => void;
    onCancel: () => void;
};

export const TrackNameInput = ({ trackId, currentName, onRename, onCancel }: TrackNameInputProps) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const form = useForm<TrackNameFormData>({
        resolver: zodResolver(trackNameSchema),
        defaultValues: { name: currentName },
    });

    useEffect(() => {
        inputRef.current?.select();
    }, []);

    const handleSubmit = (data: TrackNameFormData) => {
        onRename({ ...data, trackId });
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)}>
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input
                                    {...field}
                                    ref={inputRef}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                            onCancel();
                                        }
                                    }}
                                    onBlur={form.handleSubmit(handleSubmit)}
                                    className="h-6 text-sm"
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </form>
        </Form>
    );
};
```

### Project settings dialog with multiple fields

```tsx
// src/modules/Project/presentations/components/ProjectSettingsDialog.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSaveProjectSettings } from '../hooks/useSaveProjectSettings';

const projectSettingsSchema = z.object({
    name: z.string().min(1, 'Project name is required').max(128),
    bpm: z.number().min(20).max(300),
    sampleRate: z.union([
        z.literal(44100),
        z.literal(48000),
        z.literal(96000),
    ]),
});

type ProjectSettingsData = z.infer<typeof projectSettingsSchema>;

type ProjectSettingsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultValues: ProjectSettingsData;
};

export const ProjectSettingsDialog = ({ open, onOpenChange, defaultValues }: ProjectSettingsDialogProps) => {
    const { saveSettings } = useSaveProjectSettings();

    const form = useForm<ProjectSettingsData>({
        resolver: zodResolver(projectSettingsSchema),
        defaultValues,
    });

    const handleSubmit = async (data: ProjectSettingsData) => {
        await saveSettings(data);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Project Settings</DialogTitle>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Project Name</FormLabel>
                                    <FormControl>
                                        <Input {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="bpm"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Tempo (BPM)</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            {...field}
                                            onChange={(e) => field.onChange(e.target.valueAsNumber)}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={form.formState.isSubmitting}>
                                Save
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};
```

### useFormContext for nested fields

```tsx
// src/modules/Project/presentations/components/SampleRateField.tsx
import { useFormContext } from 'react-hook-form';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Used inside a parent <Form> provider — no need to pass control as a prop
export const SampleRateField = () => {
    const { control } = useFormContext<{ sampleRate: 44100 | 48000 | 96000 }>();

    return (
        <FormField
            control={control}
            name="sampleRate"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Sample Rate</FormLabel>
                    <Select
                        onValueChange={(value) => field.onChange(Number(value))}
                        defaultValue={String(field.value)}
                    >
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Select sample rate" />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="44100">44,100 Hz</SelectItem>
                            <SelectItem value="48000">48,000 Hz</SelectItem>
                            <SelectItem value="96000">96,000 Hz</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
};
```

Use `useFormContext` in nested components to access the parent form without prop drilling. The parent must render `<Form {...form}>` which provides the context.

## Common Mistakes

### CRITICAL Managing form state manually with useState

Wrong:

```tsx
// src/modules/Transport/presentations/components/TempoInput.tsx
import { useState, type FormEvent } from 'react';

export const TempoInput = ({ onSet }: { onSet: (bpm: number) => void }) => {
    const [bpm, setBpm] = useState(120);

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (bpm < 20 || bpm > 300) return;
        onSet(bpm);
    };

    return (
        <form onSubmit={handleSubmit}>
            <input type="number" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
            <button type="submit">Set</button>
        </form>
    );
};
```

Correct:

```tsx
// src/modules/Transport/presentations/components/TempoInput.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const schema = z.object({ bpm: z.number().min(20).max(300) });

export const TempoInput = ({ onSet }: { onSet: (bpm: number) => void }) => {
    const form = useForm({ resolver: zodResolver(schema), defaultValues: { bpm: 120 } });

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(({ bpm }) => onSet(bpm))}>
                <FormField
                    control={form.control}
                    name="bpm"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input type="number" {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit">Set</Button>
            </form>
        </Form>
    );
};
```

Manual `useState` for form fields causes boilerplate, missing validation, and excessive re-renders. Always use React Hook Form + Zod.

### CRITICAL Skipping Zod schema validation

Wrong:

```tsx
const form = useForm({ defaultValues: { bpm: 120 } });
// no resolver — no validation
```

Correct:

```tsx
const schema = z.object({ bpm: z.number().min(20).max(300) });
const form = useForm({ resolver: zodResolver(schema), defaultValues: { bpm: 120 } });
```

Every form must have a Zod schema passed via `zodResolver`. Schema validation is the only reliable way to enforce constraints and generate typed, safe form data.

### HIGH Putting complex submission logic directly in the component

Wrong:

```tsx
export const ProjectSettingsDialog = () => {
    const form = useForm({ ... });

    const handleSubmit = async (data) => {
        const response = await fetch('/api/project/settings', {
            method: 'POST',
            body: JSON.stringify(data),
        });
        // manual cache updates, error handling...
    };
    // ...
};
```

Correct:

```tsx
import { useSaveProjectSettings } from '../hooks/useSaveProjectSettings';

export const ProjectSettingsDialog = () => {
    const { saveSettings } = useSaveProjectSettings();
    const form = useForm({ ... });

    const handleSubmit = async (data) => {
        await saveSettings(data);
    };
    // ...
};
```

Delegate mutation logic to a dedicated hook (typically wrapping a TanStack Query mutation). The component is responsible only for rendering and triggering the operation.

### HIGH Using raw HTML inputs instead of Shadcn form components

Wrong:

```tsx
<FormField
    control={form.control}
    name="name"
    render={({ field }) => (
        <input type="text" {...field} />
    )}
/>
```

Correct:

```tsx
<FormField
    control={form.control}
    name="name"
    render={({ field }) => (
        <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
                <Input {...field} />
            </FormControl>
            <FormMessage />
        </FormItem>
    )}
/>
```

Always use the Shadcn `FormItem`, `FormLabel`, `FormControl`, and `FormMessage` wrappers. They wire up accessibility attributes (id, aria-describedby, aria-invalid) automatically based on field state.
