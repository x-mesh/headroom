# drawio stencils — third-party notice

Rack Mesh device symbols come from the draw.io (diagrams.net) stencil library.

## Source

- Upstream: https://github.com/jgraph/drawio
- File: `src/main/webapp/stencils/networks.xml`
- Commit and checksums: see `PROVENANCE.json`

`networks.subset.xml` holds network shapes copied byte for byte from that file.
`scripts/build-icons.mjs` converts them to SVG in `src/icons.js`.

`references.subset.xml` holds observed XML stencils and only the resource-icon
dependencies that those references require. `PROVENANCE.json` lists the upstream
path and checksum for every source and subset.

`PROVENANCE.json` lists the observed custom-shape sources and their exact port
scope. If an AWS resource icon has no exact dependency, its upstream wrapper
draws only its background. The importer does not alias it to a similar glyph.

## License

The draw.io source code is licensed under the Apache License 2.0.

The stencil libraries carry an additional restriction. `LICENSE.txt` holds the
upstream text without changes. It reads:

> The icon sets and stencil libraries included in this software, and any
> derivatives thereof (including conversions to other formats, traced
> reproductions, or substantially similar visual representations), may not be
> displayed within, distributed for use with, or incorporated into products
> distributed through the Atlassian marketplace or plugin ecosystem, without
> explicit written permission.

The generated SVG in `src/icons.js` is a format conversion. It is a derivative
work under this clause. The restriction applies to products distributed through
the Atlassian marketplace or plugin ecosystem. Rack Mesh is not such a product,
so the restriction does not block this use.

If the distribution of Rack Mesh changes, review this clause again.

## Trademarks

The Apache License 2.0 does not grant trademark rights. The generated registry
uses only the paths recorded in `PROVENANCE.json`. It does not include a full
vendor stencil pack.
