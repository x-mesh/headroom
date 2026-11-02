---
name: Rack Mesh
description: A daylight telemetry console for topology constraints and failure effects.
colors:
  ground: "#e9edec"
  surface: "#f5f7f6"
  surface-raised: "#ffffff"
  surface-tint: "#edf1ef"
  panel-deep: "#20323a"
  panel-mid: "#31535a"
  panel-line: "#526b70"
  on-deep: "#f4fbf7"
  on-deep-muted: "#dceae2"
  on-deep-line: "#628279"
  danger-soft: "#ff9c94"
  canvas: "#f0f3f1"
  line: "#a8bab5"
  line-soft: "#d8e1dd"
  text: "#1b3033"
  muted: "#4d6360"
  signal: "#d3ec87"
  signal-deep: "#4f7100"
  amber: "#8b5100"
  danger: "#b83c34"
  unknown: "#5b6478"
  cyan: "#077165"
  action-ink: "#1b3033"
typography:
  display:
    fontFamily: "Avenir Next, Avenir, Pretendard, Segoe UI, sans-serif"
    fontSize: "clamp(18px, 1.45vw, 22px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Avenir Next, Avenir, Pretendard, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Avenir Next, Avenir, Pretendard, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
  answer:
    fontFamily: "SFMono-Regular, Menlo, Consolas, Pretendard, monospace"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  metric:
    fontFamily: "SFMono-Regular, Menlo, Consolas, Pretendard, monospace"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.1
  data:
    fontFamily: "SFMono-Regular, Menlo, Consolas, Pretendard, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
  micro:
    fontFamily: "SFMono-Regular, Menlo, Consolas, Pretendard, monospace"
    fontSize: "8px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
  label:
    fontFamily: "SFMono-Regular, Menlo, Consolas, Pretendard, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.13em"
rounded:
  square: "0"
spacing:
  compact: "8px"
  control: "14px"
  panel: "18px"
  shell: "22px"
components:
  button-solid:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.action-ink}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "0 15px"
    height: "40px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.on-deep}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "0 15px"
    height: "40px"
  editor-tool-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "0 11px"
    height: "36px"
  editor-field:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0 10px"
    height: "40px"
  failure-switch:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "9px 18px"
    height: "52px"
  topology-node:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    width: "120px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "7px 8px"
  summary-metric:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "15px 22px"
    height: "106px"
  mobile-failure-tray:
    backgroundColor: "{colors.panel-deep}"
    textColor: "{colors.on-deep}"
    typography: "{typography.data}"
    rounded: "{rounded.square}"
    padding: "10px 14px"
---

# Design System: Rack Mesh

## Overview

**Creative North Star: "The Daylight Telemetry Console"**

Rack Mesh uses a pale sage work surface and a deep green control frame. Device symbols and their axis labels sit directly on the tinted canvas.

The interface treats telemetry motion as a presentation layer. Deterministic scenario results remain the source for state, comparison, and export.

A compact toolbar and inline task panel extend the console into a topology editor. Keep edits in the daylight workspace.

**Key Characteristics:**

- Light sage ground, quiet surfaces, and borderless device symbols on a tinted canvas.
- Three topology views: classic symbols, CSS 2.5D voxel chassis, and a spatial WebGL equipment scene.
- Deep green top and mobile control bars.
- Square controls, thin rules, and compact data typography.
- A scenario verdict and grouped capacity, delivery, and fault summaries.
- An editor toolbar, inline forms, and inspector-based resource edit forms.
- Text, shape, and line patterns that support each semantic color.

## Colors

The palette separates a calm daylight workspace from a deep operational frame. Semantic colors report capacity and fault states.

### Primary

- **Signal Lime** (#d3ec87): Use for primary actions, focus outlines, the stable run state, and the brand mark.
- **Deep Signal Green** (#4f7100): Use for decisive values, section codes, packet dots, and positive comparison values.

### Secondary

- **Capacity Cyan** (#077165): Use for healthy resources, active links, live telemetry, and the first sparkline.
- **Constraint Amber** (#8b5100): Use for caution states and the second sparkline.
- **Fault Red** (#b83c34): Use for overloads, failures, negative changes, and the third sparkline.
- **Unknown Slate** (#5b6478): Use when a capacity limit is not known.

### Neutral

- **Sage Ground** (#e9edec): Use for the page ground.
- **Quiet Surface** (#f5f7f6): Use for control panels, summary cells, and inspectors.
- **White Raised Surface** (#ffffff): Use for small markers and symbol highlights.
- **Sage Surface Tint** (#edf1ef): Use for topology and comparison regions.
- **Deep Forest Panel** (#20323a): Use for the top bar, toast, and mobile failure tray.
- **Canvas Sage** (#f0f3f1): Use for the fixed topology canvas and its label masks.
- **Forest Text** (#1b3033): Use for primary text on light surfaces.
- **Muted Sage Text** (#4d6360): Use for notes, labels, and metadata.

### Named Rules

**The Daylight Hierarchy Rule.** Keep work surfaces pale. Reserve deep forest for global control and compact mobile action.

**The Signal Economy Rule.** Reserve signal lime for action, focus, stable state, and selected key values.

**The Red Means Impact Rule.** Use fault red only for failures, overloads, and negative changes.

**The Tint Is The Floor Rule.** Every semantic text color must clear 4.5:1 on the sage surface tint,
not only on the pale surface. The tint is where the design board and the comparison panel put their
notes, so a color chosen against white lands there a step short. The semantic inks were darkened for
this reason, unknown slate last: at #697286 it read 3.89:1 on the tint. A new ink must be checked
against `#edf1ef` before it ships.

## Typography

**Display Font:** Avenir Next with Avenir and Segoe UI fallbacks.

**Body Font:** Avenir Next with Avenir and Segoe UI fallbacks.

**Label/Mono Font:** SFMono-Regular with Menlo and Consolas fallbacks.

**Hangul Font:** Pretendard, self-hosted from `public/fonts/`. Neither Avenir Next nor SFMono covers
Hangul, so before this the glyphs came from whatever the reader's OS supplied. Both stacks name
Pretendard after their Latin faces, and the `@font-face` declarations carry a `unicode-range` limited
to Hangul, so Latin text, digits, and the monospace data voice are untouched.

**Character:** The UI stack keeps Korean copy clear. The monospace stack gives metrics, states, resource names, and section codes an operational rhythm.

### Named Rules

**The Hangul Is Not A Fallback Rule.** A face pinned for Latin says nothing about Hangul. Name the
Hangul face, ship it, and bind it by `unicode-range`. Apple SD Gothic Neo, the macOS default, sets
narrower and taller syllable blocks than the Latin beside them, and the reader on another OS sees a
third thing. Fetch the files with `npm run fonts:vendor`; the notice lives in `vendor/pretendard/`.

### Hierarchy

- **Display** (600, fluid 18px to 22px, 1.15): Use for the canvas answer. It only has to outrank the
  answer tier below it; past that it eats canvas.
- **Title** (600, 17px, 1.2): Use for panels, the brand, and comparison titles.
- **Body** (400, 12px, 1.55, `--type-body`): Use for notes, source conditions, and scenario context.
- **Answer** (700, 13px, 1.25): Use for the binding resource named under the canvas heading.
- **Metric** (700, 15px, 1.1): Use for a utilisation a reader scans down a column, as in the worst-axis list.
- **Data** (600, 11px, 1, `--type-data`): Use for metrics, states, resource data, tabs, chips, and every
  control a reader presses.
- **Label** (600, 10px, 0.13em, `--type-label`): Use uppercase text for section codes and zone labels.
  Never for a control and never for a value.
- **Micro** (500, 7px to 10px): Use only inside drawings: topology device cards, link labels, rack
  elevations, and 3D labels. A drawing is read at its zoom level, so it keeps its own scale.

### Named Rules

**The Data Voice Rule.** Use monospace text for values, machine states, identifiers, and operational labels.

**The Floor Outside The Drawing Rule.** Outside a drawing, no text sits below the label size, and
nothing a reader presses or reads as a value sits below the data size. Sizes come from the three
`--type-*` tokens, not from a literal. Hangul carries more strokes per glyph than a Latin capital, so
the 8px and 9px that read as crisp uppercase codes turn to smudge in Korean.

**The Hangul Has No Capitals Rule.** The wide tracking on labels is built for uppercase Latin. Korean
and Japanese have no case, and tracking pulls their syllables apart, so labels drop it under
`html[lang="ko"]` and `html[lang="ja"]`. Korean text also breaks at word boundaries
(`word-break: keep-all`), never inside a word.

## Layout

The desktop shell places the scenario verdict and capacity, delivery, and resilience summaries together above the workspace. The topology occupies the wide left workspace; a switch chooses the inspector or design tools in the right column. Selecting a device opens the inspector, while opening failure analysis selects the tools panel. The whole panel can be collapsed.

Above 1180px the main workspace uses a flexible topology column and a 340px inspector and tools column.

At 1180px, use a 220px design-tools column and a flexible center. Limit the first workspace row to 720px and place the inspector below.

At 1180px, place editor forms in three columns. Keep demand rows in four columns with internal horizontal scroll.

At 760px, show the verdict and fault risk first, with the remaining summary behind an expandable control. Place topology before failures and open device and failure details in bottom panels.

When a fault is active, show baseline-to-current delivery changes near the verdict. Keep binding and unknown-limit changes available there, and withhold numerical comparison when the design differs from its baseline. Do not present headroom as an available margin when paths are severed.

At 760px, place editor forms and demand rows in two columns. Keep each form action row across the full width.

Keep the topology canvas at 940px by 580px. On mobile, cap its viewport at 500px and provide horizontal pan access.

Keep the DOM topology stage for classic and voxel views. Hide it while the spatial WebGL canvas is active.

Size the WebGL canvas to its host on desktop and mobile. Update the camera aspect ratio after each resize.

Orbit the spatial camera from a primary-button drag. Zoom it with the wheel or the shared zoom controls.

Give spatial controls reset actions for the camera orbit and distance.

Give each mobile spatial view button a 44px by 44px target. Provide a view reset action.

Give the mobile editor toolbar its own horizontal scroll. Preserve the separate pan region inside the topology viewport.

Keep the mobile failure tray sticky at the top. Keep its deep green surface above the light workspace.

Use the observed space rhythm: 8px for compact gaps, 14px for mobile controls, 18px for panels, and 22px for shell edges.

## Elevation & Depth

The system uses tonal layers, one-pixel borders, and limited shadows. Device labels sit directly on the sage canvas.

Voxel chassis use face contrast and a small floor shadow. Spatial devices use lit meshes with profile-specific materials.

The WebGL scene uses a hemisphere light and two directional lights. One directional light casts equipment shadows.

Use `THREE.PCFSoftShadowMap` for spatial depth. Keep the ground plane and `GridHelper` under the equipment.

### Shadow Vocabulary

- **Status Glow** (`0 2px 10px currentColor`): Mark the current scenario state in the top bar.
- **Live Glow** (`0 2px 9px color-mix(in srgb, var(--cyan) 65%, transparent)`): Mark the live telemetry indicator.
- **Node Rest** (`0 8px 22px color-mix(in srgb, var(--panel-deep) 15%, transparent)`): Separate white nodes from the canvas.
- **Node State Glow** (`0 8px 26px color-mix(in srgb, var(--node-color) 18%, transparent)`): Mark hover and selection.
- **Voxel Chassis** (`0 5px 9px color-mix(in srgb, var(--panel-deep) 24%, transparent)`): Separate the front face from the canvas.
- **WebGL Soft Shadow** (`THREE.PCFSoftShadowMap`): Separate spatial equipment from the ground plane.
- **Sticky Tray** (`0 8px 22px color-mix(in srgb, var(--panel-deep) 24%, transparent)`): Separate the mobile tray from content.
- **Toast Lift** (`0 10px 30px color-mix(in srgb, var(--panel-deep) 24%, transparent)`): Lift transient result feedback.

### Named Rules

**The Structural Depth Rule.** Use surface tone and borders before shadow.

## Shapes

The system uses square geometry. Buttons, badges, nodes, panels, meters, switches, and toast feedback have no corner radius.

Use one-pixel borders for structure. Use dashed borders for disabled nodes and a 7 7 dash pattern for disabled links.

Use three-pixel status rails under node symbols. Use seven-pixel axis meters for clear load comparison.

## Components

### First Visit

- Start a new visitor with a question about service resilience and a simplified, explicitly synthetic diagram of the demo's shared PDU and two spine devices.
- The primary action injects the actual shared-power fault and shows the calculated service impact, stopped resources, and unknown limits before offering analysis or restoration. Provide separate paths to start a design, explore the example, and open the guided demonstration.
- On entering the analysis, center the affected devices, name the active fault, and offer a direct path to its failure-list entry. Remove this context when the fault is cleared. If automatic framing changed the zoom, restore it on recovery only when the user has not adjusted it.
- Restore an existing working copy directly. The introduction must not obscure saved work or simulate packet behavior or recovery time.

### Buttons

- **Shape:** Use square corners and a minimum height of 40px.
- **Primary:** Use signal lime, dark action text, and 15px horizontal padding.
- **Text:** Use a transparent surface and a visible border on the deep top bar.
- **Hover / Focus:** Shift the border or surface. Use a 2px signal focus outline with a 3px offset.

### Topology View Switch

- **Modes:** Offer classic, voxel, and spatial views in one square segmented control.
- **State:** Mark the active view with `aria-pressed`.
- **Persistence:** Store the mode, spatial pitch, and spatial yaw in `localStorage`.
- **Transition:** Reveal each view with one authored blur and clip transition.
- **Continuity:** Keep the topology data and selection unchanged across view changes.

### Editor Toolbar and Overlay Panel

- **Toolbar:** Use a 54px white deck with compact square buttons, six-pixel gaps, and a visible tool separator.
- **Actions:** Expose new, add device, connect, manage demand, save, open, and import actions.
- **Mode:** Show select or connect state with text and a seven-pixel indicator. Update `aria-pressed` for connect mode.
- **Panel:** Open the task panel directly below the toolbar. Do not use an HTML modal or overlay.
- **Fields:** Use 40px white fields with one-pixel borders. Use 36px fields inside dense demand and inspector rows.
- **Primary Action:** Use signal lime for create, update, and add demand actions.

### Traffic Demand Manager

- **List:** Show one bordered row for each demand. Keep endpoints, bps, pps, CPS, and sessions editable.
- **State:** Replace explicit paths with calculated shortest ECMP paths after endpoint or load changes.
- **Empty:** Show an inline empty state and a clear action to create the first demand.
- **Errors:** Keep validation errors inside the related row. Do not clear valid field values.

### Datasheet Profile

- **Placement:** Put the profile block between the mode block and the edit form, only for classes that have a catalog.
- **Two Choices:** Pick the device first, then the measurement condition. A device with no catalog entry keeps plain manual entry.
- **Condition Is Not a Detail:** Name the condition in the option itself. The same firewall reads 20 Gbps with inspection off and 1 Gbps with threat protection on; a profile list that hides that teaches the wrong thing.
- **Silent Axes:** When a profile's datasheet does not state an axis, leave it unknown. Never carry a value over from another condition.
- **Correction:** Let the reader enter a measured value over the datasheet one. Mark the corrected field, keep the datasheet number beside it, and offer a reset. Both values ship in the project file.
- **Source Block:** State the source type, the document, the section it came from, the retrieval date, and the datasheet's own caveat. Link the original. Say how many axes carry a correction.

### Resource Inspector Editor

- **Result Stays Put:** Pin the identity block and the binding callout to the top of the column.
  The limit fields sit below the axis meters, so editing a limit and reading its consequence used to
  be a scroll shuttle in a 300px column.

- **Read Before Editing:** Show the axis results and source first. Keep behavior, profile, and limit fields under an edit disclosure. Preserve the disclosure state through recalculation for the same resource, and close it when a different resource is selected.

- **Device:** Edit the name, zone, and independent capacity limits below the device telemetry.
- **Link:** Edit directional capacity below the link telemetry.
- **Empty:** If the topology has no devices, explain how to add or import the first device.
- **Delete:** Keep resource deletion beside the apply action. Use fault red for the delete label.

### Top Bar and Live State

- **Frame:** Use the deep panel surface and light text; the desktop bar has a 58px minimum height.
- **Run State:** Pair an 8px lamp with visible state text. Use lime, amber, or red for state.
- **Warning Tier:** Name the warning tier the engine already computes. A design holding resources above the warning threshold must never read as stable, and the count belongs in the text.
- **Live State:** State and evidence chips name their conditions in the verdict area. The presentation does not claim that modeled results are live measurements.
- **Motion:** Keep synthetic number variation off by default; the view settings can enable it.

### Summary Metrics

- **Structure:** Present the verdict alongside known capacity, current delivery, and failure analysis. Do not show sparklines in the summary.
- **State Names:** Use the same terms for equivalent states in the summary, topology, and inspector.
- **Color:** Use semantic state colors consistently and pair them with text.
- **Headline Number:** Do not animate the largest number on the page. A headline that drifts between two values contradicts the fixed comparison panel and the reader cannot tell which to trust.
- **Metric Color:** Color the headroom figure by the same threshold the engine judges with. A figure the engine calls warning must not be painted the healthy color.
- **Telemetry:** Add about ±1.5 points of synthetic variation to a utilization the presentation layer shows, and about ±1.5% to a load figure. Keep scenario values unchanged. Add the variation, do not multiply it: a multiplied variation leaves a small percentage frozen at its rounded value while a large one moves.
- **Cadence:** Advance the variation one step every 300ms, and draw every frame between steps. The 300ms is the speed, not the redraw interval. A stepped redraw shows one-point jumps, which the eye reads as a glitch and not as motion.
- **Meter Follows:** Move the axis meter with the varied value on the canvas node. A percentage changes only in whole points, so the bar carries the motion between them; the eye catches length before it catches digits. Leave the inspector meter alone, because a reader drags it to set a limit.
- **Opt In:** Keep synthetic variation off by default and provide a view setting that enables it. Name the control after the effect, not after the data; display motion must be distinguishable from a new result.
- **Change Motion:** When a recalculation changes a value, ease the number from the previous value to the new one over 260ms. This motion has a cause, so it does not compete with the figure it shows. Run it whether or not synthetic variation is on, and skip it when reduced motion is active.

### Design Board Tabs

- **Tabs:** Split the design board into component and failure tabs. Open the failure tab for a populated design and the component tab for an empty design.
- **Shape:** Use a two-pixel underline on the open tab. Use no corner radius and no filled tab body.
- **Badge:** Show the active-fault count only on the failure tab. Hide it on the component tab.
- **Keyboard:** Move between tabs with the arrow keys, Home, and End. Keep only the open tab in the tab order.

### Editor Panel Placement

- **Overlay:** Float the panel under the toolbar. Opening it must not move the summary strip or the workspace.
- **Cover:** Let it cover what sits below and cast a shadow, so the panel reads as temporary.
- **Dismiss:** Close on Escape, on the close button, and on a press outside the panel.
- **Height:** Cap it to the viewport and scroll inside. Never let it push the page taller.

### Verdict Headline

- **Answer:** State the current verdict above the canvas, followed by the binding resource and its measurement when meaningful.
- **Path Loss:** Put disconnected demand ahead of a capacity-growth message; do not present an idle, disconnected design's headroom as available capacity.
- **Tone:** Pair state color with the verdict text.
- **Growth Limit:** Read the first threshold from the engine's growth ladder; expose unknown limits separately.

### Bottleneck Note

- **Placement:** Keep the detailed explanation under the canvas in the verdict-details disclosure, alongside the next experiment.
- **Content:** Name the resource, the axis, the direction when a link has one, and the load against the limit.
- **Consequence:** Add what the overload costs — bytes dropped, sessions refused — as separate facts. Refused sessions do not throttle bytes.
- **Unknown:** Say when a delivery ratio is an upper bound because a limit is missing.
- **Empty:** With no known limit, say so and point at where to enter one. Never leave the line blank.
- **Naming:** Read a link by its endpoints, never by its id.
- **Redundancy:** Close with what the design is, not with what the current scenario is. State how many single points it has and name one, or state that nothing severs it and what the worst loss costs.

### Design Template Picker

- **Entry:** Make the new-design action open a template list, not a blank canvas.
- **Card:** Stack the name, one line on what the architecture is, and one line on which axis it teaches.
- **Coverage:** Keep templates that fill different axes first. A set that all bottleneck on bandwidth teaches nothing.
- **Pairs:** When two templates differ only by a mode, say so in both cards so the reader opens them together.
- **Blank:** Keep an empty design in the same list. It is a choice, not a fallback.
- **Search:** Once the list passes a screen, put a search field above it and focus it on open. Match the name, both description lines, and the tags.
- **Tags:** Show the tags on the card. They teach the reader what the search accepts.
- **Count:** State how many match, so an empty result reads as a result and not a broken list.
- **Apply:** Load the template on click. Offer undo in the toast instead of asking for confirmation first.
- **Grade:** Compute the redundancy grade from the fault sweep. Never write it by hand. A card must not claim redundancy the design does not have.
- **Grade Search:** Put the grade text in the search haystack, so a reader can find every single-point design at once.

### Device Behavior Mode

- **Placement:** Put the mode block between the axis list and the edit form, only for classes that have modes.
- **Control:** Use a segmented radio group, never a select. Both choices must read without opening anything.
- **Preview:** Show what the other mode would do before the user commits: each axis from and to, and whether the binding axis moves.
- **No Change:** When a mode does not alter byte load, say that in words instead of showing an empty preview.
- **Scope:** State that a device mode does not change link load, so a DSR balancer is not read as relieving the wire.

### Component Palette

- **Grid:** Show one cell for each device class in a two-column grid. Separate cells with one-pixel lines, not gaps.
- **Groups:** Sort the classes into named groups: network, security and traffic, servers and storage, external and endpoints. Put the group name on its own full-width row above its cells.
- **Odd Group:** If a group holds an odd number of classes, make its last cell span both columns. An empty half cell must not show.
- **Cell:** Stack the class symbol, a Korean name, and the class code. Use the grab cursor.
- **Drag:** Drag a cell into the topology area to place a device. Show a ghost symbol under the pointer and outline that area as the drop target.
- **Drop Past the Edge:** Accept a drop anywhere in the topology area, including beside or below the canvas. Keep the dropped coordinate and let the canvas grow to it.
- **Click:** A click places the device in the first free grid slot. Keep this path working on touch.
- **New Device:** Give the device the axes its class uses and leave every limit unknown. Select it so the inspector opens for the limits.

### Failure Switch

- **Shape:** Use a 52px minimum height and 9px by 18px padding.
- **State:** Show UP or DOWN text and update `aria-pressed`.
- **Active:** Use a red inner square, red border, and red DOWN text.
- **Coverage:** List every device and every link. Never filter by device class or by an id pattern.
- **Forecast:** Put the sweep verdict on each row as a third line: the service severs, only a percentage gets delivered, or the survivors absorb the loss. The reader must know the result before the click.
- **Bounded Forecast:** When an unknown limit makes "absorbs" an upper bound, say so on the row. Never let an unknown design read as spare capacity.
- **Order:** Sort rows by how bad the loss is. Put a demand endpoint that severs its own traffic last, because that is not a redundancy problem.
- **Tier Heading:** Break the sorted rows where the verdict changes and head each run with what that verdict means, plus its count. Sort order alone hides the boundary: a reader cannot see where severed ends and short begins without reading every row. Tint the row background by verdict as a second, quieter cue.
- **Grade Line:** Head the panel with the counts for severed, short, and spare resources.
- **Color:** Let the words carry the verdict. Color is secondary.

### Connection Handles

- **Reveal:** Show four handles on the symbol edges when the node is hovered, selected, or focused. Keep them hidden otherwise so a resting canvas stays quiet.
- **Drag:** A drag from a handle draws a link; a drag from the node body moves it. The same press must never mean both.
- **Rubber Band:** Draw a dashed line from the source to the pointer while dragging, and mark the node under the pointer as the target.
- **Drop:** Release on a node to connect. Release anywhere else and nothing happens — no dialog, no orphan link.
- **Undo:** Offer undo in the toast. A link made by accident must cost one click to remove.

### Context Menu

- **Trigger:** Open on right-click over a node or a link, and on the keyboard menu key. Select the resource as it opens, so the inspector agrees with the menu.
- **Items:** Carry only what this tool does to that resource: delete, duplicate, start a link, inject or clear a fault. Do not mirror a drawing app's clipboard and z-order commands.
- **Delete First:** Put delete at the top in fault red. It is the reason the menu gets opened.
- **Fault Label:** Name the action, not the state: inject a fault on a live resource, clear it on a failed one.
- **Dismiss:** Close on Escape, on a press outside, and on canvas scroll. Return focus to the resource.
- **Keyboard:** Move through items with the arrow keys. Keep every action reachable without a pointer.
- **Bounds:** Fold the menu back inside the viewport at the right and bottom edges.

### Canvas Zoom

- **Control:** Put minus, the current percentage, plus, and fit in one bordered group in the topology header.
- **Steps:** Move through close fixed steps from 40% to 200%. Keep each button press a small change.
- **Reset:** Make the percentage button return the canvas to 100%.
- **Fit:** Scale down to show the whole canvas. Never magnify past 100%.
- **Anchor:** Keep the point under the pointer, or the center of the view, in place while the scale changes.
- **Pointer Math:** Divide every screen distance by the zoom before it becomes a canvas coordinate. A drag and a drop must land where the pointer is.
- **Wheel:** Zoom on Ctrl or Command with the wheel, which is also how a trackpad pinch arrives. Keep one wheel notch under a ten percent change, because a trackpad sends many events per gesture.
- **Wheel Units:** Normalize a line-mode wheel to pixels before it reaches the scale. Devices report different units for the same gesture.

### Canvas

- **Minimum:** Start at 940 by 580. A layout that fits keeps that size.
- **Growth:** Grow the canvas toward any device placed outside it. Add 40px of slack in the direction that grows.
- **Origin:** Let device coordinates go negative. Move the canvas origin instead of clamping the device.
- **World Position:** Keep the grid and the zone labels fixed to world coordinates, not to the canvas edge.
- **Pan:** Drag empty space, or use the middle button, to move the view. Show the grab cursor at rest and the grabbing cursor while the view moves.
- **Stage Padding:** Pad the canvas inside the topology area so empty space to grab always exists. Without it a canvas smaller than the area has nowhere to pan to.
- **Area Height:** Cap the topology area to the viewport. The padded stage must scroll inside it, never stretch the page.
- **Pan Exceptions:** Start no pan on a node, on a link, in connect mode, or from touch. Touch keeps the native scroll.
- **Cap:** Stop growing at 12000px so an imported file cannot ask for a canvas the browser cannot paint.
- **DOM Zoom:** Apply the same zoom state to classic and voxel views.
- **Spatial Zoom:** Change the `PerspectiveCamera` distance with the wheel, zoom controls, and reset control.

### Spatial Canvas

- **Runtime:** Use `three@0.186.0` and `THREE.WebGLRenderer`.
- **Camera:** Use `PerspectiveCamera` with a 44-degree field of view.
- **Equipment:** Build each chassis with `BoxGeometry` and `MeshStandardMaterial`.
- **Lighting:** Add `HemisphereLight` and `DirectionalLight`. Enable `PCFSoftShadowMap`.
- **Ground:** Put a receiving plane and `GridHelper` under the equipment.
- **Profiles:** Set width, height, depth, and color from the equipment profile.
- **Details:** Add ports, server bays, and wireless antennas as separate geometry.
- **Links:** Draw each link with `TubeGeometry` on a curve at world height `0.32`.
- **Traffic:** Move a `SphereGeometry` mesh along each active link curve.
- **Labels:** Render text to `CanvasTexture`. Display each texture with a camera-facing `Sprite`.
- **Selection:** Use `Raycaster` against equipment meshes and label sprites.
- **Orbit:** Orbit the camera from primary-button drags on the WebGL canvas.
- **Zoom:** Change camera distance with the wheel and shared zoom controls.
- **Reset:** Restore the camera yaw, pitch, and distance from either reset control.
- **Persistence:** Store the selected view, pitch, and yaw in `localStorage`.
- **Reduced Motion:** Stop traffic progress. Keep manual orbit and zoom available.
- **DOM Stage:** Hide `topology-stage` in spatial view. Keep it for classic and voxel views.
- **Responsive Canvas:** Fit the renderer to its host. Limit the pixel ratio to two.
- **Mobile Targets:** Give every spatial view button a 44px by 44px target.
- **Edit Chrome:** Hide DOM port, link, resize, and selection handles in spatial view.

### Topology Node and Link

- **Pointer Layers:** The node layer covers the whole canvas, so it must pass pointer events through and let only the nodes take them. Otherwise the links underneath cannot be clicked at all.
- **Node:** Stack a 92 by 42 device symbol over a label block in a 120px column. Use no card border or card surface. Keep the node small. A topology holds dozens of nodes, and the axis rows carry the reading.
- **Anchor:** Keep the device position at the center of the symbol box. Offset the node by half the symbol height, never by half the node height.
- **Classic Symbol:** Use the existing inline SVG symbol for every device. Keep links flat on the canvas.
- **Voxel Chassis:** Use a CSS 2.5D chassis for all 22 palette device types. Build front, top, and side faces.
- **Voxel Faces:** Use a 68px front face, an 8px top face, and an 8px side face. Use fixed deep-green tones for chassis material. Use a darker olive material for firewalls.
- **Network Profiles:** Map switch and hub to ports. Map router and modem to ports plus a route mark.
- **Wireless Profile:** Map wireless to ports plus antennas.
- **Security Profiles:** Map firewall, IPS, WAF, VPN, and SSL VPN to ports plus a shield.
- **Balancer Profile:** Map the load balancer to ports plus a balance mark.
- **Server Profiles:** Map server, web, VM, and mail to bays plus fans.
- **Mainframe Profile:** Map mainframe to wide storage bays.
- **Storage Profiles:** Map database, storage, NAS, and backup to storage bays.
- **Cloud Profile:** Map cloud to a cloud mark.
- **Client Profile:** Map client to a screen plus ports.
- **Generic Profile:** Map an unrecognized type to a generic port chassis.
- **Voxel State:** Use three LEDs with the semantic node color. Use a 2.4s stepped cycle at rest, 1.1s for warning, and 0.46s for overload.
- **Voxel Interaction:** Lift the chassis by 4px on hover, keyboard focus, or selection. Increase saturation and brightness without changing the node layout.
- **Voxel Disabled:** Keep the chassis at rest. Remove lift and transitions. Apply grayscale and 48% opacity. Stop LED and fan motion.
- **Spatial Switch:** Use `3.6 × 0.72 × 2.1` and color `0x2f675c`.
- **Spatial Hub:** Use `3.2 × 0.78 × 2.0` and color `0x386b61`.
- **Spatial Router:** Use `3.2 × 1.0 × 2.25` and color `0x315e56`.
- **Spatial Modem:** Use `2.7 × 0.9 × 1.9` and color `0x41675f`.
- **Spatial Wireless:** Use `2.8 × 0.45 × 2.5` and color `0x477b70`.
- **Spatial Firewall:** Use `3.1 × 1.25 × 2.0` and color `0x626b55`.
- **Spatial IPS:** Use `3.1 × 1.15 × 2.0` and color `0x526654`.
- **Spatial WAF:** Use `3.1 × 1.15 × 2.0` and color `0x536a5b`.
- **Spatial VPN:** Use `3.0 × 1.0 × 2.0` and color `0x4c6258`.
- **Spatial SSL VPN:** Use `3.0 × 1.0 × 2.0` and color `0x4c6258`.
- **Spatial Balancer:** Use `3.2 × 0.9 × 2.1` and color `0x2d6459`.
- **Spatial Server:** Use `2.65 × 2.1 × 2.35` and color `0x435f59`.
- **Spatial Web Server:** Use `2.65 × 1.8 × 2.2` and color `0x42645d`.
- **Spatial VM:** Use `2.45 × 1.45 × 2.0` and color `0x496961`.
- **Spatial Database:** Use `2.9 × 2.45 × 2.3` and color `0x455e5d`.
- **Spatial Mail:** Use `2.65 × 1.8 × 2.2` and color `0x4c645e`.
- **Spatial Mainframe:** Use `3.25 × 3.3 × 2.6` and color `0x394f50`.
- **Spatial Storage:** Use `3.2 × 2.8 × 2.45` and color `0x436360`.
- **Spatial NAS:** Use `3.0 × 2.5 × 2.25` and color `0x4b6965`.
- **Spatial Backup:** Use `3.0 × 2.55 × 2.3` and color `0x526a64`.
- **Spatial Cloud:** Use `3.35 × 1.0 × 3.0` and color `0x3e7771`.
- **Spatial Client:** Use `2.5 × 0.65 × 1.75` and color `0x4c625b`.
- **Spatial Generic:** Use `2.8 × 1.1 × 2.0` and color `0x47645d`.
- **Spatial Ports:** Add 12 ports to switches, six to routers, and four to other equipment.
- **Spatial Bays:** Add four bay meshes to server, storage, database, mail, backup, and mainframe profiles.
- **Spatial Antennas:** Add two cylinder meshes to the wireless profile.
- **Spatial Disabled:** Use material color `0x59635f`. Disable the status rail emissive light.
- **Symbol Fill:** Fill the symbol with the canvas color. Links stop at the shape edge.
- **State Rail:** Put a three-pixel state rail under the symbol. Hatch it for overload. Dash it for unknown and offline.
- **Axis Rows:** Show one monospace row for each configured axis: state token, four-character axis name, compact load, and utilization. Show at most four rows and count the rest in the meta line.
- **Axis Meter Bar:** Draw a two-pixel bar under each axis row, filled to its utilization in the axis color. The bar answers "how close" before the number is read. An axis with no known limit gets a track and no fill, so an unknown limit never reads as spare capacity.
- **State Token:** Pair each state color with its token. Use a period for healthy, an exclamation mark for warning, a greater-than sign for overload, a question mark for unknown, and the letter x for invalid and for disabled. The axis name and value separate those two: an invalid axis keeps its own name and reads ERR, a disabled node reads OFFLINE and DOWN.
- **Compact Load:** Drop the unit from the node value. The axis name carries the unit. Keep the unit in the inspector.
- **Unknown Axis:** Print the measured load and an em dash. Never print zero percent for an unknown limit.
- **Single Point:** Add a SPOF token to the meta line of a device whose loss severs the service. Do not add an axis row for it.
- **Manufacturer Badge:** Put the manufacturer at the top-left of the symbol box. Use the project's own logo first, then the catalog mark in its brand color, then a short uppercase text badge. Keep the badge on a raised surface with a one-pixel border so it reads over the symbol.
- **Model Line:** Put the model under the device name in muted micro type. The name says which box this is; the model says what it is.
- **No Endorsement:** A mark identifies a device. Never place it where it reads as a partnership, certification, or approval, and never rank manufacturers against each other.
- **Binding Axis:** Give the binding axis row full-strength label text. Keep the other axis labels muted.
- **Name and Meta:** Show the device name in 11px data type. Show the class and the zone in 8px label type. Clip overflow.
- **Selected:** Use a two-pixel state-color outline. Do not change the layout.
- **Drag:** Use the grab cursor and stronger saturation while a node moves.
- **Connect:** Enter a two-node mode. Outline the source and prompt for the target before link creation.
- **Disabled Node:** Dash the rail and show OFFLINE and DOWN. Draw a cross over the symbol and fade the symbol behind it. Keep the label block readable — on a dead device the state text must read, not the icon.
- **Disabled Meta:** Drop the SPOF token and the hidden-axis count from a dead device. Neither says anything once the device is off.
- **Accessible Name:** Give the node one label that starts with the device name and states class, zone, state, and binding axis. Keep synthetic telemetry out of that label.
- **Active Link:** Use a solid semantic stroke and one to three SVG packet dots.
- **Packet Speed:** Reduce duration as utilization rises. Use 3.4s as the base and 1.25s as the minimum.
- **Unknown Link:** Use a slate stroke with a 5 4 dash pattern. A link with no known capacity must never read as healthy.
- **Invalid Link:** Use a red stroke with a tight 2 3 dash pattern. Keep it distinct from the 7 7 pattern that marks a disabled link.
- **Disabled Link:** Use a red dashed stroke, hide packet dots, and show DOWN. Treat a link whose endpoint device is off the same way — traffic cannot cross it either.
- **Severed Path:** When a demand has no route left, draw the links it used to take with a fine red dotted stroke at low opacity. The break must read from end to end, not stop at the dead device. Keep it out of the capacity legend — it reports a lost route, not a capacity state, and the bottleneck note already counts the cut demands.
- **Dead Label:** Give a severed link no live telemetry hook. Its utilization is a true zero, and a live hook turns DOWN into 0% one tick later.

### Zone Group

- **Source:** Read the group tree from the device zone. A slash makes a level: `FABRIC / RACK 04` puts a rack box inside the fabric box.
- **Shape:** Fill the box with a tint of the canvas and outline it with a fine dashed line. The tint separates areas; the line marks the edge.
- **Nesting:** Give a deeper box a lighter fill so it reads as inside its parent, not beside it.
- **Label:** Put the group name at the top-left inside the box. Show the innermost level only, never the full path.
- **Padding:** Give a shallower group more padding, so a parent box always contains its children.
- **Bounds:** Include the group boxes in the canvas bounds. A box that runs past the canvas edge gets clipped.
- **Node Meta:** Show the innermost zone on the node, not the whole path. The inspector carries the full one.

### Worst Single-Failure Axis List

- **Bar Before Number:** Draw a bar under each row, filled to the utilisation in that state's color.
  Twelve rows of same-size monospace put 171% and 73% at one weight, and the eye catches length
  before it reads digits.
- **Unknown Keeps The Track:** A row with no known limit draws the track and no fill. An empty bar
  must never read as spare capacity.
- **Fold The Tail:** Show the worst four and fold the rest behind a count. A reader who opens this
  panel wants what breaches, not the full sweep.
- **Qualifier Is Not The Value:** Set the percentage large and the bounding word under it small.
  They are one fact and a caveat about that fact, not two equal strings.

### Axis Meter

- **Track:** Use a seven-pixel sage track.
- **Fill:** Use cyan for healthy, amber for warning, red for overload and invalid, and slate for unknown.
- **Labels:** Show axis name, status, utilization, load, and limit as text.
- **Overload:** Add a diagonal red pattern to the track.
- **Invalid:** A bad limit leaves the bar empty, so mark the track itself. Add a tight diagonal red pattern and keep it finer than the overload pattern.

### Project and Device Files

- **Save:** Download a versioned Rack Mesh project as JSON. Preserve topology, scenario scale, faults, and selection.
- **Open:** Validate the schema before replacement. Confirm the impact on the current design and the loaded design before replacement.
- **Import:** Accept Rack Mesh performance, Rack Mesh device, and NetBox device type JSON. Open the result in the device form.
- **Safety:** Limit files to 2 MB. Validate structured data and escape imported text before HTML insertion.

### Errors, Empty States, and Confirmation

- **Form Error:** Show validation text in fault red below the related form.
- **File Error:** Use the status toast for parse, schema, and import errors.
- **Empty Inspector:** Center a short explanation and the next available actions.
- **Destructive Action:** Use native confirmation for new design, delete, and project replacement actions. State the affected resources.

### Mobile Failure Tray

- **Position:** Keep it sticky at the top of the mobile flow.
- **Surface:** Use deep forest, light text, and a structural shadow.
- **Controls:** Expose the recommended fault and a button to open the full fault list in a bottom panel.
- **State:** Show UP or DOWN and update `aria-pressed`.

### Reduced Motion

- **Preference:** Hide DOM packet dots and stop visible telemetry variation when reduced motion is active.
- **Voxel Motion:** Keep every voxel chassis at rest. Stop LED and fan animation. Remove chassis filters and transitions.
- **Indicator:** Keep the live label visible without perceptible motion.
- **View Transition:** Stop the blur and clip reveal. Show the selected view immediately.
- **Spatial Motion:** Stop WebGL traffic movement. Preserve manual orbit, zoom, selection, pitch, and yaw.
- **Transitions:** Set other motion duration to 0.01ms. Restore automatic scroll behavior.
- **Cadence:** Reduce telemetry refresh to 2400ms. Preserve flat sparkline history and exact scenario values.

## Do's and Don'ts

### Do:

- **Do** keep the light sage workspace and deep green control frame.
- **Do** draw topology nodes as a device symbol over a label stack.
- **Do** offer classic, voxel, and spatial views without changing scenario results.
- **Do** use CSS 2.5D voxel chassis for all 22 palette device types.
- **Do** render spatial equipment through `THREE.WebGLRenderer`.
- **Do** use geometry profiles for spatial dimensions, color, ports, bays, and antennas.
- **Do** render spatial labels as `CanvasTexture` sprites.
- **Do** label all synthetic telemetry as synthetic.
- **Do** keep presentation variation separate from deterministic scenario results.
- **Do** pair each status color with text, shape, or a line pattern.
- **Do** preserve the fixed topology canvas and mobile pan access.
- **Do** keep the mobile toolbar scroll separate from topology pan.
- **Do** keep editor tasks inline below the toolbar.
- **Do** validate project and import data before state replacement.
- **Do** escape imported or project text before HTML insertion.
- **Do** confirm each destructive action with its affected resources.
- **Do** honor reduced motion for packet dots, telemetry variation, transitions, and scroll behavior.

### Don't:

- **Don't** reduce bps, pps, CPS, sessions, power, or rack space to one health score.
- **Don't** convert unknown capacity data to a healthy state.
- **Don't** let synthetic telemetry change comparison or export values.
- **Don't** show packet dots on disabled links.
- **Don't** shrink the topology canvas to fit a mobile viewport.
- **Don't** place editor tasks in HTML modals or overlays.
- **Don't** replace the current project before validation and confirmation.
- **Don't** hide form errors in a global status message.
- **Don't** encode capacity or failure state with color alone.
- **Do not** use classic SVG symbols as voxel substitutes.
- **Do not** reuse CSS 2.5D voxel chassis as spatial equipment.
- **Do not** build spatial equipment from DOM faces or CSS transforms.
- **Do not** animate WebGL traffic when reduced motion is active.
