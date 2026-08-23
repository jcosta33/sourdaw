# Privacy

This page describes the current implementation. It is not a promise about code
that has not shipped yet.

## Local data

Project state is persisted locally on the browser or desktop surface in use.
Desktop can read and write user-selected project and audio files. Downloaded
models and their caches are stored locally.

## Optional hosted AI

Hosted AI is an optional desktop feature. Depending on the request, it may send
system instructions, prompt text, project context, metadata, MIDI, lyrics,
filenames, or preset information to the selected Anthropic, OpenAI, or
OpenAI-compatible provider. Microphone audio, raw audio, renders, stems,
reference audio, generated media, and listening audio are blocked from this
hosted path by the current policy.

Provider retention for application state, abuse monitoring, prompt caches,
safety/legal exceptions, and other retention is unknown to Sourdaw. Check the
provider's policy before sending project material.

Desktop credentials are read by the native provider gateway from its configured
environment variables and kept behind an opaque session ID. The browser has no
hosted credential surface; its OpenAI-compatible provider path is loopback-only
and carries no credential.

## Models

Some model code is bundled while model weights are downloaded directly on demand
and cached locally. Code licenses and model-weight terms are separate questions;
the presence of a code package does not grant rights to every weight it can load.

## Collaboration and network traffic

Direct WebRTC collaboration uses STUN for connection discovery. STUN can expose a
peer's public IP to the peers involved in connection setup; the data channel is
direct when connectivity allows. Collaboration can also use an optional
authenticated WebSocket relay, which carries session, peer, action, cursor, and
state messages. The relay binds to loopback by default but can be configured
otherwise. Native LAN discovery uses mDNS.

No Sourdaw telemetry or analytics collection was found in the current source.
