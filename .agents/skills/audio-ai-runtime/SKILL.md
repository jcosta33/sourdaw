---
name: audio-ai-runtime
description: >
  Apply when creating, editing, or reviewing the browser audio engine, AudioWorklet processors, DSP modules, timeline playback integration, local inference runtimes, voice-command pipelines, prompt-to-command execution, or the bridge between the React UI and native/local AI processes. Enforces the project’s audio and AI stack: Web Audio API + AudioWorklet for real-time browser audio, WASM DSP modules for hot-path processing, ONNX Runtime Web and Transformers.js for browser-local inference, mistral.rs and whisper-rs for heavier desktop-local LLM/ASR workloads (running in-process in Rust), and Tauri commands/events for the UI-native bridge. Treat this as the authoritative skill for all audio-engine and local-AI implementation work.
---

## Setup

```ts
// src/modules/AudioEngine/useCases/createAudioEngine.ts
export type AudioEngine = {
  initialize: () => Promise<void>;
  resume: () => Promise<void>;
  suspend: () => Promise<void>;
  setMasterGain: (value: number) => void;
  dispose: () => Promise<void>;
};

export type CreateAudioEngine = () => Promise<AudioEngine>;
```

```ts
// src/modules/AudioEngine/repositories/createWebAudioEngine.ts
import type { AudioEngine } from "#/modules/AudioEngine/useCases/createAudioEngine";

export const createWebAudioEngine = async (): Promise<AudioEngine> => {
  const audioContext = new AudioContext({
    latencyHint: "interactive",
  });

  await audioContext.audioWorklet.addModule("/audio/processor.js");

  const masterGainNode = audioContext.createGain();
  masterGainNode.connect(audioContext.destination);

  return {
    initialize: async () => {
      if (audioContext.state !== "running") {
        await audioContext.resume();
      }
    },
    resume: async () => {
      await audioContext.resume();
    },
    suspend: async () => {
      await audioContext.suspend();
    },
    setMasterGain: (value: number) => {
      masterGainNode.gain.value = value;
    },
    dispose: async () => {
      await audioContext.close();
    },
  };
};
```

```ts
// src/audio/processor.ts
class GainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "gain",
        defaultValue: 1,
        minValue: 0,
        maxValue: 4,
        automationRate: "a-rate",
      },
    ];
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !output) {
      return true;
    }

    const gain = parameters.gain;

    for (
      let channelIndex = 0;
      channelIndex < output.length;
      channelIndex += 1
    ) {
      const inputChannel = input[channelIndex];
      const outputChannel = output[channelIndex];

      if (!inputChannel || !outputChannel) {
        continue;
      }

      for (
        let sampleIndex = 0;
        sampleIndex < outputChannel.length;
        sampleIndex += 1
      ) {
        const gainValue = gain.length === 1 ? gain[0] : gain[sampleIndex];
        outputChannel[sampleIndex] = inputChannel[sampleIndex] * gainValue;
      }
    }

    return true;
  }
}

registerProcessor("gain-processor", GainProcessor);
```

```ts
// src/modules/AiRuntime/repositories/createBrowserIntentRuntime.ts
import { pipeline } from "@huggingface/transformers";

export type BrowserIntentRuntime = {
  classifyIntent: (input: string) => Promise<string>;
};

export const createBrowserIntentRuntime =
  async (): Promise<BrowserIntentRuntime> => {
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
        const result = await classifier(input);
        return JSON.stringify(result);
      },
    };
  };
```

```rust
// src-tauri/src/commands/llm.rs
// mistral.rs runs IN-PROCESS (as a Rust library) — no subprocess or sidecar needed
use mistralrs::{TextModelBuilder, IsqType, PagedAttentionMetaBuilder};
use tauri::ipc::Channel;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum LlmEvent {
    Token { text: String },
    Done { full_text: String },
}

#[tauri::command]
pub async fn run_local_llm(
    prompt: String,
    on_token: Channel<LlmEvent>,
) -> Result<(), String> {
    // Model is loaded once at startup and stored in app state (OnceLock / Arc<Model>)
    // Pattern: TextModelBuilder::new("NousResearch/Hermes-3-Llama-3.1-8B")
    //              .with_isq(IsqType::Q4K)
    //              .with_paged_attn(|| PagedAttentionMetaBuilder::default().build())?
    //              .build().await?
    let model = get_loaded_model(); // from app state
    // Stream tokens back via Tauri Channel (ordered, low-latency)
    tokio::task::spawn_blocking(move || {
        // run inference with tool calling / structured output
        // emit LlmEvent::Token per chunk, LlmEvent::Done at end
    }).await.map_err(|e| e.to_string())
}
```

```ts
// src/modules/AiRuntime/repositories/runLocalLlm.ts
import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";

export const runLocalLlm = async (
  prompt: string,
  onToken: (text: string) => void,
): Promise<void> => {
  const channel = new Channel<{ event: string; data: { text?: string; full_text?: string } }>();
  channel.onmessage = (msg) => {
    if (msg.event === "Token") onToken(msg.data.text ?? "");
  };
  return invoke("run_local_llm", { prompt, onToken: channel });
};
```

## Core Patterns

### Use Web Audio API as the core browser audio graph

```ts
// src/modules/AudioEngine/repositories/createProjectGraph.ts
export type ProjectGraph = {
  context: AudioContext;
  destination: AudioNode;
};

export const createProjectGraph = (context: AudioContext): ProjectGraph => {
  const master = context.createGain();
  master.connect(context.destination);

  return {
    context,
    destination: master,
  };
};
```

For browser audio, the primary runtime is:

- `AudioContext`
- `AudioNode` graph
- `AudioWorklet`
- `AudioWorkletNode`
- `AudioParam`
- browser-native scheduling

Do not build the core engine around high-level music libraries that obscure the graph.

The engine must keep direct control over:

- routing
- buses
- automation
- transport timing
- clip scheduling
- processor topology

### Use AudioWorklet for all real-time custom DSP

```ts
// src/modules/AudioEngine/repositories/createGainWorkletNode.ts
export const createGainWorkletNode = (
  context: AudioContext,
): AudioWorkletNode => {
  return new AudioWorkletNode(context, "gain-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    parameterData: {
      gain: 1,
    },
  });
};
```

All custom real-time DSP must run in `AudioWorklet`, not on the React/main thread.

Use AudioWorklet for:

- gain/pan processors
- metering taps
- clip playback mixing
- low-latency analysis
- sample-accurate automation application
- custom filters or utility processors
- worklet-level streaming adapters

Do not use `ScriptProcessorNode`.

### Keep DSP kernels out of React

```ts
// src/modules/AudioEngine/useCases/setTrackGain.ts
export type SetTrackGain = (trackId: string, gain: number) => void;
```

React views and hooks may:

- display audio state
- dispatch transport commands
- subscribe to engine state
- show meters and progress

React must not:

- process audio samples
- mix buffers
- run analyzers in render
- own scheduler state
- mutate the live graph ad hoc

All audio hot paths belong in the audio engine, worklets, or native/WASM DSP modules.

### Use WASM for hot DSP paths

```ts
// src/modules/Dsp/repositories/loadDspModule.ts
export type DspModule = {
  processBlock: (
    inputPtr: number,
    outputPtr: number,
    frameCount: number,
  ) => void;
};

export const loadDspModule = async (): Promise<WebAssembly.Instance> => {
  const response = await fetch("/wasm/dsp.wasm");
  const bytes = await response.arrayBuffer();

  return WebAssembly.instantiate(bytes, {});
};
```

When JavaScript inside an AudioWorklet is not sufficient, move DSP kernels into WASM.

Use WASM for:

- FFT-heavy analysis
- resampling
- pitch/time algorithms
- utility block processors
- heavy metering/feature extraction
- CPU-intensive sample operations

Keep the boundary narrow:

- worklet owns scheduling and parameter wiring
- WASM owns the heavy numerical kernel

### Separate engine state from UI state

```ts
// src/modules/AudioEngine/models/TransportState.ts
export type TransportState = {
  isPlaying: boolean;
  bpm: number;
  positionSeconds: number;
};
```

The audio engine owns:

- transport state
- scheduling state
- node graph state
- playback cursor
- sample positions
- voice allocation
- worklet communication

The UI owns:

- panel state
- selection state
- inspector state
- modal state
- interaction mode

Do not collapse engine state into generic React UI state.

### Use Tauri commands for native control of in-process AI

```rust
// src-tauri/src/lib.rs
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::llm::run_local_llm,
            commands::speech::run_local_asr
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

For desktop-local AI, the legacy pattern was to use `llama.cpp` and `whisper.cpp` as sidecar subprocesses. The **current architecture** runs models **in-process within the Rust backend** to avoid IPC overhead and subprocess lifecycle issues.

Use Tauri `invoke` for:

- request/response commands (e.g., ASR)
- setting up Tauri Channels for streaming (e.g., LLM tokens)
- structured execution
- settings updates
- model lifecycle control
- file/model management

### Use `mistral.rs` for desktop-local LLM inference

For desktop/local LLMs, **`mistral.rs`** is the standard runtime. It runs **in-process as a Rust library** — no sidecar subprocess needed.

Cargo.toml:
```toml
[dependencies]
mistralrs = { version = "0.7.0", features = ["metal"] }  # macOS; use "cuda" for NVIDIA
```

Use it for:

- prompt-to-command parsing via tool calling
- structured JSON generation (llguidance enforces schema)
- local chat/copilot behavior
- offline reasoning for creative actions
- streaming token output to the UI via Tauri Channels

**Current model**: Hermes-3-Llama-3.1-8B with Q4K ISQ (~4.9 GB) — strong tool-calling support. Load via `TextModelBuilder::new("NousResearch/Hermes-3-Llama-3.1-8B").with_isq(IsqType::Q4K)` — auto-downloads from HuggingFace Hub, no manual GGUF download needed.

Load once at app startup and store in `Arc<Model>` in app state. Do not reload per-request.

Do not run large desktop-grade LLM inference on the browser main thread.

For voice/ASR, use the `whisper-rs` crate:
```toml
[dependencies]
whisper-rs = { version = "0.15", features = ["metal"] }
cpal = "0.15"   # mic capture
rubato = "0.15" # resample to 16kHz mono
```

See [tauri-platform SKILL.md](./../tauri-platform/SKILL.md) for the whisper-rs implementation pattern.


### Use browser-local inference only for small/fast tasks

```ts
// src/modules/AiRuntime/repositories/createBrowserCommandScorer.ts
import * as ort from "onnxruntime-web/webgpu";

export const createBrowserCommandScorer = async () => {
  const session = await ort.InferenceSession.create(
    "/models/command-scorer.onnx",
  );

  return {
    session,
  };
};
```

Browser-local inference is appropriate for:

- lightweight intent classification
- embeddings
- reranking
- small command models
- fallback offline UX
- browser-only deployments

Use:

- `onnxruntime-web`
- `onnxruntime-web/webgpu`
- `@huggingface/transformers`

Do not use browser inference for the heaviest desktop-local reasoning workloads when a bundled native sidecar is available.

### Use Transformers.js for browser pipelines and model ergonomics

```ts
// src/modules/AiRuntime/repositories/createBrowserAsrRuntime.ts
import { pipeline } from "@huggingface/transformers";

export const createBrowserAsrRuntime = async () => {
  const transcriber = await pipeline(
    "automatic-speech-recognition",
    "Xenova/whisper-tiny.en",
    {
      device: "webgpu",
    },
  );

  return {
    transcribe: async (audio: Float32Array) => {
      return transcriber(audio);
    },
  };
};
```

Use Transformers.js when you want:

- browser-native model loading
- simple pipeline APIs
- ONNX Runtime underneath
- local CPU/WASM fallback
- optional WebGPU acceleration

It is the preferred browser inference layer for:

- proof-of-concept AI features
- lightweight assistant functions
- browser-only builds
- small ASR or text tasks
- embeddings/ranking/classification pipelines

### Use ONNX Runtime Web as the lower-level browser inference runtime

```ts
// src/modules/AiRuntime/repositories/runOnnxModel.ts
import * as ort from "onnxruntime-web/webgpu";

export const runOnnxModel = async (
  modelPath: string,
  feeds: Record<string, ort.Tensor>,
) => {
  const session = await ort.InferenceSession.create(modelPath);

  return session.run(feeds);
};
```

Use ONNX Runtime Web directly when you need:

- fine-grained control over sessions
- hand-built model pipelines
- direct tensor access
- non-pipeline model execution
- maximum control over browser inference paths

Prefer:

- `onnxruntime-web/webgpu` when WebGPU is available
- `onnxruntime-web` (WASM) as the fallback for environments without WebGPU

Always provide the WASM fallback. WebGPU is not yet universally supported; the inference layer must degrade gracefully.

## Common Mistakes

### CRITICAL Processing audio on the main thread instead of AudioWorklet

Wrong:

```ts
// src/modules/AudioEngine/repositories/processGain.ts
// Running DSP on the main thread — causes audio glitches and jank
const processor = audioContext.createScriptProcessor(4096, 1, 1);
processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) {
        output[i] = input[i] * 0.5;
    }
};
```

Correct:

```ts
// Use AudioWorkletProcessor in a separate worklet file
// src/audio/gain-processor.ts
class GainProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        // runs on the audio rendering thread
        return true;
    }
}
registerProcessor('gain-processor', GainProcessor);
```

All real-time DSP must run inside an `AudioWorkletProcessor`. `ScriptProcessorNode` is deprecated and runs on the main thread, causing audio dropouts and UI jank.

### CRITICAL Putting transport timing in React state

Wrong:

```tsx
const [positionSeconds, setPositionSeconds] = useState(0);

useEffect(() => {
    const id = setInterval(() => {
        setPositionSeconds(audioEngine.getPosition());
    }, 16);
    return () => clearInterval(id);
}, []);
```

Correct:

```tsx
// Bridge with useSyncExternalStore — engine pushes updates
const transportState = useSyncExternalStore(
    subscribeToTransportState,
    getTransportState,
);
```

Polling the engine from `useEffect` at 60 fps causes unnecessary React renders and couples React scheduling to audio timing. Use `useSyncExternalStore` so the engine drives updates only when state actually changes.

### CRITICAL Using cloud AI APIs instead of local inference for audio data

Wrong:

```ts
// Sending raw user audio to a remote API — leaks user project data
const transcript = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    body: audioBlob,
}).then((r) => r.json());
```

Correct:

```ts
// Use whisper-rs (desktop) or Transformers.js whisper-tiny (browser)
const transcript = await invoke<string>('run_local_asr', { audioPath });
```

For **audio and project data**, always use local inference — cloud APIs add latency and expose user content. For heavy AI tasks like MIDI generation or reference mastering where quality matters more, the cloud tier (Claude API, Replicate) is acceptable as the third tier. See `.agents/ai-implementation.md` for the three-tier decision table.


### HIGH Running large LLMs in the browser main thread

Wrong:

```ts
// Loading a multi-GB LLM in the main thread — blocks UI completely
import { pipeline } from '@huggingface/transformers';
const generator = await pipeline('text-generation', 'large-model');
```

Correct:

```ts
// Use mistral.rs (in-process Rust library) for heavy desktop-local LLM work
const result = await invoke<void>('run_local_llm', { prompt, onToken: channel });

// Use a Web Worker for any browser-local inference that takes >50ms
const worker = new Worker(new URL('./inferenceWorker.ts', import.meta.url));
```

Heavy model inference blocks the JavaScript main thread and freezes the UI. For desktop, delegate to `mistral.rs` running in a Tauri background tokio task. For browser-local tasks that are non-trivial, run inference in a dedicated Web Worker.

### HIGH Calling new AudioContext() in React render

Wrong:

```tsx
export const TransportBar = (): ReactElement => {
    // AudioContext created on every render — invalid in browsers and leaks contexts
    const ctx = new AudioContext();
    return <div>...</div>;
};
```

Correct:

```ts
// src/modules/AudioEngine/repositories/createWebAudioEngine.ts
// Created once during engine initialisation, outside React
export const createWebAudioEngine = async (): Promise<AudioEngine> => {
    const audioContext = new AudioContext({ latencyHint: 'interactive' });
    // ...
};
```

`AudioContext` must be created once during application initialisation, not inside React components or hooks. Browsers may block multiple `AudioContext` instances and impose limits on how many can be created.

### HIGH Using ScriptProcessorNode

Wrong:

```ts
const processor = audioContext.createScriptProcessor(2048, 2, 2);
processor.onaudioprocess = myHandler;
processor.connect(audioContext.destination);
```

Correct:

```ts
await audioContext.audioWorklet.addModule('/audio/my-processor.js');
const node = new AudioWorkletNode(audioContext, 'my-processor');
node.connect(audioContext.destination);
```

`ScriptProcessorNode` is deprecated in the Web Audio API spec and runs on the main thread, causing audio dropouts. All custom processing must use `AudioWorklet`.

### HIGH Not providing a WASM fallback for browser inference

**Rule**: Always provide a WASM fallback. **WebGPU is not available on Linux (WebKitGTK)** — onnxruntime-web/webgpu will fail silently or throw. Always check `navigator.gpu` before using the WebGPU backend:

```ts
// Detect WebGPU and fall back to WASM — required for cross-platform support
const hasWebGpu = 'gpu' in navigator && await navigator.gpu.requestAdapter() !== null;
const ort = hasWebGpu
    ? await import('onnxruntime-web/webgpu')
    : await import('onnxruntime-web');

const session = await ort.InferenceSession.create(modelPath);
```

### HIGH Directly mutating engine state from LLM output

Wrong:

```ts
const result = JSON.parse(await runLocalLlm(prompt));
// Directly calling engine methods — bypasses validation and command layer
audioEngine.setTempo(result.bpm);
audioEngine.addTrack(result.trackName);
```

Correct:

```ts
const parsed = appActionSchema.array().safeParse(JSON.parse(await runLocalLlm(prompt)));

if (!parsed.success) {
    throw new Error('Invalid model output');
}

for (const action of parsed.data) {
    await executeAppAction(action);
}
```

LLM output must always pass through the validated action layer (`executeAppAction`). Direct engine mutation from model output skips type checking, numeric range validation, and the undo/redo history.
