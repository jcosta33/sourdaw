# AI Stack

This page separates code in the repository from features admitted for the current
source build. Model weights are separate artifacts with separate terms.

## Language models

- Hosted Anthropic, OpenAI, and OpenAI-compatible providers are available through
  the desktop native gateway. Configure them with
  `SOURDAW_ANTHROPIC_API_KEY`, `SOURDAW_OPENAI_API_KEY`, or
  `SOURDAW_OPENAI_COMPATIBLE_API_KEY`, respectively.
- WebLLM and its Qwen-oriented code are present in the repository, but the model
  artifacts are not admitted for the current release surface. Browser hosted
  credentials are not supported. An unauthenticated OpenAI-compatible loopback
  endpoint remains a local browser path.

## Audio and speech models

| Capability      | Current truth                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Basic Pitch     | Bundled and admitted for audio-to-MIDI.                                                         |
| Kokoro          | Code is present and admitted on demand; voice weights are downloaded and cached locally.        |
| DDSP            | Code is present and admitted on demand; instruments are downloaded directly and cached locally. |
| Whisper         | Desktop-native dictation uses a cached or explicitly supplied local model.                      |
| RAVE            | Unavailable; its model path is withheld from admission.                                         |
| Stem separation | Unavailable; no compatible model is admitted.                                                   |

The source tree can contain runtime code, manifests, and integration paths that
are not release-admitted. Admission is the product boundary, not the import graph.
Code licenses also do not settle the license or redistribution terms for model
weights. Check the terms attached to each downloaded artifact.

## Actions

Model output does not write project state directly. It becomes a typed proposal,
passes validation and any required confirmation, then enters the same application
action path as a human edit. That preserves project persistence, undo, and
collaboration semantics.
