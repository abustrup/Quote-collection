# vendor

Third-party code, committed rather than installed.

The site has no build step and no runtime network access — the importer must
work from a phone on aeroplane wifi, and from a folder that has never seen
`npm install` — so its one dependency lives here in full.

## pdf.js

| | |
| --- | --- |
| Package | [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) 6.2.108 |
| Licence | Apache-2.0, see `pdf.js-LICENSE` |
| `pdf.mjs` | copied from `legacy/build/pdf.min.mjs` |
| `pdf.worker.mjs` | copied from `legacy/build/pdf.worker.min.mjs` |

The **legacy** build, not the default one: the default build reaches for
`DOMMatrix` at module scope and so cannot be loaded in Node, and running the
parser under `node --test` against the same file the browser loads is the whole
point of vendoring it. The minified variants, because the unminified pair is
three megabytes of generated code and nobody is going to read it in a diff.

`assets/import.js` points `GlobalWorkerOptions.workerSrc` at `pdf.worker.mjs`
through `import.meta.url`, so the worker resolves correctly under the project
subpath GitHub Pages serves the site from.

To refresh:

```sh
npm i pdfjs-dist@latest
cp node_modules/pdfjs-dist/legacy/build/pdf.min.mjs        vendor/pdf.mjs
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs vendor/pdf.worker.mjs
cp node_modules/pdfjs-dist/LICENSE                         vendor/pdf.js-LICENSE
node --test tests/import.test.mjs
```
