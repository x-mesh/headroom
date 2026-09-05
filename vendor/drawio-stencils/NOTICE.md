# drawio stencils — third-party notice

Rack Mesh device symbols come from the draw.io (diagrams.net) stencil library.

## Source

- Upstream: https://github.com/jgraph/drawio
- File: `src/main/webapp/stencils/networks.xml`
- Commit and checksums: see `PROVENANCE.json`

`networks.subset.xml` holds eight shapes copied byte for byte from that file:
Switch, Router, Firewall, Load Balancer, Server, Storage, Rack, and Cloud.
`scripts/build-icons.mjs` converts them to SVG in `src/icons.js`.

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

The Apache License 2.0 does not grant trademark rights. The `networks.xml`
shapes are vendor neutral. This project does not use the vendor stencil
directories (`cisco/`, `aws/`, `azure2/`, `gcp/`, `ibm/`), because those carry
separate trademark conditions.
