# Release Proof

OS-12 release candidates are assembled and checked with the same exact Git
revision. The proof directory is an external candidate directory; it is not
committed to the repository and it must not contain the proof manifest itself
as a hashed artifact.

Build the web distribution first, obtain the macOS arm64 package, and extract
that package's `Contents/Resources` directory. Supply the extracted directory
and the complete FFmpeg source archive plus its build manifest to the
assembler:

```sh
pnpm release:proof:assemble -- \
  --output <candidate-directory> \
  --web-dist dist \
  --desktop-artifact <macOS-arm64-package> \
  --desktop-contents <extracted-Contents-Resources> \
  --ffmpeg-source <FFmpeg-source-archive> \
  --ffmpeg-build <FFmpeg-build-manifest>
```

Assembly requires a clean worktree. It creates a source archive from `HEAD`,
a deterministic web ZIP with a file manifest, and a desktop proof containing
the package digest, an exact extracted-content census, Electron legal bytes,
the pinned Electron source manifest, and adjacent FFmpeg source/build
material. Every generated manifest carries the same full Git revision.

Validate the candidate from that same checkout with:

```sh
pnpm release:proof -- --candidate <candidate-directory>
```

Validation fails closed for malformed or stale manifests, unsafe paths,
missing or changed files, a source archive from another revision, web archive
and content-census drift, a non-macOS-arm64 package, missing notices, or
missing/mismatched Electron FFmpeg source and build material. The existing
inventory, Electron provenance, LGPL provenance, and project-license checks
remain separate required gates.

The proof does not claim a reproducible Faust compiler build. The existing
LGPL provenance gate continues to pin the FaustWasm package, wrapper source,
compiler source, and distributed bytes; OS-12 treats that source-and-relinking
evidence as the obligation being checked. No new architecture decision is
introduced by the release-proof tooling, so no ADR is required.
