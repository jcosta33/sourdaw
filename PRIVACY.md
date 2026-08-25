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
OpenAI-compatible provider. Sourdaw's current hosted-request policy rejects
microphone audio, raw audio, renders, stems, reference audio, generated media,
and listening audio. That is application policy, not enforcement by provider
transport.

Provider retention for application state, abuse monitoring, prompt caches,
safety/legal exceptions, and other retention is unknown to Sourdaw. Check the
provider's policy before sending project material.

Desktop credentials are read by the native provider gateway from its configured
environment variables. Opaque sessions keep those credentials out of renderer
code only. Desktop CLAP plugins run in the native application process and are not
a credential isolation boundary. The browser has no hosted credential surface;
its OpenAI-compatible provider path is loopback-only and carries no credential.

## Models

Some model code is bundled while model weights are downloaded directly on demand
and cached locally. Code licenses and model-weight terms are separate questions;
the presence of a code package does not grant rights to every weight it can load.

## Collaboration and network traffic

Direct WebRTC collaboration uses STUN for connection discovery. STUN operators
receive connection metadata including source IP, and their own policies apply.
Peers may also learn each other's public IP during connection setup; the data
channel is direct when connectivity allows.

Collaboration can also use an optional WebSocket relay. A relay can read the
session, peer, action, cursor, and state payloads it forwards. The included relay
requires `COLLAB_AUTH_TOKEN` and binds to loopback by default, but can be
configured otherwise. Transport security, logging, and retention depend on the
operator's deployment; relay transport is not end-to-end confidentiality. Native
LAN discovery uses mDNS.

Sourdaw sends no application telemetry or analytics. AI providers, model hosts,
STUN operators, and relay operators may log traffic under their own policies.
