# Release Proof

A release candidate is one external directory whose source, web, and macOS
arm64 desktop artifacts carry the same full Git revision. Assemble it from a
clean Sourdaw checkout, the built web distribution, the packaged desktop ZIP,
and local Electron and FFmpeg Git checkouts at the revisions in
`public/legal/ELECTRON-SOURCES.json`:

```sh
pnpm release:proof:assemble -- \
  --output <candidate-directory> \
  --web-dist dist \
  --desktop-artifact <Sourdaw-version-mac-arm64.zip> \
  --electron-source <electron-git-checkout> \
  --ffmpeg-source <ffmpeg-git-checkout>
```

The assembler preserves the desktop artifact's ZIP filename and derives its
resource census, legal-file hashes, application layout, and arm64 executable
identity by extracting that ZIP itself. It creates revision-rooted Sourdaw,
Electron, and FFmpeg source archives from verified Git commits. The adjacent
FFmpeg build manifest and Electron build-input copies are generated from the
pinned Electron commit and identify the macOS arm64 release target and
`libffmpeg.dylib` output.

Validate the complete candidate from the same Sourdaw revision:

```sh
pnpm release:proof -- --candidate <candidate-directory>
```

Validation fails when any manifest is malformed or stale; an artifact,
archive, commit object, source tree, build input, notice, or legal file is
missing or changed; material is not adjacent to the desktop ZIP; the package
layout or architecture is wrong; or source, web, and desktop evidence does not
bind to the same revision. The release inventory, Electron provenance, LGPL
provenance, and project-license checks remain required release gates.
