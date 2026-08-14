---
type: adr
id: 0019
title: 'Retrospective capture: events for MIDI, ~60 seconds for audio, one explicit target'
status: accepted
date: 2026-08-12
owner: The Sourdaw team
sources:
  - .agents/artifacts/sourdaw/SPEC-retrospective-capture.md
---

# 0019 — Retrospective capture: events for MIDI, ~60 seconds for audio, one explicit target

**Accepted 2026-08-12.** Resolved from primary sources under the owner's standing direction that decision gates are research tasks. Resolves the open questions in
[`.agents/specs/retrospective-capture/spec.md`](../specs/retrospective-capture/spec.md), which numbers
them `Q-001`–`Q-006`. The `DG-` labels in the sections below are this record's own working ids and do
not appear in that spec.

These gates block 68 acceptance criteria. Nothing retrospective exists in the tree:
`startBackgroundCapture.ts` guards on `!state.enabled` and pushes a bookkeeping record into a store,
no ring is allocated, and MIDI retains nothing either.

## What the industry does

Seven DAWs surveyed from vendor documentation. The feature is near-universal for MIDI, rare for
audio, and the conventions are sharp where they exist.

### MIDI buffers are sized in events, not seconds

- **Cubase** — the preference is literally named *Retrospective Record Buffer Size **in Events***.
  "The buffer captures up to 10000 MIDI events." "This can amount to a MIDI recording of around 2
  minutes and 30 seconds." And then the sentence that settles the units question: for a controller
  like the ROLI Seaboard "this only corresponds to a recording of around 20 seconds." Overflow drops
  oldest: "the MIDI events that were captured first are replaced by the new events."
- **Ableton Live** — "Whenever 16384 events are reached, the oldest 1024 events are discarded."
  Block eviction, not per-event.

A factor of seven between the same buffer's best and worst case is why a duration bound is a promise
the implementation cannot keep.

### Audio retrospective is rare, opt-in, and always bounded near a minute

Three of seven have it, and all three land in the same place:

- **Logic Pro 11.2+** (renamed *Flashback Capture*, which also added audio) — "Flashback Capture can
  save up to one minute of audio." Playback only: "You can capture audio only while the project is
  playing… While a project is stopped, no audio is captured." Floor: "The project must play for a
  minimum of four seconds." Silence-gated: it saves "when there is an incoming audio signal… but not
  when there is silence."
- **Cubase / Nuendo** — *Audio Pre-Record*, opt-in and per-track: "You can capture up to 1 minute of
  any incoming audio", set via "Audio Pre-Record Seconds" (max 60), and "the audio track [must be]
  record-enabled".
- **MOTU Digital Performer 11+** — *Retrospective Audio Record*, gated on arming: "DP starts
  capturing audio as soon as you record-enable an audio track", with user-set "Time to capture per
  track" and "Maximum total memory" caps, oldest-dropped when full.

Pro Tools, Studio One and REAPER document retrospective **MIDI only**. Bitwig and Cakewalk document
no retrospective capture at all.

Note the asymmetry every one of the three enforces: MIDI is captured passively, audio is gated on
arming or an explicit opt-in. Nobody buffers audio for free.

### Targeting is the real fork

This is where the industry genuinely splits, and it is worth choosing deliberately:

| DAW | Target |
| --- | --- |
| Ableton Live | **fans out** — "created on every monitored MIDI track" |
| Logic Pro | last-focused track; audio inherits "the settings of the last focused audio track" |
| Cubase, Studio One | the **selected** track |
| REAPER | the caller chooses — separate actions for "armed" vs "armed and selected" |
| MOTU DP | record-armed, with a documented location precedence: time-range selection, then insertion point, then playback wiper |

## Decisions

**DG-006 — MIDI passive, audio gated.** Capture MIDI always on armed or monitored tracks; capture
audio only when the track is armed, matching Cubase and DP. Two of three audio implementations
require arming and the third is playback-only; none buffers audio unconditionally.

**DG-001 — MIDI bounded in events; audio bounded at 60 seconds.** State the MIDI ceiling in events
and publish the implied duration range rather than promising a duration. Sixty seconds is the audio
figure all three implementations independently landed on.

**DG-003 — flush on inactivity, retain across a successful capture.** Logic discards after a
20-second gap between events; Cubase expires stop-mode material after 30 seconds of not playing and
ships explicit "Empty All Buffers" / "Empty Retrospective Record Buffer" commands. Retaining after
capture means a mis-aimed capture can be repeated; Cubase's explicit clear is the escape hatch.

**DG-002 — no content threshold.** The spec already flags that its source cites a `≥16`-note
threshold no acceptance criterion accepts. No manual surveyed states a minimum-content rule for MIDI.
What they do instead is **make the affordance the indicator**: Live greys the button out "when
there's no MIDI data to capture"; Logic dims it until material exists. Do that.

**DG-005 — the selected eligible track, single target.** Follow Cubase and Studio One.
`trackStore.selectedTrackId` and `Track.armed` already exist, so this needs no new state. Live's
fan-out is coherent inside Live's session model and would surprise here.

## Consequences

Show the event ceiling and its current implied duration together — one without the other is the
misleading half.

An explicit clear command is required, as Cubase has.

Tempo inference is conditional in every implementation that has it (Live only in an empty Set with
transport stopped, clamped 80–160 BPM; Logic only under Smart Tempo Adapt; DP only when the sequence
is empty). Do not infer tempo unconditionally.

**On the shortcut:** the spec proposes `Shift+C`. Pro Tools moved Retrospective Record *off*
`Shift+C` to `Alt+Shift+Z` in 2018.12 "to avoid a conflict", Logic uses `Shift-R`, and in our own
registry `shift+c` is already bound to a Loop Station record pad while `mod+shift+c` is Chrome's
Inspect Element on our primary web target. Pick something else.

## Sources

- Logic Pro: https://support.apple.com/guide/logicpro/capture-your-most-recent-midi-performance-lgcpdc0bf889/mac · https://support.apple.com/guide/logicpro/capture-a-recent-audio-performance-lgcpa5d2f9b8/mac · release notes https://support.apple.com/en-us/126835
- Ableton Live: https://www.ableton.com/en/manual/recording-new-clips/ · https://help.ableton.com/hc/en-us/articles/360000776450-Capture-MIDI
- Cubase: https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/recording/recording_recovering_midi_recordings_c.html · https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/recording/recording_audio_specifying_an_audio_prerecord_time_t.html
- Studio One: https://fenderstudiopromanual.fender.com/en/Content/Fundamentals_Topics/Retrospective_Record.htm
- REAPER user guide v7.78 §13.52 · MOTU DP11 new-features PDF and User Guide ch. 29 · Pro Tools shortcuts PDF and 2018.12 read-me

**Unverified:** Logic's MIDI buffer size (only the 20-second and 1.5-bar rules are stated), Cubase's
default buffer-size value, and buffer sizes for Studio One, REAPER and DP — all named as preferences
without printed defaults.

**Superseded draft:** an earlier revision of this ADR stated that only Logic captures audio. Cubase
and MOTU DP do as well; the corrected survey is above.
