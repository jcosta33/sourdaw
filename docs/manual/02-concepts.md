# Concepts

Sourdaw arranges a handful of ideas differently from most audio software, and every other chapter
assumes them. Read this once and the rest of the manual will make sense in the order you need it.

## One window, several views

Sourdaw does not have pages you navigate between. There is a single workspace, and everything else
is a panel you show or hide inside it. Nothing is ever "somewhere else" — it is either visible or
toggled off, and the same project is underneath all of it.

The centre of the workspace shows one of three views at a time:

- **Arrange** — the timeline. Tracks run down the left, time runs left to right, and clips sit on
  the grid. This is where a song is assembled.
- **Clip** — the inside of one clip. Notes, audio waveform, pitch, and that clip's own automation.
- **Automation** — parameter movements across the whole arrangement, given the full window instead
  of a lane.

Switching views never changes what is playing or what is recorded. They are three ways of looking at
one project.

The **Session** surface is different: it is a panel rather than a view, and it holds clips that
launch on demand rather than at a fixed time. Use it to try arrangements before committing them to
the timeline.

## Tracks

A track is a lane that carries one kind of material and one signal path. Five kinds exist:

| Kind | Carries | Use it for |
|---|---|---|
| **Audio** | Recorded or imported sound | Vocals, guitars, samples, stems |
| **MIDI** | Notes and controller data | Anything played by an instrument device |
| **Bus** | No material of its own | Grouping several tracks under one fader and one device chain |
| **Folder** | No material of its own | Tidying the track list without changing the signal path |
| **Master** | The final mix | The last stage before export |

The distinction that matters: a **bus** changes the audio path — everything fed into it is summed
and processed together. A **folder** changes only the view. Collapsing a folder hides tracks; it does
not combine them.

## Clips

A clip is a container for material, positioned in time. Audio clips hold sound; MIDI clips hold
notes. Clips can be trimmed, faded, looped, split, and moved without altering the material they
point at — trimming a clip does not shorten the underlying recording, and you can always drag the
edge back out.

Because clips reference material rather than own it, duplicating a clip is cheap and reversible.

## Time and the grid

Position is expressed in bars and beats, driven by the project tempo and time signature. The **grid**
is the set of divisions that edits snap to. A coarse grid keeps a part locked to the bar; a fine
grid or no grid lets you place material freely.

Two ideas ride on top of it. **Markers** name a position. **Sections** name a span — a verse, a
chorus — and give you something to jump between and reorder.

## Devices and the device chain

A device processes sound or notes. Every track has a **device chain**: an ordered list, running top
to bottom, where each device receives what the one above it produced. Order is not cosmetic — a
compressor before a reverb behaves very differently from the same compressor after it.

Three kinds:

- **Instruments** turn notes into sound. A MIDI track needs one to be audible.
- **Audio effects** change sound that already exists.
- **MIDI effects** change notes before they reach the instrument.

Devices come from three places: the built-in devices documented in this manual, and — where your
system supports them — plugins you already own.

## Parameters and automation

Every knob, slider, and switch on a device is a **parameter** with a range, a unit, and a default.
Any parameter can be **automated** — given a value that changes over time, drawn as a line in an
automation lane.

Automation belongs to the track, not the device, so it survives while you audition alternatives. A
parameter under automation follows the line rather than the knob; the knob shows you where the line
currently is.

## Nothing happens twice

Every change you make — a note moved, a fader nudged, a device added, a preset loaded — is recorded
as a single step. That is what undo walks back through, and it is why undo behaves predictably even
when one action changed forty parameters at once: loading a preset is one step, not forty.

The same record makes **versions** possible. A version is a named point you can return to. A
**branch** lets you take a project in two directions and compare them, rather than choosing blindly
and hoping undo is deep enough.

## Three ways to drive it

The same operations are available three ways, and none of them is a lesser path:

1. **Direct manipulation** — dragging, clicking, and typing in the interface.
2. **Commands** — a searchable list of every action, reachable from the keyboard, plus shortcuts you
   can remap.
3. **Natural language** — describing what you want to the assistant, which carries out the same
   actions the other two paths use.

Because all three route through the same actions, anything the assistant does is a normal step in
the history and can be undone like anything else.

## Where sound actually comes out

Audio reaches your ears through an output device you choose. Recording needs an input, an armed
track, and a monitoring decision. Some processing introduces **latency** — a small, reported delay —
and playback compensates for it so tracks stay aligned.

## See also

- [Gluten](./devices/07-gluten.md) — a worked example of a device page
- [Manual index](./README.md) — every chapter and device page
