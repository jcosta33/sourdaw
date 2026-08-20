---
type: adr
id: 0031
title: Sourdaw hosts CLAP and VST3; VST2 and Audio Units are permanently out
status: accepted
date: 2026-08-20
owner: The Sourdaw team
sources:
    - https://github.com/steinbergmedia/vst3sdk
    - https://www.steinberg.net/developers/
    - https://crates.io/crates/vst3
    - https://crates.io/crates/com-scrape-types
    - https://github.com/free-audio/clap
    - https://developer.apple.com/documentation/audiounit
    - .agents/decisions/0004-plugin-hosting-security-policy.md
    - .agents/decisions/0021-plugin-isolation-by-binary-with-per-plugin-override.md
    - .agents/decisions/0027-windows-device-layer-iaudioclient3.md
---

# 0031 — Sourdaw hosts CLAP and VST3; VST2 and Audio Units are permanently out

**Accepted 2026-08-20.** Records which native plugin formats Sourdaw commits to hosting, and why the
excluded ones are excluded. It governs every packet that touches the plugin host, and it is the
single source of the reasons the scanner and `load_plugin` give a user when they refuse a file.

## Context

A DAW's plugin format support is a promise to a musician's existing library, not an implementation
detail: it decides which of the plugins they already own will open. It is also the one part of the
plugin host with legal terms attached, and those terms differ per format and are not symmetric — one
of them cannot be entered into at all any more.

Sourdaw hosts CLAP today. VST3 is recognised by the scanner and refused. Audio Units are recognised
and refused. VST2 was not recognised at all, so a VST2 bundle sitting among a user's other plugins
was passed over in silence, leaving them a short list and no reason for it.

The question this record settles is which formats Sourdaw commits to, so that the refusals can state
a reason instead of a category, and so that no later packet has to relitigate the licensing.

## Decision

**CLAP is in.** It is permissively licensed (MIT), needs no agreement with anyone, and is the format
Sourdaw hosts today.

**VST3 is in, on the MIT-licensed VST SDK 3.8.** Steinberg released VST SDK 3.8 on 2025-10-20 under
the MIT licence, replacing the earlier dual GPLv3-or-proprietary arrangement. Three obligations come
with taking it, and all three are accepted here:

- **Licensing basis.** The SDK is used under the MIT licence. Sourdaw signs nothing: the proprietary
  Steinberg VST 3 licensing agreement that earlier SDK versions required to ship a closed-source host
  is not needed for 3.8, and no such agreement is to be sought or signed. The MIT grant applies to
  SDK **3.8.0 and later only**; it is not retroactive, so no older tag may be taken on the strength
  of this record. Steinberg's ASIO SDK is a separate product on separate terms (GPLv3 or proprietary
  as of October 2025) and is not part of `vst3sdk` — it is out of scope here and stays out under
  [ADR 0027](0027-windows-device-layer-iaudioclient3.md), which ships no ASIO.
- **Notice retention.** MIT requires the copyright notice and the permission notice to be retained in
  all copies and substantial portions of the software. This obligation is Sourdaw's to discharge and
  no dependency discharges it for us: the `vst3` crate ships no Steinberg notice, only its own
  author's licence files. The packaged app therefore carries, in its third-party notices,
  `MIT License / Copyright (c) 2025 Steinberg Media Technologies GmbH` together with the full MIT
  permission text. That notice file lands with the VST3 packet, in the same change as the code that
  creates the obligation.
- **Trademarks are not licensed by MIT.** "VST" and the VST logo remain Steinberg trademarks, and a
  copyright licence conveys no trademark rights. Where Sourdaw's UI or documentation names the format
  it writes "VST®" on first use of "VST" and carries the line
  `VST is a registered trademark of Steinberg Media Technologies GmbH.` **Sourdaw never ships the VST
  logo**: displaying it pulls in the full logo usage guidelines for no user benefit, and the name
  alone identifies the format. Per Steinberg's own statement, failing the logo guidelines does not
  affect rights under the MIT licence, so declining the logo costs nothing.

**The VST3 bindings come from the `vst3` crate**, version 0.3.0 on crates.io (published 2025-12-07,
`MIT OR Apache-2.0`), whose sole dependency is `com-scrape-types` 0.1.1 under the same terms. It
ships pregenerated bindings tracking SDK 3.8.0 — its `bindings.rs` carries
`SDKVersionString = "VST 3.8.0"` — with no build script and no SDK checkout, so the workspace gains
no `libclang`, `cc`, or `cmake` step and **no C or C++ compilation unit at all**. That is the
deciding property: a pure-Rust dependency edge keeps VST3 inside the build Sourdaw already has.

**VST2 is out, permanently, on two independent grounds.** Steinberg stopped issuing the VST2 licence
agreement in October 2018; that agreement is the only lawful basis on which a host may implement
VST2, and it cannot now be obtained by a host that did not already hold one — which Sourdaw does not
and never will. Separately and sufficiently on its own: **no VST2 SDK header, or any derivative or
transcription of one, may enter this repository**, at any time, for any purpose, including tests and
fixtures. Either ground alone closes the format. This is not a scheduling decision and no future
packet may revisit it.

**Audio Units are out.** AU is an Apple-only format. Sourdaw is cross-platform, CLAP and VST3 each
cover every platform Sourdaw targets, and the overwhelming majority of AU plugins ship a VST3 or CLAP
build of the same product. Hosting a macOS-only format would mean a second instantiation, editor, and
processing path maintained for one platform, to reach plugins their vendors already ship in a format
Sourdaw will host.

## Consequences

- The scanner recognises `.vst3` bundles, `.vst` bundles (VST2) and `.component` bundles and refuses
  each one by name, with the reason above, rather than passing over them in silence. `load_plugin`
  refuses in the same words, from the same constants, so a user is never told two different stories
  about one file.
- **A bare `.dll` is not recognised as VST2**, and that is a decision rather than an omission.
  Windows VST2 ships as a bare module, so recognising the extension looks like the matching half of
  the `.vst` bundle rule — but no scan can reach a VST2 folder. `PluginScanPolicy::platform_defaults`
  is production's only policy constructor, and its `authorize_scan_root` admits only descendants of
  the fixed VST3, CLAP and Components roots. What a `.dll` rule would match instead is the vendor
  support and runtime libraries inside those authorized Windows roots, which the walk recurses into:
  every one of them would be reported to the user as a VST2 plugin that will never load, which is a
  fabricated claim about a file that is not a plugin. A refusal must be true of the file it names.
  Recognising `.dll` becomes correct only alongside a production path that can authorize a VST2 root.
- **A refusal is not an error.** The scan reports refusals on a channel of its own, separate from the
  failures — a root it could not read, a candidate the worker crashed on, a safety limit reached.
  The VST3 roots are scanned by default on every platform, so a user who owns one VST3 plugin would
  otherwise see a permanently failed scan for a run in which nothing went wrong, and would learn to
  ignore the channel that reports the failures that matter.
- VST3's refusal is temporary and says so; VST2's and AU's are permanent and say so. A refusal that
  reads as "not yet" for a format that will never arrive is a promise Sourdaw cannot keep.
- The VST3 packet inherits the obligations above as acceptance conditions — the Steinberg notice in
  the packaged app's third-party notices, and the trademark line wherever the UI names the format —
  and re-reads Steinberg's own licence and trademark text at the version it takes before that code
  lands. Nothing in this record substitutes for the licence text shipping with the SDK.
- One accepted risk, recorded rather than mitigated away: `vst3` 0.3.0 is a single-maintainer crate
  pinned to SDK 3.8.0 while upstream has moved to 3.8.1. It is bounded — roughly fifteen thousand
  lines of generated `#[repr(C)]` vtable declarations over one dependency — so regenerating or
  forking it is ordinary work rather than a cliff, and no packet needs a contingency plan beyond
  that.
- Nothing here relaxes [ADR 0004](0004-plugin-hosting-security-policy.md). A VST3 host loads
  third-party native code and is bound by the same scan policy, the same out-of-process discovery,
  and the same isolation model as CLAP.

## Alternatives rejected

**CLAP only.** Honest and cheap, but it strands the plugin libraries musicians actually own: VST3 is
the format most commercial vendors ship first, and a DAW that cannot open them is not a DAW a working
musician can move to.

**VST3 under the older GPLv3/proprietary dual licence.** GPLv3 is incompatible with Sourdaw's
distribution, and the proprietary branch requires a signed Steinberg agreement with reporting and
branding conditions attached. MIT-licensed 3.8 removes the choice between those two, which is what
makes VST3 takeable now.

**Other VST3 binding sources.** `vst3-sys` is GPL-3.0, was never published to crates.io, has had no
commit since June 2023, and describes itself as a derivative of the SDK — unusable in a proprietary
product on the licence alone. `vst3-bindgen` is superseded by the committed bindings in `vst3` 0.3.0.
Vendoring the SDK headers behind a C++ shim would introduce the workspace's first C++ toolchain, and
buy nothing: the interfaces are pure vtables that generated Rust declares directly.

**Audio Units for macOS parity.** Rejected: a platform-specific format's cost is paid on every
release forever, and the plugins it would reach are almost entirely reachable through VST3 or CLAP
already.
