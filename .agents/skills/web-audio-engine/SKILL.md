---
name: web-audio-engine
description: >
  Apply when creating, editing, or reviewing the core browser audio engine, transport, scheduling, clip playback, buses, automation, metering taps, offline rendering, or worklet-based DSP nodes. Enforces a Web Audio architecture for this project: AudioContext as the runtime graph, AudioWorklet for custom real-time processing, AudioParam automation for precise parameter scheduling, OfflineAudioContext for export/render workflows, and a clean separation where the engine owns timing/routing while the UI only issues commands and observes state.
---

## Setup

```ts
// src/modules/AudioEngine/models/TransportState.ts
export type TransportState = {
  isPlaying: boolean;
  tempo: number;
  positionSeconds: number;
  loopStartSeconds: number | null;
  loopEndSeconds: number | null;
};
```

```ts
// src/modules/AudioEngine/useCases/createAudioEngine.ts
export type AudioEngine = {
  initialize: () => Promise<void>;
  resume: () => Promise<void>;
  suspend: () => Promise<void>;
  startTransport: (whenSeconds?: number) => Promise<void>;
  stopTransport: () => Promise<void>;
  setTempo: (tempo: number) => void;
  setMasterGain: (gain: number) => void;
  getTransportState: () => TransportState;
  dispose: () => Promise<void>;
};

export type CreateAudioEngine = () => Promise<AudioEngine>;
```

```ts
// src/modules/AudioEngine/repositories/createWebAudioEngine.ts
import type { AudioEngine } from "#/modules/AudioEngine/useCases/createAudioEngine";

export const createWebAudioEngine = async (): Promise<AudioEngine> => {
  const context = new AudioContext({
    latencyHint: "interactive",
  });

  await context.audioWorklet.addModule("/audio/worklets/gain-processor.js");

  const masterGainNode = context.createGain();
  masterGainNode.connect(context.destination);

  let transportState = {
    isPlaying: false,
    tempo: 120,
    positionSeconds: 0,
    loopStartSeconds: null,
    loopEndSeconds: null,
  };

  return {
    initialize: async () => {
      if (context.state !== "running") {
        await context.resume();
      }
    },
    resume: async () => {
      await context.resume();
    },
    suspend: async () => {
      await context.suspend();
    },
    startTransport: async () => {
      if (context.state !== "running") {
        await context.resume();
      }

      transportState = {
        ...transportState,
        isPlaying: true,
      };
    },
    stopTransport: async () => {
      transportState = {
        ...transportState,
        isPlaying: false,
      };
    },
    setTempo: (tempo: number) => {
      transportState = {
        ...transportState,
        tempo,
      };
    },
    setMasterGain: (gain: number) => {
      masterGainNode.gain.value = gain;
    },
    getTransportState: () => {
      return transportState;
    },
    dispose: async () => {
      await context.close();
    },
  };
};
```

```ts
// src/audio/worklets/gain-processor.ts
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

## Core Patterns

### The engine owns time, routing, and playback

```ts
// src/modules/AudioEngine/models/EngineState.ts
export type EngineState = {
  transport: TransportState;
  sampleRate: number;
  blockSize: number;
};
```

The browser audio engine owns:

- transport timing
- current playback position
- loop ranges
- audio routing
- bus topology
- worklet node lifecycle
- scheduling windows
- playback state
- offline render orchestration

The UI does not own those concerns.

The UI may:

- send commands
- subscribe to summarized state
- render meters and cursors
- display playback state
- request renders or exports

### Use `AudioContext` as the live graph root

```ts
// src/modules/AudioEngine/repositories/createProjectGraph.ts
export type ProjectGraph = {
  context: AudioContext;
  destination: AudioNode;
  masterGainNode: GainNode;
};

export const createProjectGraph = (context: AudioContext): ProjectGraph => {
  const masterGainNode = context.createGain();
  masterGainNode.connect(context.destination);

  return {
    context,
    destination: masterGainNode,
    masterGainNode,
  };
};
```

The live playback graph should be rooted in a single `AudioContext`.

Use that context for:

- source nodes
- worklet nodes
- buses
- automation targets
- metering taps
- monitor outputs

Do not create ad hoc audio contexts for random features.

### Use `AudioWorklet` for real-time custom processing

```ts
// src/modules/AudioEngine/repositories/createMeterNode.ts
export const createMeterNode = (context: AudioContext): AudioWorkletNode => {
  return new AudioWorkletNode(context, "meter-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
};
```

Any custom low-latency processor belongs in `AudioWorklet`.

Typical uses:

- meters
- gain/pan utilities
- clip mixing helpers
- utility filters
- sample taps
- scheduler-facing processors
- custom routing helpers

Do not put sample processing in React code or ordinary event handlers.

### Use `AudioParam` for automation and scheduling

```ts
// src/modules/AudioEngine/useCases/applyGainAutomation.ts
export const applyGainAutomation = (
  gainParam: AudioParam,
  startTime: number,
  startValue: number,
  points: Array<{ time: number; value: number }>,
): void => {
  gainParam.cancelScheduledValues(startTime);
  gainParam.setValueAtTime(startValue, startTime);

  for (const point of points) {
    gainParam.linearRampToValueAtTime(point.value, point.time);
  }
};
```

Use `AudioParam` automation APIs for time-based parameter changes:

- `setValueAtTime`
- `linearRampToValueAtTime`
- `exponentialRampToValueAtTime`
- `setTargetAtTime`
- `cancelScheduledValues`

Do not emulate automation with UI timers or frame loops.

### Keep scheduling ahead of the playhead

```ts
// src/modules/AudioEngine/models/SchedulerWindow.ts
export type SchedulerWindow = {
  lookAheadMs: number;
  scheduleAheadSeconds: number;
};
```

Use a scheduler window model for clip and event playback.

The engine should schedule slightly ahead of the current playback position rather than trying to trigger everything exactly at the last moment.

Typical responsibilities include:

- translating timeline positions into audio times
- scheduling clip starts/stops
- handling loop wrap boundaries
- re-scheduling near playhead movement
- tracking what is already scheduled

Do not let the UI drive sample playback timing.

### Separate source preparation from playback scheduling

```ts
// src/modules/AudioEngine/models/ClipPlaybackPlan.ts
export type ClipPlaybackPlan = {
  clipId: string;
  bufferStartSeconds: number;
  projectStartSeconds: number;
  durationSeconds: number;
};
```

Prepare clip playback plans separately from the live scheduling loop.

This keeps:

- timeline logic testable
- scheduling deterministic
- transport operations cleaner
- looping easier to reason about

### Use `OfflineAudioContext` for non-realtime renders

```ts
// src/modules/AudioEngine/useCases/renderProjectOffline.ts
export type RenderProjectOffline = (
  durationSeconds: number,
  sampleRate: number,
) => Promise<AudioBuffer>;

export const renderProjectOffline: RenderProjectOffline = async (
  durationSeconds,
  sampleRate,
) => {
  const length = Math.ceil(durationSeconds * sampleRate);
  const offlineContext = new OfflineAudioContext({
    numberOfChannels: 2,
    length,
    sampleRate,
  });

  const gainNode = offlineContext.createGain();
  gainNode.connect(offlineContext.destination);

  return offlineContext.startRendering();
};
```

Use `OfflineAudioContext` for:

- export rendering
- freeze/bounce workflows
- offline analysis passes
- waveform precomputation when appropriate
- deterministic render jobs

Do not use the live `AudioContext` for export pipelines when an offline render path is more appropriate.

### Metering should be tap-based, not UI-polled business logic

```ts
// src/modules/AudioEngine/models/MeterReading.ts
export type MeterReading = {
  peakLeft: number;
  peakRight: number;
  rmsLeft: number;
  rmsRight: number;
};
```

Metering should come from dedicated taps/processors in the audio path.

The UI should observe summarized meter state.

Do not compute meters by pulling arbitrary data out of business objects in React.

### Keep node graph construction deterministic

```ts
// src/modules/AudioEngine/useCases/createTrackGraph.ts
export type TrackGraph = {
  inputNode: GainNode;
  preFaderNode: GainNode;
  postFaderNode: GainNode;
};
```

Build graph topology through deterministic graph builders.

Examples:

- track graph
- bus graph
- master graph
- monitor graph
- analysis tap graph

Avoid scattered imperative graph mutations throughout the UI layer.

### Use explicit command/use-case boundaries for engine actions

```ts
// src/modules/AudioEngine/useCases/setTempo.ts
export type SetTempo = (tempo: number) => void;
```

All engine mutations should happen through explicit engine actions/use cases such as:

- set tempo
- start transport
- stop transport
- seek transport
- set loop region
- set track gain
- mute track
- solo track
- arm record
- connect bus
- disconnect bus

Do not let arbitrary components poke engine internals directly.

### Move heavy numerical kernels to WASM when needed

```ts
// src/modules/Dsp/repositories/loadDspWasm.ts
export const loadDspWasm = async () => {
  const response = await fetch("/wasm/dsp.wasm");
  const bytes = await response.arrayBuffer();

  return WebAssembly.instantiate(bytes, {});
};
```

When real-time JS in a worklet becomes too expensive, move the hot numerical kernel into WASM.

Typical candidates:

- FFT-heavy analysis
- pitch/time operations
- resampling
- convolution helpers
- heavy feature extraction
- complex utility DSP

The worklet still owns real-time orchestration; WASM owns the inner kernel.

## Common Mistakes

### CRITICAL Putting audio timing in React state

Wrong:

```tsx
const [position, setPosition] = useState(0);

useEffect(() => {
  const id = setInterval(() => {
    setPosition((value) => value + 0.01);
  }, 10);

  return () => {
    clearInterval(id);
  };
}, []);
```

Correct:

```ts
// transport position lives in the engine and is observed by the UI
```

React is not the transport clock.

### CRITICAL Processing samples on the main thread

Wrong:

```ts
for (let i = 0; i < samples.length; i += 1) {
  samples[i] = samples[i] * gain;
}
```

Correct:

```ts
// run sample processing inside AudioWorklet or WASM called from AudioWorklet
```

Sample processing must not live in React components, standard hooks, or random UI event handlers.

### CRITICAL Treating automation as UI animation

Wrong:

```ts
requestAnimationFrame(() => {
  gainNode.gain.value = nextValue;
});
```

Correct:

```ts
gainNode.gain.setValueAtTime(currentValue, startTime);
gainNode.gain.linearRampToValueAtTime(nextValue, endTime);
```

Automation belongs on `AudioParam` timelines, not UI timing loops.

### HIGH Building export/bounce on the live audio context

Wrong:

```ts
// render export by playing the live engine and recording it in real time
```

Correct:

```ts
const offlineContext = new OfflineAudioContext({
  numberOfChannels: 2,
  length,
  sampleRate,
});
```

Use offline rendering for non-realtime export paths.

### HIGH Letting components mutate the graph directly

Wrong:

```tsx
button.onClick = () => {
  trackNode.disconnect();
  trackNode.connect(audioContext.destination);
};
```

Correct:

```ts
// dispatch a use-case/command that updates graph topology through the engine layer
```

Graph mutations should be centralized and deterministic.

### HIGH Creating too many unrelated audio contexts

Wrong:

```ts
const previewContext = new AudioContext();
const transportContext = new AudioContext();
const meteringContext = new AudioContext();
```

Correct:

```ts
const mainContext = new AudioContext({
  latencyHint: "interactive",
});
```

Use one main live context unless there is a very strong reason not to.

### HIGH Mixing UI concerns into engine internals

Wrong:

```ts
if (sidebarIsOpen) {
  gainNode.gain.value = 0.9;
}
```

Correct:

```ts
// engine logic responds to engine commands and transport/routing state only
```

The engine should not care about random presentation state.
