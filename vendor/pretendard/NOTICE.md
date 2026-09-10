# Pretendard — third-party notice

Rack Mesh draws Hangul with Pretendard. The pinned display face, Avenir Next, has no
Hangul coverage, so before this the glyphs came from whatever the reader's OS chose.

## Source

- Upstream: https://github.com/orioncactus/pretendard
- Package: `pretendard@1.3.9`, files `dist/web/static/woff2/Pretendard-{Regular,SemiBold}.woff2`
- Checksums and byte counts: see `PROVENANCE.json`

The two files under `public/fonts/` are copied byte for byte from that package.
Run `npm run fonts:vendor` to refetch them.

## License

Pretendard is licensed under the SIL Open Font License, Version 1.1, with the
Reserved Font Name Pretendard. Copyright (c) 2021 Kil Hyung-jin.

- License text: https://github.com/orioncactus/pretendard/blob/main/LICENSE
- The OFL permits bundling and web use. It requires this notice to ship with the
  font files and forbids releasing a modified version under the reserved name.

Rack Mesh ships the files unmodified and does not rename them.

## Scope

`styles.css` binds these faces with a `unicode-range` limited to Hangul, so Latin
text, digits, and the monospace data voice are unaffected.
