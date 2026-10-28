# Lesson library: asset cache publication

A session may remain current while an active clip's decoded-audio target changes.
Session ownership alone cannot authorize delayed PCM publication into that target.

## Escape: a current session retained a revoked clip alias

Commit `1d27112e9ac94295f965b35ec8856a07023f63cc` introduced the peer-asset resolver;
GitHub returns no associated PR. PR #3955 added session-owner fences but retained
the same-session alias and empty-cache races. Historical reviewer prompts and tiers
are unestablished; the missing probe is target revocation during read/decode.

Hold the shared asset resolver at blob read and decode independently. Keep its
session current; change the track, clip, hash or buffer identity, or fill the slot
before the old completion. Old PCM must not publish, while later unchanged aliases
still resolve. Capture the target before waiting and re-read its active association
and empty-slot authority after each yield and before caching. Removing only alias
validation or only the empty-slot guard must fail the connected producer case;
unchanged-current and later-alias controls must still pass.
