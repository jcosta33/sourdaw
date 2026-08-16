---
type: adr
id: 0027
title: Windows device layer is IAudioClient3 shared low-latency, with WASAPI Exclusive opt-in and no ASIO
status: accepted
date: 2026-08-16
owner: The Sourdaw team
sources:
    - https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-iaudioclient3
    - https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio
    - https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams
    - https://www.steinberg.net/developers/
    - https://github.com/RustAudio/cpal
    - .agents/decisions/0012-neither-target-degrades-the-other.md
---

# 0027 — Windows device layer is IAudioClient3 shared low-latency, with WASAPI Exclusive opt-in and no ASIO

**Accepted 2026-08-16.** Decided by the product owner. Records the Windows half of the native audio
backend named in the "Electron shell & native audio backend" campaign, and governs the wave that
implements the Windows device layer and the wave that builds the Windows target.

## Context

The desktop engine becomes one Rust implementation whose device layer is native, with `cpal` as the
host abstraction — `crates/daw-engine/Cargo.toml` already depends on it, and `engine_events.rs`
already maps its stream errors onto a fixed engine vocabulary. The web target keeps Web Audio as its
device layer; per ADR 0012 neither target may be degraded to accommodate the other, so the Windows
choice is a desktop-only concern and cannot reach back into the web build.

Windows is the one platform where the device layer is a real choice rather than a single obvious
API. Musicians on Windows associate low latency with ASIO, and every DAW on the platform has had to
answer whether it ships an ASIO host. The question is which device APIs Sourdaw commits to, and
therefore which latency envelope it promises and which licensing obligations it accepts.

The decision is being recorded before implementation, so it is stated as a commitment to APIs and to
a user-facing mode, not as a claim about measured latency.

## Options considered

**IAudioClient3 shared low-latency (chosen as default).** Windows shared mode runs every application
through the system audio engine at a fixed engine period — historically 10 ms. `IAudioClient3` adds
period negotiation: an application queries the driver's supported period range and initializes a
shared stream at a smaller period where the driver supports it, without taking the device away from
anything else. Nothing is licensed, nothing is bundled, and it works against every Windows audio
device because the system engine is always in the path.

**WASAPI Exclusive (chosen as opt-in).** An exclusive-mode stream bypasses the system audio engine
and hands the endpoint buffer to one application, which is the lowest latency the platform offers
without a vendor driver. The cost is the exclusive claim itself: no other application produces sound
on that device while the stream is open, and the format must be one the endpoint accepts natively.
That is a trade the user must make deliberately, so it is a mode, not a default.

**ASIO (rejected).** ASIO is Steinberg's driver API and remains the Windows convention for
lowest-latency audio. Using it requires accepting Steinberg's proprietary ASIO SDK licensing
agreement, which conflicts with Sourdaw's distribution and licensing posture. The rejection is on
licensing terms, not on technical merit. The IAudioClient3 and Exclusive pair covers the latency
envelope the product targets, so no user-facing capability is traded away for the licensing
position.

## Decision

The Windows device layer of the native audio backend is **IAudioClient3 low-latency shared mode by
default, with WASAPI Exclusive available as an explicit user opt-in. Sourdaw does not host ASIO.**

Both modes are WASAPI facilities reached through the platform's own headers, so the Windows device
layer adds no third-party audio SDK and no vendor runtime to what Sourdaw ships. `cpal`'s WASAPI host
is the integration point; where its surface does not already expose period negotiation or exclusive
initialization, the implementing wave extends that seam rather than introducing a second device
abstraction alongside it.

Performance benchmarks are explicitly waived for this decision. No wave may assert a latency
improvement as an acceptance condition of this ADR, and no user-facing copy may quote a latency
figure that has not been measured on the shipped build.

## Consequences

- The Windows device-layer implementation wave (DSP wave D4) builds against `IAudioClient3` and
  WASAPI Exclusive only. An ASIO host is out of scope for that wave and for any successor wave,
  unless a later ADR supersedes this one on new licensing terms.
- The Windows build lane (cargo-xwin, campaign wave E6) needs no vendor SDK in its toolchain image —
  the Windows SDK headers cross-compilation already provides are sufficient for both modes.
- Exclusive mode is a user-visible setting with a user-visible cost. It must state that the device is
  claimed exclusively and that other applications lose audio on it while Sourdaw holds the stream,
  and it must fall back to the shared-mode default when the endpoint refuses the requested format.
- Device selection and mode selection are separate concerns. A device that cannot be opened in
  exclusive mode is still a usable device in shared mode, and the engine's error vocabulary must
  distinguish "this device is unavailable" from "this device refused exclusive access".
- Users who require ASIO-only hardware behavior are not served by Sourdaw on Windows. That is an
  accepted product consequence of the licensing position, not a defect to be worked around.

## Sources

- `IAudioClient3` interface: https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-iaudioclient3
- Low latency audio (shared-mode engine period, driver-supported smaller periods):
  https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio
- Exclusive-mode streams: https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams
- Steinberg developer resources, ASIO SDK licensing: https://www.steinberg.net/developers/
- `cpal` WASAPI host: https://github.com/RustAudio/cpal
