# Non-Architecture Documentation Review

This document contains the review and refinement of the non-architecture documentation files, strictly adhering to the DAW's stack, project conventions, and coding defaults.

### 1. `accessibility.md`

#### High-level verdict

Revise lightly.

#### What is strong

- Clear preference for Shadcn UI components out of the box.
- Strongly emphasizes correct ARIA patterns like `aria-live` and `aria-atomic` for dynamic screen reader announcements.
- Good breakdown of semantic HTML, focus handling, and testing strategies.

#### What is weak

- Code snippets lack full types (e.g., missing `import { type ReactElement } from 'react';` and explicit `ReactElement` return types) which `conventions.md` strictly mandates for all React components.
- The `AiStatusBanner` example uses an arrow-function component without proper typing and misses explicit block conditionals.

> **[VERIFIED — LEGITIMATE]** Confirmed in `docs/accessibility.md`: the `ProjectSettingsDialog` example uses `export const ProjectSettingsDialog = () => (` with no `: ReactElement` return type and no `import { type ReactElement }`. The `RemoveTrackButton` example similarly lacks the return type. The revised document correctly fixes both.

#### Recommended changes

- Add `ReactElement` return types to all component examples.
- Add `type-only` imports for React types.
- Fix `AiStatusBanner` to use explicit `return` blocks and explicit typing.

#### Revised document

````markdown
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
````

Why: Shadcn UI manages focus trapping, escape/underlay behavior, roles, and aria attributes for dialogs and many other components. **Using Shadcn is the best way to avoid common pitfalls like forgetting focus management or using non-semantic elements like a `<div>` for a button.**

#### Follow authoring guidance for custom elements

If a Shadcn component is not available, you must manually ensure your custom components are accessible by following these guidelines.

- ✅ **Labels**: Always associate a visible `<Label>` with form controls using `htmlFor`. Relying on the `placeholder` attribute is not a substitute for a proper label.
- ✅ **Buttons**: Ensure `type` is set. **Icon-only buttons require an `aria-label` to provide an accessible name.**
- ✅ **Links vs. buttons**: Use `<Link>` for navigation and `<Button>` for actions. Never use a `<div>` with an `onClick` handler to simulate a button, as it will be inaccessible to keyboard and screen reader users.
- ✅ **Images**: Provide meaningful `alt` text. Decorative images should have an empty `alt=""`.
- ✅ **Forms**: Bind error messages via `aria-describedby` and manage `aria-invalid`. For more detailed patterns, see the main [forms](./forms.md) guide.

```tsx
// Track/presentations/components/RemoveTrackButton.tsx
import { type ReactElement } from 'react';

export const RemoveTrackButton = (): ReactElement => {
    return (
        <Button aria-label={t('TrackControls_remove')} variant="ghost" size="icon">
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

- **Automated Testing**: Use Testing Library queries that target accessible roles and names (`getByRole('button', { name: /save/i })`). Our ESLint rules will also catch common violations. See our [testing](./testing.md) guide for more on this.
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

````

---

### 2. `events.md`

#### High-level verdict
Revise heavily.

#### What is strong
- Excellent conceptual explanation of domain events and cross-module decoupling.
- Clear naming conventions for events (past tense verbs).
- Addresses the stale closure trap for React hooks using `useEffectEvent` cleanly.

#### What is weak
- The examples use `export const ... = inject(...) => async function()` arrow-function closures for business logic, fundamentally violating the project default favoring the pure `function` keyword for use cases and transformers.
- Fails to use explicit block conditionals in legacy snippets and missing `ReactElement` types.
- The use case structure hides standard import-based testing behind a verbose dependency injection wrapper that hurts readability and scanning.

> **[VERIFIED — LEGITIMATE]** Confirmed in `docs/events.md`: `addTrack` is defined as `export const addTrack = inject({ createTrackApi, eventBus: EventBus }, ({ createTrackApi, eventBus }) => { return async function(...) {} })` and `handleTrackAdded` uses the same `inject()` pattern. `conventions.md` explicitly mandates the `function` keyword for use cases. The `inject()` wrapper makes the intent opaque and pairs poorly with `vi.mock`.
>
> **[MINOR CAVEAT — `useEffectEvent` version claim]** The revised document states `useEffectEvent` is "stable in React 19.2". `conventions.md` references React 19 but does not pin a sub-version. This specific sub-version claim cannot be verified from the codebase — flag it if the exact version matters for tooling decisions.

#### Recommended changes
- Rewrite all business-layer examples (`addTrack`, `handleTrackAdded`, `subscribeToFlagsFetchedEvent`) to use `export function`.
- Simplify external dependency retrieval (e.g. using standard imports or `Container.getInstance().get(...)` inside the functions) to eliminate the verbose `inject()` arrow-function wrappings.
- Clean up test examples to match standard `vi.mock()` patterns, which supports the `function` paradigm flawlessly.

#### Revised document
```markdown
# Events

Cross-module communication via domain events enables loose coupling. This guide explains how to define, publish, and subscribe to events. The base classes and APIs documented here match `src/helpers/Event/DomainEvent.ts` and `src/helpers/Event/EventBus.ts`. Event payloads often inform cache invalidations or UI updates in TanStack Query and [state management](./state-management.md).

## Core workflow

The process of using events follows three main steps:

1. **[Define an Event](#1-define-the-event)**: Create a strongly-typed event class that represents a specific domain occurrence.
2. **[Publish an Event](#2-publish-the-event)**: Emit the event from a use case after a business operation completes.
3. **[Subscribe to an Event](#3-subscribe-to-the-event)**: Listen for the event in other modules to trigger side effects, such as cache updates or analytics tracking.

---

## Inter-module communication

Domain events enable modules to communicate without direct dependencies:

```mermaid
graph TB
    A[Track Module] -->|TrackAddedEvent| B[Event Bus]
    B --> C[Mixer Module]
    B --> D[AudioEngine Module]
    B --> E[Timeline Module]

    style B fill:#e8f5e9
````

**Benefits:**

- **Loose coupling**: Modules remain independent and testable.
- **Framework agnostic**: Events work across different layers and technologies.
- **Type safety**: Strong typing prevents communication errors.
- **Asynchronous**: Non-blocking communication preserves performance.
- **Extensibility**: New modules can subscribe without modifying existing code.

## Event implementation

### 1. Define the event

Define domain events with a clear type structure and follow consistent naming conventions.

#### Event definition

```typescript
// src/helpers/Event/DomainEvent.ts
export abstract class DomainEvent<TPayload = unknown> {
    // readonly payload: TPayload
    // readonly timestamp: number (milliseconds)
}

// Track/events/TrackAddedEvent.ts
export class TrackAddedEvent extends DomainEvent<{ trackId: string; name: string; kind: 'audio' | 'midi' }> {
    constructor(payload: TrackAddedEvent['payload']) {
        super(payload);
    }
}
```

#### Event naming conventions

Follow consistent naming patterns for clarity, using verbs in their past tense form at the end of each event name:

```typescript
// ✅ Clear, descriptive names
export class TransportStartedEvent extends DomainEvent<TransportStartedPayload> {}
export class PluginLoadedEvent extends DomainEvent<PluginLoadedPayload> {}
export class TrackMutedEvent extends DomainEvent<TrackMutedPayload> {}

// ❌ Vague or unclear names
export class TransportEvent extends DomainEvent<TransportPayload> {}
export class UpdateEvent extends DomainEvent<UpdatePayload> {}
export class DataChangedEvent extends DomainEvent<DataPayload> {}
```

### 2. Publish the event

Publish events from business operations, typically at the end of a use case after the primary action has succeeded. Always prefer the `function` keyword for use cases in Sourdaw.

#### Publishing from use cases

```typescript
// Track/useCases/addTrack.ts
import { getEventBus } from '#/helpers/Event/EventBus';
import { createTrackApi } from '../repositories/createTrackApi';
import { TrackAddedEvent } from '../events/TrackAddedEvent';

export async function addTrack({ projectId, name, kind }: AddTrackInput): Promise<Track> {
    const track = await createTrackApi({ projectId, name, kind });

    // Publish domain event
    getEventBus().emit(
        new TrackAddedEvent({
            trackId: track.id,
            name: track.name,
            kind: track.kind,
        })
    );

    return track;
}
```

When publishing events, ensure the payload contains sufficient, immutable context so that subscribers can act on the event without needing to make additional API calls to fetch related data.

### 3. Subscribe to the event

Subscribe to events in other domains to trigger side effects, such as updating a cache, sending analytics, or starting a new workflow. Handlers should be kept small and delegate any long-running or complex work to use cases.

#### Cross-module event handling

```typescript
// Mixer/useCases/trackEventHandlers.ts
import { getQueryClient } from '#/helpers/QueryClient/getQueryClient';
import { getEventBus } from '#/helpers/Event/EventBus';
import { TrackAddedEvent } from '#/modules/Track/events/TrackAddedEvent';

export async function handleTrackAdded(event: TrackAddedEvent): Promise<void> {
    const queryClient = getQueryClient();

    // Invalidate the mixer tracks cache so the new track fader appears
    await queryClient.invalidateQueries({
        queryKey: ['mixer-tracks', event.payload.projectId],
    });
}

// Register event handlers
getEventBus().on(TrackAddedEvent, handleTrackAdded);
```

#### Event subscriptions inside React Hooks

> [!WARNING]
> You must handle closure staleness properly when binding to the Event Bus directly inside React hooks.

The following example illustrates the correct use of `useEffectEvent` (stable in React 19.2) to capture the latest callback without adding it to the Effect's dependency array, preventing unnecessary re-subscriptions:

```typescript
// FeatureFlags/presentations/hooks/useFlagSubscription.ts
import { useEffect, useEffectEvent } from 'react';
import { getEventBus } from '#/helpers/Event/EventBus';
import { FlagsFetchedEvent } from '../events/FlagsFetchedEvent';

export function useFlagSubscription(callback: () => void): void {
    const onFlagsFetched = useEffectEvent(callback);

    useEffect(() => {
        const unsubscribe = getEventBus().on(FlagsFetchedEvent, () => {
            onFlagsFetched();
        });

        return () => {
            unsubscribe();
        };
    }, []);
}
```

`useEffectEvent` always sees the latest `callback` value without causing the Effect to re-run. This eliminates stale closure bugs and avoids unnecessary teardown/setup cycles when the callback reference changes.

#### Event handler organization

Structure event handlers for maintainability:

```typescript
// AiRuntime/useCases/registerAiEventHandlers.ts

export function registerAiEventHandlers(): () => void {
    const eventBus = getEventBus();

    // Track activity events
    eventBus.on(TrackAddedEvent, syncAiTrackContext);
    eventBus.on(TrackRemovedEvent, removeAiTrackContext);

    // Transport interaction events
    eventBus.on(TransportStartedEvent, handleTransportPlay);
    eventBus.on(TransportStoppedEvent, handleTransportStop);

    return () => {
        eventBus.off(TrackAddedEvent, syncAiTrackContext);
        eventBus.off(TrackRemovedEvent, removeAiTrackContext);
        eventBus.off(TransportStartedEvent, handleTransportPlay);
        eventBus.off(TransportStoppedEvent, handleTransportStop);
    };
}
```

## Testing event flows

For a complete guide on our testing philosophy and patterns, see the [testing](./testing.md) documentation. The following examples show patterns specific to event-driven architectures.

### Event handler testing

Test event handlers in isolation using standard `vi.mock` replacements:

```typescript
// Mixer/useCases/trackEventHandlers.spec.ts
import { vi, describe, it, expect } from 'vitest';
import { handleTrackAdded } from './trackEventHandlers';
import { TrackAddedEvent } from '#/modules/Track/events/TrackAddedEvent';
import { getQueryClient } from '#/helpers/QueryClient/getQueryClient';

vi.mock('#/helpers/QueryClient/getQueryClient');

describe('handleTrackAdded', () => {
    it('invalidates mixer tracks query when a track is added', async () => {
        const invalidateQueriesMock = vi.fn();
        vi.mocked(getQueryClient).mockReturnValue({ invalidateQueries: invalidateQueriesMock } as any);

        const event = new TrackAddedEvent({
            projectId: 'proj-123',
            trackId: 'track-456',
            name: 'Bass',
            kind: 'audio',
        });

        await handleTrackAdded(event);

        expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
        expect(invalidateQueriesMock).toHaveBeenCalledWith({
            queryKey: ['mixer-tracks', 'proj-123'],
        });
    });
});
```

### Event publishing testing

Test event publishing from use cases:

```typescript
// Track/useCases/addTrack.spec.ts
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { addTrack } from './addTrack';
import { getEventBus } from '#/helpers/Event/EventBus';
import { createTrackApi } from '../repositories/createTrackApi';

vi.mock('../repositories/createTrackApi');
vi.mock('#/helpers/Event/EventBus');

describe('addTrack', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('publishes TrackAddedEvent after successful creation', async () => {
        const track = TrackDummy.create({ id: 'track-123', name: 'Vocals', kind: 'audio' });
        vi.mocked(createTrackApi).mockResolvedValue(track);

        const emitMock = vi.fn();
        vi.mocked(getEventBus).mockReturnValue({ emit: emitMock } as any);

        await addTrack({
            projectId: 'proj-123',
            name: 'Vocals',
            kind: 'audio',
        });

        expect(emitMock).toHaveBeenCalledWith(expect.any(TrackAddedEvent));
    });
});
```

### Event payload guidelines

Include sufficient context for event handlers to prevent round-trip fetching:

```typescript
// Project/events/ProjectSettingsChangedEvent.ts

// ✅ Event provides rich context, enabling subscribers to act without needing to perform additional lookups.
export class ProjectSettingsChangedEvent extends DomainEvent<{
    readonly projectId: string;
    readonly previousBpm: number;
    readonly newBpm: number;
    readonly sampleRate: number;
    readonly changedBy: string;
}> {}

// ❌ Minimal context requires additional lookups
export class ProjectSettingsChangedEvent extends DomainEvent<{
    readonly projectId: string;
    readonly newBpm: number;
}> {}
```

````

---

### 3. `forms.md`

#### High-level verdict
Revise lightly.

#### What is strong
- Explicitly rejects React 19 native action APIs in favor of schema-driven Zod/React Hook Form for superior form capability and validation.
- Extensive, high-quality examples covering array structures, conditional rendering, and legacy migrations.

#### What is weak
- Presentation components lack `ReactElement` return types.
- Zod schema generators (`getProjectSettingsFormSchema`) use arrow functions instead of the `function` keyword, which contradicts the business/domain-layer standard.

> **[VERIFIED — LEGITIMATE]** Confirmed in `docs/forms.md`: `getProjectSettingsFormSchema` is `export const getProjectSettingsFormSchema = (t: TFunction) => {` (arrow function). The `ProjectSettingsDialogContent` component uses `export const ProjectSettingsDialogContent = (...) => {` with no `: ReactElement` return type and no `import { type ReactElement }`. Both contradict `conventions.md`.

#### Recommended changes
- Add `import { type ReactElement } from 'react';` to all component examples.
- Replace `const Component = () => {` with `export const Component = (): ReactElement => {`.
- Convert Zod schema generator variables to pure `export function` declarations since validation rules belong to the domain layer.

#### Revised document
```markdown
# Forms

This guide provides a step-by-step process for building robust, type-safe forms with the Form component (using [React Hook Form](https://react-hook-form.com/) ) and [Zod](https://zod.dev) for schema validation.

> **Note:** This is our current standard for building forms. The codebase contains legacy forms using manual state management (`useState`, `useReducer`, or custom hooks). When building new forms or refactoring existing ones, follow the patterns described in this guide.

---

## How to build a form

Our forms follow a schema-driven approach that ensures consistency, type safety, and excellent performance. The process involves two main steps.

### 1. Define the validation schema

First, define a Zod schema to specify the shape and validation rules for your form data. This schema is the single source of truth for validation. Use the `function` keyword as this represents core domain logic.

```typescript
// Project/presentations/helpers/getProjectSettingsFormSchema.ts

export function getProjectSettingsFormSchema(t: TFunction) {
    return z.object({
        name: z
            .string()
            .trim()
            .min(1, t('ProjectSettings_form_nameRequired'))
            .min(3, t('ProjectSettings_form_nameMinLength'))
            .max(50, t('ProjectSettings_form_nameMaxLength')),
        sampleRate: z.enum(['44100', '48000', '96000'], {
            errorMap: () => ({ message: t('ProjectSettings_form_sampleRateRequired') }),
        }),
        bpm: z.number().min(20, t('ProjectSettings_form_bpmMinimum')).nullish(),
    });
}

export type ProjectSettingsFormData = z.infer<ReturnType<typeof getProjectSettingsFormSchema>>;
````

### 2. Implement the form component

Use the `<Form />` component wrapper to build your form UI. The `<Form />` component handles all React Hook Form setup internally, including schema validation, form state management, and submission handling.

```tsx
// Project/presentations/views/ProjectSettingsDialogContent.tsx
import { type ReactElement } from 'react';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';
import { FormDropdown } from 'Common/Form/Dropdown/Dropdown';

type ProjectSettingsDialogContentProps = {
    projectId: string;
    closeDialog: () => void;
};

export const ProjectSettingsDialogContent = ({
    projectId,
    closeDialog,
}: ProjectSettingsDialogContentProps): ReactElement => {
    const { t } = useTranslation();
    const { updateProjectSettings, isPending } = useUpdateProjectSettings();

    const handleProjectSettingsSubmit = async (formData: ProjectSettingsFormData) => {
        await updateProjectSettings({
            projectId,
            name: formData.name,
            sampleRate: formData.sampleRate,
            bpm: formData.bpm ?? 120,
        });
        closeDialog();
    };

    return (
        <Dialog.Content>
            <Dialog.Header>{t('ProjectSettings_dialogTitle')}</Dialog.Header>
            <Form
                id="project-settings-form"
                schema={getProjectSettingsFormSchema(t)}
                initialValues={{
                    name: '',
                    sampleRate: undefined,
                    bpm: 120,
                }}
                onSubmit={handleProjectSettingsSubmit}
            >
                <Dialog.Body>
                    <div className="tw-flex tw-flex-col tw-gap-2">
                        <FormTextInput
                            name="name"
                            label={{ children: t('ProjectSettings_form_projectName'), required: true }}
                        />
                    </div>
                    <div className="tw-flex tw-flex-col tw-gap-2">
                        <FormDropdown
                            name="sampleRate"
                            label={{ children: t('ProjectSettings_form_sampleRate'), required: true }}
                            options={[
                                { label: '44.1 kHz', value: '44100' },
                                { label: '48.0 kHz', value: '48000' },
                                { label: '96.0 kHz', value: '96000' },
                            ]}
                        />
                    </div>
                </Dialog.Body>
                <Dialog.Footer>
                    <Button type="button" onClick={closeDialog} disabled={isPending}>
                        {t('Form_cancel')}
                    </Button>
                    <Button type="submit" form="project-settings-form" disabled={isPending}>
                        {t('ProjectSettings_form_submit')}
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

> **Note on React 19 form actions:** React 19 introduces native `<form action={fn}>`, `useActionState`, and `useFormStatus` APIs. Our `<Form />` wrapper + React Hook Form + Zod remains the standard for all forms because it provides schema-driven validation, integrated field components, and a consistent architecture. Do not use the native React 19 form action APIs directly.

### Advanced patterns

#### Accessing form methods

The `<Form />` component provides access to form methods via the function-as-children pattern. All methods from React Hook Form's `useForm` hook are available, along with a `submitForm` method for programmatic submission.

#### Using `useFormContext` in nested components

For deeply nested components that need access to form methods without prop drilling, use the `useFormContext` hook. This hook provides the same form methods available through the function-as-children pattern.

```tsx
import { type ReactElement } from 'react';
import { useFormContext } from 'Common/Form/Context/FormContext';

export const SampleRateField = (): ReactElement => {
    const { setValue, watch } = useFormContext();
    const rate = watch('sampleRate');

    const handleRatePreset = (newRate: string) => {
        setValue('sampleRate', newRate);
    };

    return <div>{/* Component that interacts with form */}</div>;
};

// Parent form
export const ProjectSettingsForm = (): ReactElement => {
    return (
        <Form schema={schema} onSubmit={handleSubmit}>
            <FormTextInput name="name" label={{ children: 'Name' }} />
            <SampleRateField />
            <Button type="submit">Save</Button>
        </Form>
    );
};
```

#### Conditional field rendering

For conditional field rendering based on form values, extract the conditional logic into a separate component that uses `useFormContext`. This ensures proper hook usage and component lifecycle management.

```tsx
import { type ReactElement, useEffect } from 'react';
import { Form } from 'Common/Form/Form';
import { useFormContext } from 'Common/Form/Context/FormContext';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

export const AudioExportForm = (): ReactElement => {
    const handleSubmit = (formData: AudioExportFormData) => {
        // Handle submission
    };

    return (
        <Form schema={audioExportSchema} initialValues={{ format: 'wav' }} onSubmit={handleSubmit}>
            <FormTextInput name="format" label={{ children: 'Format', required: true }} />

            <ConditionalAudioFields />

            <Button type="submit">Export</Button>
        </Form>
    );
};

export const ConditionalAudioFields = (): ReactElement | null => {
    const { watch, setValue } = useFormContext<AudioExportFormData>();
    const format = watch('format');
    const showMp3Fields = format === 'mp3';

    // Clear mp3 fields when switching away from 'mp3'
    useEffect(() => {
        if (format !== 'mp3') {
            setValue('bitrate', undefined);
        }
    }, [format, setValue]);

    if (!showMp3Fields) {
        return null;
    }

    return (
        <>
            <FormTextInput name="bitrate" label={{ children: 'Bitrate (kbps)', required: true }} />
        </>
    );
};
```

#### Dynamic form arrays (`useFieldArray`)

Use the `useFieldArray` hook to manage dynamic lists of inputs, such as inserting multiple plugins into a track's effects chain. Extract the `control` prop from the `Form` component using the function-as-children pattern and pass it to `useFieldArray` at the component level.

```tsx
import { type ReactElement } from 'react';
import { useFieldArray, type Control } from 'react-hook-form';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

type PluginData = {
    pluginId: string;
    presets: string;
    active: boolean;
};

type PluginChainFormData = {
    plugins: PluginData[];
};

export const PluginChainForm = (): ReactElement => {
    const handleSubmit = (formData: PluginChainFormData) => {
        // Handle submission
    };

    return (
        <Form
            schema={pluginChainSchema}
            initialValues={{
                plugins: [{ pluginId: 'eq-1', presets: 'default', active: true }],
            }}
            onSubmit={handleSubmit}
        >
            {({ control }) => <PluginEffectsFieldArray control={control} />}
        </Form>
    );
};

const PluginEffectsFieldArray = ({ control }: { control: Control<PluginChainFormData> }): ReactElement => {
    const { fields, append, remove } = useFieldArray({
        control,
        name: 'plugins',
    });

    return (
        <>
            {fields.map((field, index) => (
                <div key={field.id} className="tw-flex tw-flex-col tw-gap-2">
                    <FormTextInput
                        name={`plugins.${index}.pluginId`}
                        label={{ children: 'Plugin ID', required: true }}
                    />
                    <FormTextInput name={`plugins.${index}.presets`} label={{ children: 'Preset' }} />

                    <Button type="button" onClick={() => remove(index)}>
                        Remove Plugin
                    </Button>
                </div>
            ))}

            <Button type="button" onClick={() => append({ pluginId: '', presets: '', active: true })}>
                Add Plugin
            </Button>

            <Button type="submit">Save Chain</Button>
        </>
    );
};
```

### Best practices

#### Form field patterns

Always use our schema-driven approach with the `<Form />` component. Managing form state manually with `useState` is an anti-pattern that leads to boilerplate and bugs.

```tsx
import { type FormEvent, useState, type ReactElement } from 'react';

// ❌ Bad: Managing form state manually
export const LegacyManualProjectForm = (): ReactElement => {
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
import * as z from 'zod';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

const schemaProjectFormSchema = z.object({ name: z.string().min(1, 'Name required') });

export const SchemaProjectForm = (): ReactElement => {
    const handleSubmit = (data: z.infer<typeof schemaProjectFormSchema>) => {
        // ... submit
    };

    return (
        <Form schema={schemaProjectFormSchema} onSubmit={handleSubmit}>
            <FormTextInput name="name" label={{ children: 'Name', required: true }} />
            <Button type="submit">Submit</Button>
        </Form>
    );
};
```

### Migrating from legacy patterns

**Before: Manual state management**

```tsx
// ❌ Bad
import { type FormEvent, useState, type ReactElement } from 'react';

export const LegacyProjectSettingsForm = (): ReactElement => {
    const [name, setName] = useState('');
    const [sampleRate, setSampleRate] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        const newErrors: Record<string, string> = {};

        if (!name) {
            newErrors.name = 'Name is required';
        }
        if (!sampleRate) {
            newErrors.sampleRate = 'Sample Rate is required';
        }

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
                value={sampleRate}
                onChange={(event) => setSampleRate(event.target.value)}
                status={errors.sampleRate ? 'error' : 'neutral'}
            />
            <Button type="submit">Submit</Button>
        </form>
    );
};
```

**After: Schema-driven with `<Form />`**

```tsx
// ✅ Good
import * as z from 'zod';
import { type ReactElement } from 'react';
import { Form } from 'Common/Form/Form';
import { FormTextInput } from 'Common/Form/TextInput/TextInput';

const modernFormSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    sampleRate: z.string().min(1, 'Sample rate required'),
});

type FormData = z.infer<typeof modernFormSchema>;

export const ModernProjectSettingsForm = (): ReactElement => {
    const handleSubmit = (data: FormData) => {
        // Submit logic - data is already validated
    };

    return (
        <Form schema={modernFormSchema} initialValues={{ name: '', sampleRate: '' }} onSubmit={handleSubmit}>
            <FormTextInput name="name" label={{ children: 'Name', required: true }} />
            <FormTextInput name="sampleRate" label={{ children: 'Sample Rate', required: true }} />
            <Button type="submit">Submit</Button>
        </Form>
    );
};
```

````

---

### 4. `README.md`

#### High-level verdict
Keep as-is.

#### What is strong
- Acts as a perfect entry point index to the rest of the documentation.
- Short, simple, and accurate.

#### What is weak
- N/A

> **[VERIFIED — LEGITIMATE]** `docs/README.md` is a short index file. No code examples to type-check. Assessment is correct.

#### Recommended changes
- None.

---

### 6. `state-management.md`

#### High-level verdict
Revise lightly.

#### What is strong
- Beautiful explanation of the boundary between cross-module contracts vs. module-private presentation stores.
- Clear and succinct explanation of `useSyncExternalStore` usage.

#### What is weak
- Example singleton initializers (`getDawLayoutStore`) use arrow-function exports, contradicting the `function` keyword standard for business layer code.
- Component examples are missing their `ReactElement` types.

> **[VERIFIED — PARTIALLY LEGITIMATE]**
>
> - `getDawLayoutStore` claim: **confirmed**. `docs/state-management.md` has `export const getDawLayoutStore = (initialState: LayoutState): Store<LayoutState> => {` — arrow function in the business layer (stores/). Should be `export function`.
>
> - `getWorkspacePreferencesStore` claim: **wrong**. That function already uses `export function getWorkspacePreferencesStore()` in the actual doc. The audit's recommended change to convert it is a no-op — it's already correct.
>
> - Hook (`useWorkspacePreferences`) uses arrow function: this is a presentation-layer hook (`presentations/hooks/`). `conventions.md` examples show hooks as `export const useX = () =>` (arrow functions). Flagging this hook as wrong is **incorrect** — the arrow-function style is standard for hooks per project conventions.
>
> - Missing `ReactElement` types in component examples: the state-management.md doc doesn't have standalone component examples in the sections reviewed; the context/use() examples do show components without return types. This sub-claim is **legitimate** for those snippets.

#### Recommended changes
- Convert store factory exports (`getWorkspacePreferencesStore`, `getDawLayoutStore`) to use `export function`.
- Add `ReactElement` return types to the React components.

#### Revised document
```markdown
# State management

This document explains our approach to client-side state management for UI and domain state. For server state, use TanStack Query. For cross-domain UI updates, use [domain events](./events.md).

---

## Our approach to state

Our state management philosophy is to keep domain state in plain, framework-agnostic TypeScript stores, decoupling it from the UI. We connect these vanilla stores to React components only when needed using the `useSyncExternalStore` hook. This ensures clear boundaries, as components receive data via props from subscribing views or hooks rather than accessing stores directly. We reserve React Context for simple, localized UI state -- consumed via the `use()` hook (React 19) rather than `useContext`.

### The vanilla store

Our custom `Store` class (located at `src/helpers/Store/Store.ts`) provides a simple but powerful foundation for creating observable state containers. It is framework-agnostic and can be used anywhere in the application.

---

## Cross-module store contracts

Business-layer stores (located at `ModuleName/stores/`, outside `presentations/`) are **cross-module contracts**. Any module may import and subscribe to them — both from use cases (for reading/writing) and from presentation hooks (for reactive UI binding via `useSyncExternalStore`).

Presentation-layer stores (located at `ModuleName/presentations/stores/`) are **module-private**. They hold UI preferences (zoom, sidebar state, panel layout) and are never imported by another module.

```typescript
// ✅ Cross-module: import a business-layer store from another module
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

const tracks = useSyncExternalStore(
    (cb) => trackStore.subscribe(cb),
    () => trackStore.value?.tracks ?? []
);

// ❌ Forbidden: import a presentation-layer store from another module
import { zoomStore } from '#/modules/Arrangement/presentations/stores/zoomStore';
````

---

## How to create and use a store

This section provides a practical guide to creating, persisting, and subscribing to a store.

### 1. Define and create the store

A store is a singleton instance of the `Store<T>` class. It holds the state and provides methods to update and subscribe to it. By default, singleton logic belongs to the business/infrastructure tier, so utilize `function`.

```typescript
// Workspace/stores/workspacePreferencesStore.ts

export type WorkspacePreferencesStore = {
    theme: 'light' | 'dark';
    defaultSampleRate: 44100 | 48000 | 96000;
    showMetrics: boolean;
};

let instance: Store<WorkspacePreferencesStore>;

export function getWorkspacePreferencesStore(): Store<WorkspacePreferencesStore> {
    if (!instance) {
        const logger = Container.getInstance().get(Logger);
        instance = new Store<WorkspacePreferencesStore>(logger, {
            initialData: {
                theme: 'dark',
                defaultSampleRate: 48000,
                showMetrics: false,
            },
        });
    }
    return instance;
}
```

### 2. Connect the store to React with a hook

Create a custom hook that uses `useSyncExternalStore` to subscribe to your store instance. This hook will provide the component with the current state and trigger re-renders when the state changes.

```tsx
// Workspace/presentations/hooks/useWorkspacePreferences.ts
import { useSyncExternalStore } from 'react';
import { getWorkspacePreferencesStore, type WorkspacePreferencesStore } from '../stores/workspacePreferencesStore';

export function useWorkspacePreferences(): WorkspacePreferencesStore {
    const store = getWorkspacePreferencesStore();
    const state = useSyncExternalStore(store.subscribe, store.get, store.get);
    return state;
}
```

### 3. Persist store state (optional)

To persist state to `localStorage`, inject a `LocalStorageStorage` instance when creating your store. This is the only permitted way to interact with `localStorage`.

```typescript
// Workspace/stores/dawLayoutStore.ts

const LAYOUT_STORAGE_KEY = 'daw-layout-state';

export type LayoutState = 'arrange' | 'mixer' | 'piano-roll';

let layoutStoreInstance: Store<LayoutState>;

export function getDawLayoutStore(initialState: LayoutState): Store<LayoutState> {
    if (!layoutStoreInstance) {
        const logger = Container.getInstance().get(Logger);
        const storage = new LocalStorageStorage<LayoutState>(LAYOUT_STORAGE_KEY);
        const storedValue = storage.get();

        layoutStoreInstance = new Store<LayoutState>(logger, {
            initialData: storedValue ?? initialState,
            storage,
        });
    }
    return layoutStoreInstance;
}
```

### 4. Update the store in response to events

Stores are often updated in response to domain events. Subscribe to an event and call the store's `set` method to update its value.

```typescript
// Workspace/useCases/handleMetricsToggled.ts

getEventBus().on(MetricsToggledEvent, (event) => {
    const store = getWorkspacePreferencesStore();
    const current = store.value;

    if (!current) {
        return;
    }

    store.set({ ...current, showMetrics: event.payload.isEnabled });
});
```

### 5. Use React Context with `use()` (React 19)

For simple, localized UI state that doesn't warrant a full store, React Context remains appropriate. In React 19, consume context with the `use()` hook instead of `useContext`. The `use()` hook can be called conditionally and also reads Promises for Suspense-based patterns.

```tsx
// Common/presentations/context/PanelContext.ts
import { createContext } from 'react';

type PanelContextValue = {
    isCollapsed: boolean;
    toggle: () => void;
};

export const PanelContext = createContext<PanelContextValue | null>(null);
```

```tsx
// Common/presentations/components/PanelHeader.tsx
import { use, type ReactElement } from 'react';
import { PanelContext } from '../context/PanelContext';

export const PanelHeader = ({ title }: { title: string }): ReactElement => {
    const panel = use(PanelContext);

    if (!panel) {
        return <header>{title}</header>;
    }

    return (
        <header>
            <span>{title}</span>
            <button onClick={panel.toggle}>{panel.isCollapsed ? 'Expand' : 'Collapse'}</button>
        </header>
    );
};
```

---

## Read-only stores

For state that is fetched from an external source and is not mutated on the client (e.g., user permissions, session data), a `ReadonlyStore` is available. It follows the same principles as the standard `Store` but with a few key differences:

- It is created via an asynchronous `ReadonlyStore.create()` method.
- It requires a `getDataFn` for fetching and refreshing its data.
- It does not have a `set()` method, enforcing a strict read-only pattern.

The setup is analogous to the standard `Store`, using a singleton getter and a React hook for component subscriptions.

````

---

### 7. `testing.md`

#### High-level verdict
Revise lightly.

#### What is strong
- Explicit co-location patterns (co-locating `_tests` adjacent to modules).
- Strong enforcement of expressive test naming semantics (`should ...`).

#### What is weak
- The examples rely on an obfuscated `injectDependencies()` API mapped to arrow-function closures which contradicts the modern mandate to write pure `function` usecases.
- It misses the opportunity to showcase standard Vitest `vi.mock` for dependency isolation, which pairs perfectly with the `function` keyword approach.

> **[VERIFIED — LEGITIMATE]** Confirmed in `docs/testing.md`: the use case test example imports `injectDependencies` and `Prophecy`, uses `prophecy.prophesize(addTrackApi)`, and `injectDependencies(addTrack, {...})`. This is a bespoke DI/mocking framework that doesn't pair with `export function` use cases or standard `vi.mock`. The revised version using `vi.mock` and `vi.mocked` is simpler, idiomatic Vitest, and consistent with the rest of the recommended patterns.

#### Recommended changes
- Update the API and Use Case examples to target pure `function` imports.
- Re-map dependency overriding to use `vi.mock()` and `vi.mocked()`, which simplifies tests without compromising layer boundaries.
- Add `ReactElement` types in component snippets.

#### Revised document
```markdown
# Testing

Reliable tests increase confidence and speed. This guide shows how to test the architecture effectively.

For event-driven flows, use patterns from [events](./events.md). For React components that suspend on data, wrap them in a `SuspenseGuard`.

---

## Test organization

```text
src/modules/Arrangement/
├── _tests/                    # Test utilities and shared mocks
│   ├── TrackDummy.ts
│   ├── getEventBus.mock.ts
│   └── WrapperQueryClient.tsx
├── useCases/
│   └── addTrack.spec.ts
└── presentations/
    └── helpers/
        └── trackValidator.spec.ts
````

**Co-location is key** - tests live next to the code they test.

---

## How to test your code

Our testing strategy focuses on verifying behavior at different layers of the application.

### Test naming convention

All test descriptions must follow a clear, descriptive convention. Each `it` block should start with either `should` or `should not`, followed by a concise explanation of the expected behavior. This makes test suites highly readable and immediately communicates the purpose of each test case.

**Examples:**

- `it('should return the user profile on success')`
- `it('should not allow creation of a duplicate record')`
- `it('should throw an error if the input is invalid')`

### 1. Test use cases

Test pure business logic found in use cases. This is the simplest and fastest form of testing.

- **Goal**: Verify that given a specific input, the use case produces the correct output or side effect.
- **Method**: Import the use case function and mock its external dependencies via standard `vi.mock`.

```typescript
// useCases/addTrack.spec.ts
import { vi, describe, it, expect } from 'vitest';
import { addTrack } from './addTrack';
import { createTrackApi } from '../repositories/createTrackApi';
import { getEventBus } from '#/helpers/Event/EventBus';
import { TrackAddedEvent } from '../events/TrackAddedEvent';
import { TrackDummy } from '../_tests/TrackDummy';

vi.mock('../repositories/createTrackApi');
vi.mock('#/helpers/Event/EventBus');

describe('addTrack', () => {
    it('should create track and emit event on success', async () => {
        const input = { name: 'Lead Vocals', kind: 'audio' as const };
        const mockTrack = TrackDummy.create(input);

        // Mock dependencies
        vi.mocked(createTrackApi).mockResolvedValue(mockTrack);
        const emitMock = vi.fn();
        vi.mocked(getEventBus).mockReturnValue({ emit: emitMock } as any);

        const result = await addTrack(input);

        expect(result).toEqual(mockTrack);
        expect(createTrackApi).toHaveBeenCalledWith(input);
        expect(emitMock).toHaveBeenCalledWith(new TrackAddedEvent(mockTrack));
    });

    it('should throw error when repository fails', async () => {
        const input = { name: 'Lead Vocals', kind: 'audio' as const };
        const error = new Error('API Error');

        vi.mocked(createTrackApi).mockRejectedValue(error);
        const emitMock = vi.fn();
        vi.mocked(getEventBus).mockReturnValue({ emit: emitMock } as any);

        await expect(addTrack(input)).rejects.toThrow('API Error');
        expect(emitMock).not.toHaveBeenCalled();
    });
});
```

### 2. Test repositories

Repositories are the bridge to external data sources. The goal is to verify that they call the correct data source with the correct parameters and correctly transform the raw response into a domain model.

- **Goal**: Verify the correct API endpoint is called and the data is transformed.
- **Method**: Mock the external executor, call the repository function, and assert the returned model.

```typescript
// repositories/addTrackApi.spec.ts
import { vi, describe, it, expect } from 'vitest';
import { addTrackApi } from './addTrackApi';
import { addTrackExecutor } from '../engine/addTrackExecutor';
import { trackApiToModel } from '../transformers/trackApiToModel';

vi.mock('../engine/addTrackExecutor');
vi.mock('../transformers/trackApiToModel');

describe('addTrackApi', () => {
    const PROJECT_ID = 'proj-123';
    const ITEM_NAME = 'Lead Vocals';
    const DUMMY_ITEM = TrackDummy.create();
    const MOCKED_ITEM_FROM_API = TrackApiResponseDummy.create();
    const CREATE_ITEM_INPUT = { projectId: PROJECT_ID, name: ITEM_NAME, kind: 'audio' };
    const MOCK_SIGNAL = new AbortController().signal;

    it('should call the executor with the correct parameters and return the transformed item', async () => {
        vi.mocked(addTrackExecutor).mockResolvedValue({ data: { addTrack: MOCKED_ITEM_FROM_API } });
        vi.mocked(trackApiToModel).mockReturnValue(DUMMY_ITEM);

        const result = await addTrackApi(CREATE_ITEM_INPUT, MOCK_SIGNAL);

        expect(addTrackExecutor).toHaveBeenCalledWith({
            input: {
                projectId: PROJECT_ID,
                name: ITEM_NAME,
                kind: 'audio',
            },
        });
        expect(trackApiToModel).toHaveBeenCalledWith(MOCKED_ITEM_FROM_API);
        expect(result).toEqual(DUMMY_ITEM);
    });

    it('should return null when creation fails', async () => {
        vi.mocked(addTrackExecutor).mockResolvedValue({ data: { addTrack: null } });

        const result = await addTrackApi(CREATE_ITEM_INPUT, MOCK_SIGNAL);
        expect(result).toBeNull();
    });
});
```

### 3. Test transformers

Transformers are pure functions that map data from one shape to another (e.g., from an API response to a domain model). Testing them is a straightforward unit test.

- **Goal**: Verify that a source data object is correctly mapped to its target domain model.
- **Method**: Provide an input object representing the source data and assert that the output of the transformer function matches the expected shape and values.

```typescript
// transformers/trackApiToModel.spec.ts

describe('trackApiToModel', () => {
    it('should return a correct domain model from an API response', () => {
        const apiResponse: TrackApiResponse = {
            id: 'track-123',
            name: 'Lead Vocals',
            kind: 'audio',
            color: '#ff0000',
            createdAt: new Date('2024-01-01T12:00:00Z'),
        };

        const expectedModel: Track = {
            id: 'track-123',
            name: 'Lead Vocals',
            kind: 'audio',
            color: '#ff0000',
            createdAt: new Date('2024-01-01T12:00:00Z'),
        };

        const result = trackApiToModel(apiResponse);

        expect(result).toEqual(expectedModel);
    });
});
```

### 4. Test components

Use React Testing Library to test components from a user's perspective. Assert that the correct content is rendered and that user interactions trigger the expected outcomes.

```tsx
// Track/presentations/components/TrackList.spec.tsx

describe('TrackList', () => {
    it('should render tracks when loaded', () => {
        const tracks = [TrackDummy.create({ name: 'Drums' })];

        render(
            <SuspenseGuard>
                <TrackList tracks={tracks} />
            </SuspenseGuard>
        );

        expect(screen.getByText('Drums')).toBeInTheDocument();
    });

    it('should handle track creation', async () => {
        const onAddTrack = vi.fn();

        render(<AddTrackDialog onSubmit={onAddTrack} />);

        fireEvent.change(screen.getByLabelText('Name'), {
            target: { value: 'New Synth' },
        });
        fireEvent.click(screen.getByText('Add'));

        await waitFor(() => {
            expect(onAddTrack).toHaveBeenCalledWith({
                name: 'New Synth',
                kind: 'midi',
            });
        });
    });
});
```

### Test utilities

#### Dummy data factories

Create dummy data factories to generate consistent and realistic test data.

```typescript
// Track/_tests/TrackDummy.ts

export const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => {
        return {
            id: `track-${Math.floor(Math.random() * 1000)}`,
            name: 'Lead Vocals',
            kind: 'audio',
            color: '#ff0000',
            createdAt: new Date(),
            ...overrides,
        };
    },
};
```
