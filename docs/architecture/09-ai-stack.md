# AI Stack

This page separates code in the repository from features admitted for the current
source build. Model weights are separate artifacts with separate terms.

## Language models

- Hosted Anthropic, OpenAI, and OpenAI-compatible providers are available through
  the desktop native gateway. Configure them with
  `SOURDAW_ANTHROPIC_API_KEY`, `SOURDAW_OPENAI_API_KEY`, or
  `SOURDAW_OPENAI_COMPATIBLE_API_KEY`, respectively.
- The exact pinned WebLLM Qwen conversions admitted by ADR 0036 are available on
  browser and desktop release surfaces. WebLLM may be selected on any platform,
  but runtime use still requires WebGPU; explicit selection fails closed when
  that capability is unavailable and never falls back to a hosted provider.
  Artifact admission is separate from runtime capability: the release manifest
  pins and verifies each artifact before storage or inference. ADR 0036 records
  the remaining unproven exact Qwen checkpoint mapping and build inputs; those
  gaps must not be represented as proven provenance. Browser hosted credentials
  are not supported. An unauthenticated OpenAI-compatible loopback endpoint
  remains a local browser path.

## Audio and speech models

| Capability      | Current truth                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic Pitch     | Bundled and admitted for audio-to-MIDI.                                                                                                                             |
| Kokoro          | Code is present and admitted on demand; voice weights are downloaded and cached locally.                                                                            |
| DDSP            | Code is present and admitted on demand. Sourdaw downloads checkpoints directly and does not redistribute their weights; the exact checkpoint license is unverified. |
| Whisper         | Desktop-native dictation uses a cached or explicitly supplied local model.                                                                                          |
| RAVE            | Unavailable; its model path is withheld from admission.                                                                                                             |
| Stem separation | Unavailable; no compatible model is admitted.                                                                                                                       |

The source tree can contain runtime code, manifests, and integration paths that
are not release-admitted. Admission is the product boundary, not the import graph.
Code licenses also do not settle the license or redistribution terms for model
weights. Check the terms attached to each downloaded artifact.

## Actions

Model output does not write project state directly. Only admitted actions can
pass validation and any required confirmation into the shared application action
path. Each action inherits only the persistence, undo, and collaboration
semantics that its existing path provides.
