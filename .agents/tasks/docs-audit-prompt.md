# Non-Architecture Documentation Review Prompt

You are reviewing a series of project documents for a professional DAW codebase.

Your task is **not** to review or rewrite the architecture documents.
Your task is to review **all other documents** and refine them so they become maximally useful for building and maintaining the DAW described below.

---

## Project context

This project is a professional DAW with these core characteristics:

- **Tauri v2**
- **React 19**
- **React Compiler enabled**
- **TypeScript**
- **Tailwind**
- **shadcn/ui**
- **DDD modules / bounded contexts**
- **SOLID**
- **DRY**
- very high emphasis on:
    - real-time safety
    - clean boundaries
    - maintainability
    - explicit code
    - long-term scalability
    - clarity for both humans and AI agents

The goal is the **peak of cleanliness, consistency, and usefulness**.

---

## Documents you must avoid

Do **not** review, rewrite, or propose changes to the architecture documents.

Avoid anything whose primary role is architecture definition, including documents such as:

- system architecture
- TypeScript module architecture
- Rust backend architecture
- migration architecture
- architecture skills
- architecture violation guidance
- dependency-cruiser architecture enforcement docs
- module migration prompts

Treat those as out of scope.

---

## Non-negotiable conventions

There is a file called **`conventions.md`**.

It is **non-negotiable**.

You must:

- read it carefully
- treat it as fixed and authoritative
- **not modify it**
- **not propose weakening it**
- ensure all other documents align with it

If another document conflicts with `conventions.md`, the other document must be updated to match `conventions.md`.

You must not suggest changing conventions such as:

- explicit control flow
- no short-circuit invocation
- block conditionals
- React 19 patterns
- no manual memoization
- no `forwardRef`
- TanStack Query for fetching
- React Hook Form for forms
- naming conventions
- import conventions
- no default exports
- absolute import preferences
- explicit parameter naming
- no JS cleverness
- no direct `localStorage`
- framework-agnostic logic
- other rules in `conventions.md`

---

## Additional project coding defaults you must preserve

These are also important review assumptions and should be reflected in the docs you refine:

### 1. Business-layer TypeScript prefers `function` declarations

For business-layer code, prefer the `function` keyword over arrow-function exports.

This applies especially to:

- use cases
- validators
- services
- transformers
- domain/business helpers
- other framework-free business logic

Preferred style:

```typescript
export function addTrack(input: AddTrackInput): void {
    ...
}

export function validateClipPlacement(input: ValidateClipPlacementInput): void {
    ...
}
```

Avoid recommending this as the default business-layer style:

```typescript
export const addTrack = (input: AddTrackInput): void => {
    ...
};
```

### 2. Presentation-layer code follows React conventions from `conventions.md`

For presentation-layer guidance, the docs should align with the project’s React conventions, especially:

- React is presentation only
- no business logic in components or hooks
- no `useEffect` for data fetching
- no `useEffect` for derived state
- no manual memoization (`useMemo`, `useCallback`, `React.memo`)
- no `forwardRef`
- use React 19 patterns
- use TanStack Query for fetching
- use React Hook Form for forms
- keep hooks thin
- explicit control flow
- no `&&` rendering shortcuts
- named exports
- type-only imports

If a document discusses UI, components, hooks, forms, fetching, or rendering, it must be aligned with those conventions.

### 3. Classes are not the default on the TypeScript side

For TypeScript guidance, docs should assume:

- **functions + plain types by default**
- **classes only where there is real runtime/lifecycle ownership**

Classes are appropriate mainly for things like:

- engine/runtime objects
- long-lived plugin/native handles
- explicit initialization/disposal controllers

Docs should not casually encourage class-heavy TypeScript business logic.

---

## Your objective

Review the provided **non-architecture** documents and improve them so they become:

- more accurate
- more consistent with the project stack
- more useful to AI agents
- more useful to human contributors
- more concrete
- more operational
- less vague
- less redundant
- less generic
- less contradictory
- more aligned with this DAW’s actual needs

You are not reviewing them as generic docs.
You are reviewing them **for this DAW specifically**.

---

## What “good” looks like

A good document should:

- help an agent make better implementation decisions
- reflect the actual stack and constraints of this project
- avoid stale advice
- avoid generic web-app advice that does not fit a DAW
- be concise but dense
- be concrete enough to act on
- include examples where examples improve clarity
- prefer practical rules over vague platitudes
- not duplicate other documents unnecessarily
- not drift into architecture if architecture is out of scope
- align with `conventions.md`
- reflect the project’s coding defaults around:
    - business-layer `function` declarations
    - React 19 presentation conventions
    - functions/plain types as the TypeScript default
    - classes only for real runtime/lifecycle ownership

---

## What to focus on

For each non-architecture document you review, evaluate:

### 1. Relevance to this DAW

Ask:

- does this document actually help build this DAW?
- is it tailored to Tauri v2 + React 19 + TS + Tailwind + shadcn?
- is it aware of dense editor surfaces, audio tooling, runtime constraints, or command-heavy workflows where relevant?
- does it feel like it was written for **this** codebase rather than a generic app?

### 2. Correctness for the current stack

Ask:

- is the advice current for React 19 with the React Compiler?
- is it consistent with TypeScript best practices?
- is it aligned with Tailwind and shadcn usage?
- is it correct for Tauri v2?
- does it accidentally recommend outdated or conflicting patterns?

### 3. Alignment with conventions

Ask:

- does it conflict with `conventions.md`?
- does it conflict with the project defaults around business-layer functions and presentation-layer React conventions?
- does it sneak in patterns the project explicitly rejects?

### 4. Cleanliness and usefulness

Ask:

- is it too verbose for the value it provides?
- is it repetitive?
- is it too abstract?
- does it lack enough examples?
- does it explain the “why” where useful, without turning into philosophy?
- does it contain stale cargo-cult rules?
- does it contain implementation detail that should be generalized?
- does it miss important operational guidance?

### 5. DAW-specific suitability

Ask:

- where relevant, does it understand the needs of a professional DAW?
- does it support a codebase with complex UI, runtime integration, long-lived state, and high interaction density?
- does it avoid advice that is fine for CRUD apps but bad for DAW workflows?

---

## What to improve

You should improve documents by doing things like:

- removing outdated recommendations
- tightening vague language
- making rules more operational
- adding concrete examples where helpful
- removing generic fluff
- aligning terminology with the project stack
- clarifying intended use
- strengthening guidance where agents are likely to go wrong
- removing contradictions
- merging overlapping points inside a document
- making documents easier to scan
- making documents more useful as practical references

You should **not** improve them by:

- bloating them
- turning them into architecture docs
- duplicating `conventions.md`
- inventing new project-wide principles without basis
- watering down standards
- changing non-negotiable conventions

---

## Special instructions

### Avoid architecture drift

If a non-architecture document starts acting like an architecture document, trim it back.

It may reference architecture where necessary, but it should not become the place where the architecture is redefined.

### Avoid generic frontend fluff

Do not accept generic documentation advice that is too broad, too junior, or too web-app-centric for this DAW.

### Prefer explicit practical guidance

When improving a document, prefer:

- crisp rules
- concrete examples
- strong defaults
- clear do/don’t guidance

over:

- motivational filler
- empty best-practice language
- broad generic “consider…” phrasing

### Respect the current project identity

This project is not trying to be:

- ultra-minimalist React toy code
- loose startup code
- generic fullstack CRUD
- framework-experiment playground

It is trying to be a **clean, serious, maintainable DAW**.

Review everything through that lens.

---

## Output format

For each document you review, provide:

### 1. High-level verdict

One short paragraph answering:

- keep as-is
- revise lightly
- revise heavily
- replace entirely

### 2. What is strong

A concise list of the strongest aspects worth preserving.

### 3. What is weak

A concise list of the problems:

- outdated advice
- vagueness
- redundancy
- mismatch with stack
- lack of examples
- conflicts with conventions
- too generic for this DAW
- etc.

### 4. Recommended changes

A concise, concrete list of improvements.

### 5. Revised document

Provide the fully revised version if revision is needed.

If the document is already excellent, say so explicitly and explain why briefly.

---

## Review standards

Be strict.

Do not preserve weak wording just because it is “fine.”
Do not preserve generic docs just because they are harmless.
Assume these documents should become excellent tools for contributors and AI agents working on a top-tier DAW codebase.

When in doubt, optimize for:

- clarity
- explicitness
- consistency
- usefulness
- maintainability
- stack correctness
- DAW suitability

---

## Final reminders

- Do **not** touch architecture documents.
- Do **not** modify or weaken `conventions.md`.
- Do align all other documents to `conventions.md`.
- Do preserve the project defaults around:
    - business-layer `function` declarations
    - React conventions in presentation
    - functions/plain types as the TypeScript default
    - classes only for real runtime ownership
- Do review with the standards of a clean, serious DAW codebase in mind.
- Do prioritize practical usefulness over generic documentation style.

Begin the review now.
