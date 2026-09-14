# three.js — third-party notice

Rack Mesh draws the 3D topology and the rack elevation with three.js.

## Source

- Upstream: https://github.com/mrdoob/three.js
- Package: `three@0.186.0`, files `build/three.module.js`, `build/three.core.js`
- Checksums and byte counts: see `PROVENANCE.json`

The files under `public/vendor/` are copied byte for byte from that package.
Run `npm run three:vendor` to refresh them after changing the pinned version.

## Why they are committed

The deployed image copies `public/` and nothing else. A path that only the
development server knows how to serve is a path that 404s in production.

## License

three.js is licensed under the MIT License. Copyright (c) 2010-2025 three.js authors.

- License text: https://github.com/mrdoob/three.js/blob/dev/LICENSE
- The MIT licence permits bundling and requires this notice to ship with the files.

Rack Mesh ships them unmodified.
