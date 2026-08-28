# Release

## Semantic version, changelog, and GitHub Release

A version is created by an explicit operator command and by nothing else. No workflow trigger cuts
one, so a deploy — daily or otherwise — leaves the version, the tags, the releases, and
`CHANGELOG.md` exactly as it found them.

Merged pull-request titles are the only source. A squash merge carries its pull request's title onto
`main`, and both commands read the titles back from the pull requests the tag range names, never
from a commit body.

The increment comes from the strongest title in the range: a `!` on any type is breaking, `feat` is
a feature, `fix` and `perf` are fixes, and every other conventional type asks for no version at all.
A range that asks for nothing proposes nothing.

While the major is `0` the leading zero already says the surface may change, so a breaking change
and a feature both take the minor position and a fix takes the patch position. Automation never
emits `1.0.0`: declaring a stable product surface is an owner decision, so the first `1.0.0` is a
deliberate manual edit of `package.json` and the increments above resume from it under the standard
mapping.

The baseline is the latest `vX.Y.Z` tag — the last version that actually exists — and the increment
is what the range above it asks for. Until the first tag exists the baseline is whatever
`package.json` on `main` says, so the first release is that version plus its increment.

`package.json` on `main` may sit ahead of that tag: a release pull request merged and was never
tagged, which is where a refused cut leaves the repository. Proposing again from that state is the
recovery, so it is accepted and the whole tag range is recomputed — the new proposal supersedes the
bump that was never released and often lands on the same version. A manifest _below_ the latest tag
is the one disagreement nothing here produces; it means the version was moved by hand, and it is
refused outright.

Propose the release from a lane:

```sh
pnpm lane:open release
cd <lane>
pnpm release:propose
```

It rewrites the version, the changelog entry, and every digest the release gates pin to
`package.json`, all from the base revision. Running it again rebuilds that proposal from scratch —
it drops every changelog entry above the newest released one, so a rerun after `main` moved replaces
the stale proposal rather than recording a version that was never tagged. A released entry is a fact
and is never touched. Commit it with the conventional subject it prints, then open the pull request
with `pnpm lane:publish` from the primary checkout, and deliver it the ordinary way — reviewed, then
`pnpm deliver`.

Cut the release from the primary checkout, against the squash commit that merge left on `main`:

```sh
git fetch origin main --tags
pnpm release:cut <X.Y.Z> --commit <merge-sha>
```

It creates the annotated tag on that exact revision and one GitHub Release bound to it, through the
same author App the delivery scripts mint.

The release pull request's own merge sits at the end of the range being tagged, and the proposal
that wrote the changelog could not have contained it, so it is dropped from the notes — which is
what makes the notes the set the changelog recorded. It is identified by the pull-request number its
squash subject names, not by that subject's text: a recovery re-proposes the same version, so an
earlier `chore(release)` merge in the range can carry exactly the same subject. That earlier one is
an ordinary entry on both sides — the proposal keeps it, and so do the notes.

Cut refuses a tag or release that already exists, a commit `main` does not contain, a commit whose
`package.json` is a different version, a revision whose squash names no pull request, a version that
does not advance the latest tag, and a committed changelog entry that disagrees with the notes the
tag range produces. That last one means the range moved after the proposal — something merged while
the release pull request was in review. Open a fresh lane on `main` and run `pnpm release:propose`
again: it accepts the merged-but-uncut manifest, rebuilds the entry over the whole range, and the
release pull request it opens supersedes the one that was already merged. Cut that second merge.

`CHANGELOG.md` records every entry in the range. GitHub caps a release body, so a range too long to
publish whole is cut at an entry boundary and the body points at the committed changelog for the
rest — which is the shape a first release covering a long unreleased history takes.

The release carries notes and source. It ships no desktop binaries.

## Release proof

A release candidate is one external directory whose source, web, and macOS
arm64 desktop artifacts carry the same full Git revision. Assemble it from a
clean Sourdaw checkout and local Electron and FFmpeg Git checkouts at the revisions in
`public/legal/ELECTRON-SOURCES.json`:

```sh
pnpm guard --profile extended --max-rss-mib 6144 --require-target -- \
  pnpm release:proof:assemble -- \
    --output <candidate-directory> \
    --electron-source <electron-git-checkout> \
    --ffmpeg-source <ffmpeg-git-checkout>
```

The assembler clears the ignored web output, runs `pnpm build`, and snapshots
that result before clearing the ignored desktop outputs and running
`pnpm desktop:build`. It accepts exactly one newly produced
`Sourdaw-<version>-arm64-mac.zip` and derives its resource census,
legal-file hashes, application layout, and arm64 executable identity by
extracting the ZIP itself. It rechecks the Git revision and complete source
cleanliness after each build, validates the candidate in a temporary sibling
directory, and publishes the requested output directory only after every check
passes.

The candidate includes revision-rooted Sourdaw, Electron, and FFmpeg source
archives from verified Git commits. Its adjacent FFmpeg build manifest and
Electron build-input copies are generated from the pinned Electron commit and
identify the macOS arm64 release target and `libffmpeg.dylib` output.

Validate the complete candidate from the same Sourdaw revision:

```sh
pnpm guard --profile extended --max-rss-mib 6144 --require-target -- \
  pnpm release:proof -- --candidate <candidate-directory>
```

Validation fails when any manifest is malformed or stale; an artifact,
archive, commit object, source tree, build input, notice, or legal file is
missing or changed; material is not adjacent to the desktop ZIP; the package
layout or architecture is wrong; or source, web, and desktop evidence does not
bind to the same revision. It also verifies the packaged Electron fuses,
`libffmpeg.dylib`, and `app.asar` renderer against the exact installed runtime
and renderer output used by the in-process desktop build. Unreferenced files
also fail the candidate's closed file census. The aggregate release inventory,
Electron provenance, LGPL provenance, and project-license gate runs for the
same unchanged revision before the candidate directory is published.
