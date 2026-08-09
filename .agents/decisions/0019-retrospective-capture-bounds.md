# 0019 — Retrospective capture: event-bounded, inactivity-flushed, MIDI first

**Status: proposed** — resolves `SPEC-retrospective-capture` DG-001, DG-002, DG-003 and DG-006.

These four gates block 68 acceptance criteria between them. Nothing retrospective exists in the tree
today: `startBackgroundCapture.ts` guards on `!state.enabled` and pushes a bookkeeping record into a
store, no ring is allocated, and MIDI retains nothing either.

## What the industry does

All three reference DAWs ship this feature, and they agree on more than they differ on.

**Cubase — bounded by event count, not by time.** The Retrospective Record Buffer Size preference
"determine[s] how much MIDI data can be captured in the buffer"; the buffer "captures up to 10000
MIDI events, which can amount to a MIDI recording of around 2 minutes and 30 seconds. However, if you
use a keyboard that produces a large amount of MIDI controller events, such as the ROLI Seaboard,
this only corresponds to a recording of around 20 seconds." When full, "the MIDI events that were
captured first are replaced by the new events." Insertion targets the selected track, and the buffer
persists after an insert — Cubase ships a separate "Emptying the Retrospective Record Buffer"
command.

That single passage is the most useful piece of evidence available: it states the bound in events,
gives the time range it implies, and names the exact case where the two diverge by a factor of seven.

**Logic — bounded by inactivity.** Flashback Capture "captures and temporarily stores incoming MIDI
events or audio from a performance." "After a pause of 20 seconds between incoming MIDI events, those
initial MIDI events before the pause are discarded." With Cycle off it "creates a region containing
all the MIDI events received during playback", and on stop "a separate region containing all the MIDI
events received since the last playback."

**Live — MIDI only, monitored tracks.** "Capture MIDI lets you retrieve the material you've just
played on those tracks." "A new clip containing the phrase you played will be created on every
monitored MIDI track." The manual states no buffer bound.

**Only Logic retains audio**, and it does so behind a separate documented feature ("Capture a recent
audio performance") rather than as part of the MIDI path.

## Decisions

**DG-006 — MIDI first; audio is a separate later feature.** Two of three DAWs capture MIDI only, and
the one that captures audio ships it as a distinct feature with its own settings. Splitting the same
way keeps the always-on cost proportionate: a MIDI ring is kilobytes, an audio ring is megabytes per
channel-minute, and the spec's own AC-013 already gates audio start on the route being *armed*.

**DG-001 — bound the buffer by event count, not by duration.** Follow Cubase. A duration bound is a
promise the implementation cannot keep, because event density varies by more than an order of
magnitude between a keyboard part and an MPE controller — the ROLI case in Cubase's own manual is the
proof. State the bound in events, publish the implied time range, and say what it degrades to.

**DG-003 — flush on inactivity, retain across a successful capture.** Logic discards after a 20-second
gap between events; Cubase keeps the buffer after an insert and provides an explicit empty command.
Take both: an inactivity timeout bounds unbounded growth without a wall-clock ring, and retaining
after capture means a mis-aimed capture can be repeated rather than lost.

**DG-002 — no content threshold.** The spec already flags that its source's informative text cites a
`≥16`-note threshold that no acceptance criterion accepts. No manual surveyed states a minimum-content
rule. Capture whatever is in the buffer; an empty buffer produces no clip and says so.

**DG-005 — the selected eligible track.** Cubase inserts into the selected track; Live targets every
monitored MIDI track. Prefer Cubase's single explicit target — `trackStore.selectedTrackId` and
`Track.armed` both already exist, so this needs no new state.

## Consequences

The event bound must be published in the UI in the units the user can reason about, which means
showing both the event ceiling and its current implied duration rather than one or the other.

Retaining the buffer after capture requires an explicit clear command, as Cubase has.

The only shipped ring in the app is `recordingSession.ts`'s `RING_FLOATS = 524_288` ("~= 10.9 s @
48 kHz"), which is mono audio with a bare 4-byte write head. It is not a model for this — a MIDI event
ring is a different shape, and that ring's own protocol is already slated for replacement.

## Sources

- Cubase Pro 15 — Retrospective Record: https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/recording/recording_inserting_retrospective_recording_from_all_midi_inputs_t.html and Record–MIDI preferences: https://www.steinberg.help/r/cubase-le/14.0/en/cubase_nuendo/topics/preferences/preferences_record_midi_r.html
- Logic Pro — Flashback Capture: https://support.apple.com/guide/logicpro/overview-of-flashback-capture-lgcp8f89929b/mac and https://support.apple.com/guide/logicpro/capture-your-most-recent-midi-performance-lgcpdc0bf889/mac
- Ableton Live 12 — Recording New Clips: https://www.ableton.com/en/manual/recording-new-clips/

**Unverified:** Live's exact buffer bound. Secondary sources report 16,384 events with the oldest
1,024 discarded and a ~30-second inactivity clear; the manual states neither, and Ableton's help-centre
article is not fetchable. Cubase's figures are quoted from Steinberg's own documentation and carry the
argument on their own.
