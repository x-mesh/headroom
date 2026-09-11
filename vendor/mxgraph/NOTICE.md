# mxGraph edge routing — third-party notice

Rack Mesh imports draw.io diagrams. An imported edge must follow the path its
source file had, so the importer uses draw.io's own routing code.

## Source

- Upstream: https://github.com/jgraph/mxgraph
- Shipped inside: draw.io desktop 25.0.1
- Files and checksums: see `PROVENANCE.json`

`public/vendor/mx-edge-style.js` holds the routing members copied from those
files. The copy adds a module wrapper and the small shims the members need. It
changes no routing logic.

The vendored members are:

- `mxEdgeStyle.OrthConnector` routes an orthogonal edge that has no waypoints.
- `mxEdgeStyle.SegmentConnector` routes one that has waypoints. `OrthConnector`
  delegates to it.
- `mxEdgeStyle.getJettySize`, `scalePointArray`, `scaleCellState` and
  `getRoutePattern` support the two routers.
- `mxPerimeter.RectanglePerimeter` places each end on the shape outline.

`public/drawio-import.js` presents the parsed model to these members the way
`mxGraphView` presents its own state. It does not reimplement the routing.

## Why a copy

A reimplementation drifts. Small differences in face selection or jetty size
move a line far enough to read as a different diagram. The copy keeps the
imported path identical to the source file.

Do not hand-edit `public/vendor/mx-edge-style.js`. To update it, extract the
upstream files again and record the new checksums in `PROVENANCE.json`.

## License

mxGraph is licensed under the Apache License 2.0. The vendored members carry
that license. The Apache License 2.0 does not grant trademark rights.
