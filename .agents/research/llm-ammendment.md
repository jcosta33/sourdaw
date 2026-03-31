# Consolidated Amendments to the Local-First Deterministic LLM-Driven DAW Editing Guide

## Purpose

This document supersedes the earlier ad hoc amendments and serves as the **single supplemental document** to the main implementation guide.

It captures the key architectural clarifications that must be treated as authoritative from now on.

These amendments cover:

1. the LLM must **not** rewrite full project JSON by default
2. Rust must be treated as the **authoritative state transition engine**
3. the browser/WebLLM path must explicitly use **`response_format`**
4. `EditPlanSchema` must be clearly defined as the structured-output contract
5. the system will standardize on **one model only: Qwen3-8B**
6. no automatic fallback to smaller/different models for AI editing

---

# 1. Core Architectural Clarification

## 1.1 The canonical project is stored as structured state, but the LLM does **not** return the entire edited project

The intended architecture is **not**:

1. serialize full DAW project JSON
2. send it to the LLM
3. receive full modified project JSON back
4. diff and apply it

That is too brittle for real DAW editing.

## 1.2 Why full-document rewrite is the wrong default

Full-project roundtrips make the model responsible for:

- preserving all untouched fields
- not dropping nested state
- not reordering unrelated structures
- not corrupting opaque plugin/device state
- staying correct under concurrent user edits
- producing large outputs for small changes
- making preview, diff, and undo harder to reason about

This is acceptable only for tiny bounded subdocuments, not for general project editing.

## 1.3 Correct rule

The correct architecture is:

1. Rust owns the canonical project state
2. the system extracts a normalized logical slice for prompting
3. the LLM returns a **structured edit plan**
4. Rust validates and compiles the plan into actual state mutations
5. Rust stages preview, undo, and commit

---

# 2. The LLM Returns Edit Plans, Not State

## 2.1 Primary output format

The LLM should output one of:

- a typed **edit plan**
- a typed **DSO list**
- a typed **clarification object**
- a typed **moderation/refusal object**
- a typed **diagnostic object**

It should **not** usually output a full rewritten project document.

## 2.2 Correct mental model

- **LLM = planner**
- **Rust = transaction and validation layer**
- **Audio engine = consumer of validated snapshots/commands**

## 2.3 Preferred output style

The model should express intent like:

- `duplicate_clip`
- `move_clip`
- `set_track_volume`
- `insert_device`
- `transpose_notes`
- `create_send`
- `ripple_delete_range`

Rust then resolves those into actual JSON/state mutations.

---

# 3. Rust Is the Authoritative Safety Boundary

## 3.1 Stronger statement of responsibility

Rust is not passive glue.

Rust must own:

- canonical project state
- ID resolution
- revision checks
- DSO compilation
- patch construction
- inverse patch generation
- semantic validation
- preview generation
- commit authorization
- lock-free publication into the engine

## 3.2 Consequence

The model never directly mutates canonical state.

Rust must always:

1. deserialize model output into typed structures
2. validate that the referenced entities exist
3. validate that the operation is legal
4. compile forward and inverse mutations
5. stage preview
6. commit only after all checks pass

## 3.3 Correct implementation stance

Do **not** reduce Rust to:

- parse returned JSON
- compare old vs new
- hope nothing subtle broke

Instead, Rust must remain the **constructor of the authoritative state transition**.

---

# 4. Browser/WebLLM Structured Output Amendment

## 4.1 `response_format` must be explicit

For the browser path, the main guide should be interpreted as requiring **`response_format`** for structured edit generation.

Do **not** rely primarily on prompt text such as:

- “respond only in JSON”
- “output valid JSON only”

Those prompt instructions can reinforce the contract, but they are not the primary safety mechanism.

## 4.2 Required rule

All browser-side edit-planning requests that can lead to preview or commit must use:

- `response_format`
- a versioned schema
- local validation after generation

## 4.3 Required request pattern

```ts
const response = await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.1,
    max_tokens: 512,
    response_format: {
        type: 'json_object',
        schema: JSON.stringify(EditPlanSchema),
    },
});
```

## 4.4 Important clarification

`response_format` improves:

- object shape correctness
- required field presence
- enum adherence
- general structured-output reliability

It does **not** replace Rust-side semantic validation.

---

# 5. Definition of `EditPlanSchema`

## 5.1 What it is

`EditPlanSchema` is the canonical JSON Schema for the browser-side structured output.

It defines the exact object the model is allowed to emit.

It is the browser counterpart of the Rust-side typed `EditPlan` / `DsoPlan` structures.

## 5.2 What it must define

It must define:

- top-level envelope shape
- required fields
- valid moderation states
- valid DSO variants
- required arguments for each DSO type
- whether extra properties are forbidden

## 5.3 Minimum top-level shape

A good baseline shape is:

```json
{
    "kind": "edit_plan",
    "intent": "duplicate chorus vocal clip to second chorus",
    "moderation": "allow",
    "dsos": [
        {
            "op": "duplicate_clip",
            "clip_id": "cp11",
            "destination_track_id": "ax",
            "destination_start_beats": 64.0
        }
    ]
}
```

## 5.4 Example browser schema

```ts
const EditPlanSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'intent', 'moderation', 'dsos'],
    properties: {
        kind: {
            type: 'string',
            enum: ['edit_plan', 'clarification', 'diagnostic'],
        },
        intent: {
            type: 'string',
        },
        moderation: {
            type: 'string',
            enum: ['allow', 'needs_confirmation', 'block'],
        },
        dsos: {
            type: 'array',
            items: {
                oneOf: [
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['op', 'clip_id', 'destination_track_id', 'destination_start_beats'],
                        properties: {
                            op: { type: 'string', const: 'duplicate_clip' },
                            clip_id: { type: 'string' },
                            destination_track_id: { type: 'string' },
                            destination_start_beats: { type: 'number' },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['op', 'track_id', 'volume_db'],
                        properties: {
                            op: { type: 'string', const: 'set_track_volume' },
                            track_id: { type: 'string' },
                            volume_db: { type: 'number' },
                        },
                    },
                    {
                        type: 'object',
                        additionalProperties: false,
                        required: ['op', 'track_id', 'device_kind'],
                        properties: {
                            op: { type: 'string', const: 'insert_device' },
                            track_id: { type: 'string' },
                            device_kind: { type: 'string' },
                        },
                    },
                ],
            },
        },
        clarification_question: {
            type: 'string',
        },
        diagnostics: {
            type: 'array',
            items: { type: 'string' },
        },
    },
};
```

## 5.5 Source-of-truth rule

The TypeScript/browser schema and the Rust `EditPlan` / `Dso` types must be kept in sync.

Ideally they should be generated from the same canonical contract or validated against each other in CI.

---

# 6. Single-Model Policy

## 6.1 One model only

To reduce moving parts and behavioral drift, the system will standardize on **one planning model**:

> **Qwen3-8B**

This applies to:

- browser/WebLLM path, where hardware permits
- native/mistral.rs path, as the default planning model

## 6.2 Why this change matters

Using one model avoids:

- prompt drift across model families
- schema regressions caused by model swaps
- multiple tuning profiles
- inconsistent output behavior across runtimes
- additional debugging complexity
- evaluation fragmentation

## 6.3 Correct architectural policy

Do **not** maintain a rotating browser model matrix for the main AI edit system.

Do **not** auto-switch between:

- Qwen
- Llama
- Hermes
- DeepSeek
- Mistral

for the same user-facing feature.

The edit architecture should target one model and optimize around it.

---

# 7. Browser Runtime Policy for the Single-Model Strategy

## 7.1 Browser target

The browser path targets **Qwen3-8B only**.

## 7.2 If the browser cannot run it

If Qwen3-8B cannot initialize or run reliably due to:

- insufficient WebGPU memory
- browser/device instability
- tab/runtime limits
- model load failure

then:

- AI edit generation is **disabled for that session**
- the rest of the deterministic editing system remains fully functional
- there is **no automatic fallback to a smaller or different model**

## 7.3 Why no automatic fallback

Automatic fallback would introduce:

- different behavior under the same UI
- inconsistent structured-output quality
- harder bug reproduction
- hidden changes in edit semantics
- more QA burden

The system should fail clearly, not silently change model behavior.

---

# 8. Native Runtime Policy for the Single-Model Strategy

## 8.1 Native default

The native path also standardizes on **Qwen3-8B**.

## 8.2 Native benchmarking still matters

Benchmarking is still required, but only for:

- tuning quantization
- latency profiling
- memory behavior
- structured-output reliability
- throughput under streaming load

It is **not** for choosing among multiple primary model families anymore.

---

# 9. Prompting Amendment

## 9.1 Prompt contract still matters, but not as the main browser structural control

The system prompt should still state:

- the model is a deterministic DAW edit planner
- it must not invent IDs
- it must use only provided stable identifiers
- ambiguous requests must become typed clarification objects
- destructive edits should become `needs_confirmation` or `block`

But for the browser path:

- the prompt is a **secondary reinforcement**
- `response_format` is the **primary structural constraint**

## 9.2 Correct phrasing

Use wording like:

- “the output must conform to the provided schema”

instead of relying on:

- “respond only in JSON”

as the main correctness mechanism.

---

# 10. Amendment to Structured Output Language in the Main Guide

Where the original guide says or implies:

- “use grammar/schema-constrained decoding in the browser”
- “respond in JSON”
- “Qwen2.5-Coder-7B is the browser baseline”

it should now be interpreted as:

- **WebLLM uses `response_format` for browser-side structured generation**
- **Qwen3-8B is the single planning model**
- **prompt instructions reinforce structure but do not replace structured output control**
- **Rust remains the semantic authority**

---

# 11. Amendment to the Model Selection Section

The original model-selection language should be replaced with this rule:

> Use **Qwen3-8B** as the single planning model across browser and native runtimes. Do not introduce automatic model-family fallback for AI edit generation. If the runtime cannot support Qwen3-8B, disable AI planning rather than silently changing models.

---

# 12. Amendment to Minimal Summary / Build Summary Language

The minimal summary should now be read with these added rules:

1. use `response_format` in WebLLM for structured browser output
2. use Qwen3-8B as the only planning model
3. do not silently fall back to smaller/different models
4. keep Rust as the canonical state-transition and validation engine
5. keep full-project JSON roundtrips out of the default editing path

---

# 13. Recommended Replacement Paragraph for the Main Guide

If a single replacement paragraph is needed inside the main guide, use this:

> Although the project is stored as structured JSON-like state, the LLM must not generally rewrite the full project document. Instead, Rust owns the canonical state, extracts a normalized logical slice for prompting, and asks the model to return a schema-constrained edit plan. In the browser, WebLLM must use `response_format` with `EditPlanSchema`. In both browser and native paths, Rust deserializes the returned plan into typed structures, validates IDs and semantics, compiles forward and inverse patches, stages previews, and only then commits the change. The system standardizes on **Qwen3-8B** as the single planning model; if that model cannot run in a given runtime, AI edit generation is disabled rather than silently falling back to a different model.

---

# 14. Final Operational Rule

The final operational rule for the whole system is:

- **the project lives in Rust**
- **the LLM proposes edits**
- **WebLLM uses `response_format`**
- **Rust compiles and validates**
- **Qwen3-8B is the one planning model**
- **no automatic fallback**
- **no full-project JSON rewrite by default**

```

```
