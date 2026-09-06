---
name: Rack Mesh
description: A daylight telemetry console for topology constraints and failure effects.
colors:
  ground: "#e7f0ea"
  surface: "#f7faf7"
  surface-raised: "#ffffff"
  surface-tint: "#dceae2"
  panel-deep: "#16332d"
  panel-mid: "#20483f"
  panel-line: "#365a50"
  on-deep: "#f4fbf7"
  on-deep-muted: "#dceae2"
  on-deep-line: "#628279"
  danger-soft: "#ff9c94"
  canvas: "#eaf2ed"
  line: "#9eb9ad"
  line-soft: "#c9d9d1"
  text: "#13241f"
  muted: "#526e64"
  signal: "#b8e737"
  signal-deep: "#587d00"
  amber: "#9a5a00"
  danger: "#b83c34"
  unknown: "#697286"
  cyan: "#087d70"
  action-ink: "#173028"
typography:
  display:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "clamp(20px, 2vw, 31px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.55
  data:
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1
  micro:
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "8px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.08em"
  label:
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "9px"
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
    width: "126px"
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
- Deep green top and mobile control bars.
- Square controls, thin rules, and compact data typography.
- Four summary sparklines and status-aware topology motion.
- An editor toolbar, inline forms, and inspector-based resource edit forms.
- Text, shape, and line patterns that support each semantic color.

## Colors

The palette separates a calm daylight workspace from a deep operational frame. Semantic colors report capacity and fault states.

### Primary

- **Signal Lime** (#b8e737): Use for primary actions, focus outlines, the stable run state, and the brand mark.
- **Deep Signal Green** (#587d00): Use for decisive values, section codes, packet dots, and positive comparison values.

### Secondary

- **Capacity Cyan** (#087d70): Use for healthy resources, active links, live telemetry, and the first sparkline.
- **Constraint Amber** (#9a5a00): Use for caution states and the second sparkline.
- **Fault Red** (#b83c34): Use for overloads, failures, negative changes, and the third sparkline.
- **Unknown Slate** (#697286): Use when a capacity limit is not known.

### Neutral

- **Sage Ground** (#e7f0ea): Use for the page ground.
- **Quiet Surface** (#f7faf7): Use for control panels, summary cells, and inspectors.
- **White Raised Surface** (#ffffff): Use for small markers and symbol highlights.
- **Sage Surface Tint** (#dceae2): Use for topology and comparison regions.
- **Deep Forest Panel** (#16332d): Use for the top bar, toast, and mobile failure tray.
- **Canvas Sage** (#eaf2ed): Use for the fixed topology canvas and its label masks.
- **Forest Text** (#13241f): Use for primary text on light surfaces.
- **Muted Sage Text** (#526e64): Use for notes, labels, and metadata.

### Named Rules

**The Daylight Hierarchy Rule.** Keep work surfaces pale. Reserve deep forest for global control and compact mobile action.

**The Signal Economy Rule.** Reserve signal lime for action, focus, stable state, and selected key values.

**The Red Means Impact Rule.** Use fault red only for failures, overloads, and negative changes.

## Typography

**Display Font:** Avenir Next with Avenir and Segoe UI fallbacks.

**Body Font:** Avenir Next with Avenir and Segoe UI fallbacks.

**Label/Mono Font:** SFMono-Regular with Menlo and Consolas fallbacks.

**Character:** The UI stack keeps Korean copy clear. The monospace stack gives metrics, states, resource names, and section codes an operational rhythm.

### Hierarchy

- **Display** (600, fluid 20px to 31px, 1.2): Use for the topology question.
- **Title** (600, 17px, 1.2): Use for panels, the brand, and comparison titles.
- **Body** (400, 11px, 1.55): Use for notes, source conditions, and scenario context.
- **Data** (600, 10px, 1): Use for metrics, states, resource data, and compact controls.
- **Label** (600, 9px, 0.13em): Use uppercase text for section codes and zone labels.

### Named Rules

**The Data Voice Rule.** Use monospace text for values, machine states, identifiers, and operational labels.

## Layout

The desktop shell stacks the top bar, control deck, editor toolbar, optional editor panel, summary strip, workspace, and comparison panel.

The main workspace uses 250px, a flexible center of at least 680px, and 330px columns.

At 1180px, use 230px and a flexible center of at least 650px. Place the inspector below in four columns.

At 1180px, place editor forms in three columns. Keep demand rows in four columns with internal horizontal scroll.

At 760px, use one vertical flow and a two-column summary. Place topology before failures and the inspector.

At 760px, place editor forms and demand rows in two columns. Keep each form action row across the full width.

Keep the topology canvas at 940px by 580px. On mobile, cap its viewport at 500px and provide horizontal pan access.

Give the mobile editor toolbar its own horizontal scroll. Preserve the separate pan region inside the topology viewport.

Keep the mobile failure tray sticky at the top. Keep its deep green surface above the light workspace.

Use the observed space rhythm: 8px for compact gaps, 14px for mobile controls, 18px for panels, and 22px for shell edges.

## Elevation & Depth

The system uses tonal layers, one-pixel borders, and limited shadows. White nodes lift from the sage canvas without a card-heavy page.

### Shadow Vocabulary

- **Status Glow** (`0 2px 10px currentColor`): Mark the current scenario state in the top bar.
- **Live Glow** (`0 2px 9px color-mix(in srgb, var(--cyan) 65%, transparent)`): Mark the live telemetry indicator.
- **Node Rest** (`0 8px 22px color-mix(in srgb, var(--panel-deep) 15%, transparent)`): Separate white nodes from the canvas.
- **Node State Glow** (`0 8px 26px color-mix(in srgb, var(--node-color) 18%, transparent)`): Mark hover and selection.
- **Sticky Tray** (`0 8px 22px color-mix(in srgb, var(--panel-deep) 24%, transparent)`): Separate the mobile tray from content.
- **Toast Lift** (`0 10px 30px color-mix(in srgb, var(--panel-deep) 24%, transparent)`): Lift transient result feedback.

### Named Rules

**The Structural Depth Rule.** Use surface tone and borders before shadow.

## Shapes

The system uses square geometry. Buttons, badges, nodes, panels, meters, switches, and toast feedback have no corner radius.

Use one-pixel borders for structure. Use dashed borders for disabled nodes and a 7 7 dash pattern for disabled links.

Use three-pixel status rails under node symbols. Use seven-pixel axis meters for clear load comparison.

## Components

### Buttons

- **Shape:** Use square corners and a minimum height of 40px.
- **Primary:** Use signal lime, dark action text, and 15px horizontal padding.
- **Text:** Use a transparent surface and a visible border on the deep top bar.
- **Hover / Focus:** Shift the border or surface. Use a 2px signal focus outline with a 3px offset.

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

- **Device:** Edit the name, zone, and independent capacity limits below the device telemetry.
- **Link:** Edit directional capacity below the link telemetry.
- **Empty:** If the topology has no devices, explain how to add or import the first device.
- **Delete:** Keep resource deletion beside the apply action. Use fault red for the delete label.

### Top Bar and Live State

- **Frame:** Use the deep forest surface, light text, and a 72px minimum height.
- **Run State:** Pair an 8px lamp with visible state text. Use lime, amber, or red for state.
- **Warning Tier:** Name the warning tier the engine already computes. A design holding resources above the warning threshold must never read as stable, and the count belongs in the text.
- **Live State:** Pair a cyan 7px indicator with `LIVE · SYNTHETIC TELEMETRY`.
- **Motion:** Use a 1.8s alternate breath with the standard motion curve.

### Summary Metrics and Sparklines

- **Structure:** Present four equal summary cells. Keep 28 recent samples in each SVG sparkline.
- **Series:** Show headroom, maximum utilization, delivery, and total traffic.
- **Legend:** Name every capacity state the canvas can paint, disabled included. A state the canvas draws but the legend omits is unreadable.
- **One Name Per State:** The legend and the inspector must call a state the same thing. Two names for one state read as two states.
- **Color:** Use cyan, amber, red, and deep signal green in that order.
- **Headline Number:** Do not animate the largest number on the page. Synthetic variation belongs in the sparkline; a headline that drifts between two values contradicts the fixed comparison panel and the reader cannot tell which to trust.
- **Metric Color:** Color the headroom figure by the same threshold the engine judges with. A figure the engine calls warning must not be painted the healthy color.
- **Telemetry:** Add about ±1–2% synthetic variation to the presentation layer. Keep scenario values unchanged.
- **Cadence:** Refresh visible motion every 820ms. Pause refresh work while the document is hidden.

### Design Board Tabs

- **Tabs:** Split the left board into a component tab and a failure tab. Keep the component tab first and open by default, because building comes before breaking.
- **Shape:** Use a two-pixel underline on the open tab. Use no corner radius and no filled tab body.
- **Badge:** Show the active-fault count only on the failure tab. Hide it on the component tab.
- **Keyboard:** Move between tabs with the arrow keys, Home, and End. Keep only the open tab in the tab order.

### Editor Panel Placement

- **Overlay:** Float the panel under the toolbar. Opening it must not move the summary strip or the workspace.
- **Cover:** Let it cover what sits below and cast a shadow, so the panel reads as temporary.
- **Dismiss:** Close on Escape, on the close button, and on a press outside the panel.
- **Height:** Cap it to the viewport and scroll inside. Never let it push the page taller.

### Canvas Headline

- **Answer, Not Question:** The largest type on the canvas states the answer — the binding resource, its axis and direction, and its utilisation. A standing question in display type while its answer sits in 11px at the fold is the wrong way round.
- **Tone:** Color the headline by the binding axis state, so overload and caution read before the number does.
- **Detail Line:** Under it, state the load against the limit and how much growth is left before the first overload.
- **Growth Limit:** Find that multiplier by bisecting the workload scale with the engine. It is a fact the tool can already compute and had nowhere to say.

### Bottleneck Note

- **Placement:** Put one sentence under the canvas saying what limits the design right now.
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

### Topology Node and Link

- **Pointer Layers:** The node layer covers the whole canvas, so it must pass pointer events through and let only the nodes take them. Otherwise the links underneath cannot be clicked at all.
- **Node:** Stack a 92 by 42 device symbol over a label block in a 104px column. Use no card border, no card surface, and no shadow. Keep the node small: a topology holds dozens of them, and the axis rows carry the reading.
- **Anchor:** Keep the device position at the center of the symbol box. Offset the node by half the symbol height, never by half the node height.
- **Symbol:** Draw one inline sprite symbol for each device. Map the device class to a symbol and fall back to the rack symbol. Paint the symbol with text color, never with state color. Shape carries the class. Color and token carry the state.
- **Symbol Choice:** The stencil set draws the server variants as one stack plus a small mark. At node size that mark disappears. If the set holds a shape with a different outline, map the class to that shape. Draw the database class as the cylinder.
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
- **Controls:** Expose FW A, FW B, and a link to the full list.
- **State:** Show UP or DOWN and update `aria-pressed`.

### Reduced Motion

- **Preference:** If reduced motion is active, hide packet dots and stop visible telemetry variation.
- **Indicator:** Keep the live label visible without perceptible motion.
- **Transitions:** Set motion duration to 0.01ms and restore automatic scroll behavior.
- **Cadence:** Reduce telemetry refresh to 2400ms. Preserve flat sparkline history and exact scenario values.

## Do's and Don'ts

### Do:

- **Do** keep the light sage workspace and deep green control frame.
- **Do** draw topology nodes as a device symbol over a label stack.
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
