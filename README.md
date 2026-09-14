# Rack Mesh

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

Rack Mesh is a browser tool for topology authoring and infrastructure constraint analysis.
It shows independent capacity axes, fault impact, 3D topology, and 2D or 3D rack placement.

Live site: https://x-mesh.github.io/headroom/

## What it does

You can draw a topology, set workload conditions, inject faults, and inspect the limiting axis.
You can place topology devices and standalone equipment in 2D or 3D racks.
You can export a project file, a diagram, and human-readable reports.

Rack Mesh keeps calculations local to the browser.
It uses synthetic demonstration data unless you import your own project or evidence.

## Limits

The simulator evaluates the declared topology, paths, workload conditions, and capacity values.
It does not simulate packets, queues, convergence, or physical device behavior.
Catalog values are reference data and do not certify vendor capacity for a deployment.
Imported and user-authored names remain project content and do not receive automatic translation.

## Local use

Run the local server from the repository root.

```sh
npm start
```

Open the address that the server prints.

## Verification

Run the full test suite.

```sh
npm test
npm run check
npm run smoke
```

The project uses the current schema and keeps stable action IDs, import formats, and export formats.
