---
name: llm-action-bridge
description: >
  Apply when creating, editing, or reviewing any AI/copilot feature, prompt handling, voice-command flow, command execution, local model runtime, tool/action registry, structured-output parsing, or the bridge between local LLM inference and DAW behavior. The key goal is to connect the LLM to safe, typed app actions: models should not directly mutate arbitrary UI or engine state. They should interpret user intent and emit structured actions that the app validates and executes. Use browser-local inference for lightweight tasks, Tauri sidecars for heavier desktop-local models, and keep the action layer deterministic and reversible.
---

## Setup

```ts
// src/modules/Command/models/AppAction.ts
export type AddTrackAction = {
  type: "addTrack";
  payload: {
    name: string;
    kind: "audio" | "midi" | "bus";
  };
};

export type RenameTrackAction = {
  type: "renameTrack";
  payload: {
    trackId: string;
    name: string;
  };
};

export type SetTempoAction = {
  type: "setTempo";
  payload: {
    bpm: number;
  };
};

export type TogglePlaybackAction = {
  type: "togglePlayback";
  payload: {};
};

export type AppAction =
  | AddTrackAction
  | RenameTrackAction
  | SetTempoAction
  | TogglePlaybackAction;
```

```ts
// src/modules/Command/useCases/executeAppAction.ts
import type { AppAction } from "#/modules/Command/models/AppAction";

export type ExecuteAppAction = (action: AppAction) => Promise<void>;
```

```ts
// src/modules/AiRuntime/useCases/parsePromptToAction.ts
import type { AppAction } from "#/modules/Command/models/AppAction";

export type ParsePromptToAction = (
  input: string,
  context: {
    selectedTrackId?: string;
    selectedClipId?: string;
    activeView?: "arrange" | "mixer" | "piano-roll";
  },
) => Promise<AppAction[]>;
```

```ts
// src/modules/AiRuntime/presentations/hooks/useAiCommand.ts
import { useState } from "react";

import type { AppAction } from "#/modules/Command/models/AppAction";
import { executeAppAction } from "#/modules/Command/useCases/executeAppAction";
import { parsePromptToAction } from "#/modules/AiRuntime/useCases/parsePromptToAction";

export const useAiCommand = () => {
  const [isRunning, setIsRunning] = useState(false);

  const runPrompt = async (prompt: string) => {
    setIsRunning(true);

    try {
      const actions: AppAction[] = await parsePromptToAction(prompt, {
        activeView: "arrange",
      });

      for (const action of actions) {
        await executeAppAction(action);
      }
    } finally {
      setIsRunning(false);
    }
  };

  return {
    isRunning,
    runPrompt,
  };
};
```

> **Runtime note**: For the underlying inference infrastructure (mistral.rs in-process LLM, whisper-rs ASR, ONNX Runtime Web for browser inference), see [audio-ai-runtime SKILL.md](./../audio-ai-runtime/SKILL.md). This skill covers the **action contract layer** on top of that infrastructure.


## Core Patterns

### The model outputs actions, not arbitrary mutations

```ts
// good mental model
User Prompt
    -> local model inference
    -> structured actions
    -> app validation
    -> action execution
    -> UI/audio state updates
```

The LLM must not:

- mutate React state directly
- call random methods on engine objects
- emit arbitrary code to run
- operate outside the command/action registry

The LLM should produce **structured actions** that are:

- typed
- validated
- reversible when possible
- executable by the app

This is the core architecture for AI integration.

### Prefer action generation over “chatbot answers”

```ts
// src/modules/Command/models/AppAction.ts
export type SoloTrackAction = {
  type: "soloTrack";
  payload: {
    trackId: string;
    enabled: boolean;
  };
};
```

The AI layer should primarily generate actions like:

- add track
- rename track
- move clip
- set tempo
- apply device preset
- open mixer
- zoom timeline
- toggle mute/solo
- create bus
- insert plugin
- arm recording

Do not build the first version around free-form conversational output.

The useful behavior is action execution.

### Keep the action registry explicit

```ts
// src/modules/Command/useCases/executeAppAction.ts
import type { AppAction } from "#/modules/Command/models/AppAction";

export const executeAppAction = async (action: AppAction): Promise<void> => {
  switch (action.type) {
    case "addTrack": {
      return;
    }
    case "renameTrack": {
      return;
    }
    case "setTempo": {
      return;
    }
    case "togglePlayback": {
      return;
    }
  }
};
```

The application should have a clear registry of executable actions.

Do not hide command execution behind magical dynamic dispatch unless it remains strongly typed and easy to audit.

### Validate model output before execution

```ts
// src/modules/AiRuntime/helpers/isAppAction.ts
import { z } from "zod";

export const appActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setTempo"),
    payload: z.object({
      bpm: z.number().min(20).max(300),
    }),
  }),
  z.object({
    type: z.literal("togglePlayback"),
    payload: z.object({}),
  }),
]);
```

All model output must be validated before execution.

Validation should confirm:

- action type is known
- payload shape is correct
- numeric ranges are sane
- referenced ids exist when required
- destructive actions require confirmation if appropriate

Do not trust raw model output.

### Constrain the LLM to structured output

```ts
// conceptual result
[
  {
    type: "setTempo",
    payload: {
      bpm: 128,
    },
  },
];
```

Use structured output constraints whenever possible.

For local models, prefer:

- JSON-only output
- **llguidance** (Microsoft's constrained decoding, built into mistral.rs) for enforcing JSON schemas
- grammar-constrained output (GBNF format supported by mistral.rs)
- deterministic temperature settings for command parsing

llguidance enforces structured output at ~50μs/token overhead — effectively zero cost in the context of LLM inference. This is the same engine used by OpenAI's Structured Outputs feature.

This is one of the most important reliability features in the whole AI stack.

### Use browser-local inference for lightweight intent tasks

For browser-local intent classification, embeddings, or reranking, use `@huggingface/transformers` (Transformers.js). See [audio-ai-runtime SKILL.md](./../audio-ai-runtime/SKILL.md) for the full browser inference setup pattern, WebGPU/WASM fallback requirement, and Linux caveat.

Key rule for the action bridge layer: browser-local inference routes through the same `parsePromptToAction` use case as the native runtime. The UI never knows which backend ran.


### Use native `mistral.rs` for heavier local models

For desktop-local LLM inference, **`mistral.rs` runs in-process as a Rust library** — no sidecar subprocess. The current model is Hermes-3-Llama-3.1-8B with Q4K ISQ quantization (~4.9 GB, auto-downloads from HuggingFace). Supports native tool calling via `set_tools()` + `ToolChoice::Auto`. Tokens stream to the UI via Tauri Channels.

See [audio-ai-runtime SKILL.md](./../audio-ai-runtime/SKILL.md) for the full Rust implementation pattern (`run_local_llm` command, Channel setup, model loading at startup).

Preferred runtime for the action bridge layer:

- `mistral.rs` for LLM reasoning / structured action generation (tool calling built-in)
- `whisper-rs` for local ASR / voice commands (Rust crate, not a subprocess)

Tauri Channels are preferred over the legacy invoke/response pattern for LLM streaming.


### Use `mistral.rs` for prompt-to-action conversion on desktop

Use `mistral.rs` for:

- prompt-to-action parsing via **tool calling** (native to mistral.rs, no prompt engineering needed)
- action sequence generation
- local copilot chat
- structured command planning

Key advantages over the old llama.cpp sidecar approach:
- built-in tool calling — define DAW actions as tools, model selects them directly
- **llguidance** for constrained JSON output (same engine as OpenAI Structured Outputs)
- Tauri Channel streaming — no blocking `invoke`
- in-process — no subprocess startup latency


### Use `whisper-rs` for voice command ASR

For voice-to-action on desktop, use the `whisper-rs` Rust crate — **not** a whisper.cpp subprocess:

```toml
[dependencies]
whisper-rs = { version = "0.15", features = ["metal"] }  # macOS; use "cuda" for NVIDIA
cpal = "0.15"    # real-time mic capture
rubato = "0.15" # resample mic audio to 16kHz mono
```

Use local ASR for:

- push-to-talk command capture
- quick voice actions
- hands-free transport control
- command palette by voice

See [tauri-platform SKILL.md](./../tauri-platform/SKILL.md) for the full `whisper-rs` implementation (mic capture loop, VAD, resampling, transcript-to-action pipeline).


### The UI should talk to the AI layer through stable use cases

```ts
// src/modules/AiRuntime/useCases/runVoiceCommand.ts
export type RunVoiceCommand = (transcript: string) => Promise<void>;
```

The UI should not know:

- which model is used
- whether inference is browser or native
- how grammar constraints are built
- whether output came from ONNX or mistral.rs

The UI should only know about:

- submitting prompt/voice input
- receiving action previews
- confirming actions when needed
- showing execution progress
- rendering errors or clarifications

### Support action previews before execution

```ts
// src/modules/AiRuntime/models/PlannedAction.ts
import type { AppAction } from "#/modules/Command/models/AppAction";

export type PlannedAction = {
  action: AppAction;
  label: string;
  requiresConfirmation: boolean;
};
```

The best UX is often:

prompt  
→ parse into planned actions  
→ preview  
→ confirm if needed  
→ execute

Use previews especially for:

- multi-step sequences
- destructive operations
- ambiguous instructions
- operations affecting many tracks/clips

### Audio actions and AI actions must converge on the same command path

```ts
// src/modules/Command/models/AppAction.ts
export type SetMasterGainAction = {
  type: "setMasterGain";
  payload: {
    gain: number;
  };
};
```

If a user manually clicks a button or uses AI to issue the same action, both should hit the same command path where practical.

That means:

- AI does not get a secret execution path
- manual UI and AI share the same action semantics
- undo/redo and logging become easier
- reliability improves

### Keep inference runtime choice flexible

```ts
// conceptual runtime choice
if (isDesktop && hasBundledLlm) {
    use native mistral.rs;
} else {
    use browser-local ONNX/Transformers runtime;
}
```

Do not over-hardcode one runtime path.

Use the smallest effective local runtime for the task:

- browser-small for lightweight intent/ranking
- native-heavy for real command reasoning
- browser ASR only if it meets latency/accuracy needs
- native ASR when quality matters more

The key is the **action contract**, not the exact model backend.

## Common Mistakes

### CRITICAL Letting the model directly mutate app state

Wrong:

```ts
// anti-pattern
const result = await runLocalLlm(prompt);
eval(result);
```

Correct:

```ts
const actions = await parsePromptToAction(prompt, context);

for (const action of actions) {
  await executeAppAction(action);
}
```

The model must emit structured actions, not arbitrary executable logic.

### CRITICAL Treating the AI as a free-form chatbot instead of an action planner

Wrong:

- ask model for a paragraph
- parse meaning informally
- try to guess what to do next

Correct:

- ask model for typed action output
- validate it
- execute known actions

The action contract is the product.

### CRITICAL No validation layer on model output

Wrong:

```ts
const actions = JSON.parse(rawModelOutput);
await executeAppAction(actions[0]);
```

Correct:

```ts
const parsed = appActionSchema.array().safeParse(JSON.parse(rawModelOutput));

if (!parsed.success) {
  throw new Error("Invalid model output");
}
```

Always validate model output before execution.

### HIGH Forcing all inference through the browser

Wrong:

- giant local LLM in browser main thread
- no native runtime
- slow startup and poor UX on desktop

Correct:

- browser-local models for small tasks (`@huggingface/transformers`, ONNX Runtime Web)
- `mistral.rs` in-process for heavier desktop-local reasoning
- shared action contract across both runtimes

Heavy local desktop reasoning must move to the Rust tier via `mistral.rs`. ONNX Runtime Web is great for browser inference but cannot handle multi-gigabyte tool-calling models.


### HIGH Designing the app around model-specific output formats

Wrong:

- app depends on one model’s quirky response style
- prompt parsing is brittle
- swapping runtimes breaks everything

Correct:

- define app actions first
- generate toward those actions
- keep the parser/validator as the normalization layer

The action schema is the stable API, not the model prompt format.

### HIGH Mixing audio engine internals directly into the LLM layer

Wrong:

- model directly touches AudioWorklet nodes
- model knows graph wiring details
- model mutates transport internals

Correct:

- model emits actions like `setTempo`, `togglePlayback`, `addTrack`
- command layer maps those actions to engine operations

Keep model reasoning separate from engine implementation details.
