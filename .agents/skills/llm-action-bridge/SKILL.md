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
- grammar-constrained output
- schema-constrained payloads
- deterministic temperature settings for command parsing

`llama.cpp` explicitly supports grammar-constrained output, including forcing JSON through grammar files. :contentReference[oaicite:4]{index=4}

This is one of the most important reliability features in the whole AI stack.

### Use browser-local inference for lightweight intent tasks

```ts
// src/modules/AiRuntime/repositories/createBrowserIntentRuntime.ts
import { pipeline } from "@huggingface/transformers";

export const createBrowserIntentRuntime = async () => {
  const classifier = await pipeline(
    "text-classification",
    "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
    {
      device: "webgpu",
      dtype: "q4",
    },
  );

  return {
    classifyIntent: async (input: string) => {
      return classifier(input);
    },
  };
};
```

Use browser-local inference for:

- intent classification
- reranking
- command suggestion
- lightweight embeddings
- browser-only fallback modes
- small voice/text helpers

Default browser inference stack:

- `@huggingface/transformers`
- `onnxruntime-web`
- `onnxruntime-web/webgpu` when available
- WASM fallback otherwise

ONNX Runtime Web officially supports WebGPU and WASM, and recommends WebGPU for more compute-intensive models while keeping WASM for lighter or smaller deployments. :contentReference[oaicite:5]{index=5}

### Use native sidecars for heavier local models

```rust
// src-tauri/src/commands/llm.rs
#[tauri::command]
pub async fn run_local_llm(app: tauri::AppHandle, prompt: String) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;

    let output = app
        .shell()
        .sidecar("llama")
        .map_err(|error| error.to_string())?
        .args([
            "-m",
            "models/command-intent.gguf",
            "-p",
            &prompt,
            "--temp",
            "0.1",
        ])
        .output()
        .await
        .map_err(|error| error.to_string())?;

    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}
```

For heavier desktop-local inference, bundle native binaries as Tauri sidecars.

Preferred sidecars:

- `llama.cpp` for LLM reasoning / structured command generation
- `whisper.cpp` for local ASR / voice commands

Tauri supports bundling external binaries and invoking them as sidecars, and also supports emitting events back to the frontend when needed. :contentReference[oaicite:6]{index=6}

### Use `llama.cpp` for prompt-to-action conversion on desktop

```ts
// src/modules/AiRuntime/repositories/runLocalLlm.ts
import { invoke } from "@tauri-apps/api/core";

export const runLocalLlm = async (prompt: string): Promise<string> => {
  return invoke<string>("run_local_llm", { prompt });
};
```

Use `llama.cpp` for:

- prompt-to-action parsing
- action sequence generation
- local copilot chat
- structured command planning
- command explanation/rewrite when needed

Use:

- quantized GGUF models
- low temperature
- constrained output
- short context windows for command tasks unless long context is truly needed

### Use `whisper.cpp` or equivalent local ASR for voice commands

```rust
// src-tauri/src/commands/speech.rs
#[tauri::command]
pub async fn run_local_asr(app: tauri::AppHandle, audio_path: String) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;

    let output = app
        .shell()
        .sidecar("whisper")
        .map_err(|error| error.to_string())?
        .args([
            "-m",
            "models/whisper-base.en.bin",
            "-f",
            &audio_path,
        ])
        .output()
        .await
        .map_err(|error| error.to_string())?;

    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}
```

Use local ASR for:

- push-to-talk command capture
- quick voice actions
- hands-free transport control
- command palette by voice

`whisper.cpp` is appropriate because it supports local inference, realtime microphone usage, and browser/WASM examples as well as native CLI execution. :contentReference[oaicite:7]{index=7}

### The UI should talk to the AI layer through stable use cases

```ts
// src/modules/AiRuntime/useCases/runVoiceCommand.ts
export type RunVoiceCommand = (transcript: string) => Promise<void>;
```

The UI should not know:

- which model is used
- whether inference is browser or native
- how grammar constraints are built
- whether output came from ONNX or llama.cpp

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
    use llama.cpp sidecar;
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
- no native sidecar option
- slow startup and poor UX on desktop

Correct:

- browser-local models for small tasks
- native sidecars for heavier inference
- shared action contract across both

ONNX Runtime Web is great for browser inference, but heavier local desktop reasoning should usually move to native sidecars. :contentReference[oaicite:8]{index=8}

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
