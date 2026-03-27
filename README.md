# PDF Text Editor

This is a JavaScript PDF editing tool that now runs fully in the browser. You can host it for free on GitHub Pages and open it from a single link.

## Live app

After the `Deploy GitHub Pages` workflow finishes, the app will be available at:

```text
https://rasraghu1.github.io/PdfEditTool/
```

## What the tool does

- Uploads a PDF through the browser.
- Extracts text spans from each page.
- Lets you search the extracted text and pick the exact span to edit.
- Rebuilds the PDF with your replacement text placed over the original text area.
- Runs entirely in the browser, so no local server is required for the hosted version.

## Important limitations

- This works best for text-based PDFs.
- Scanned PDFs or image-only PDFs are not supported in this simplified version.
- The tool preserves position and font size closely, but exact font reuse is not always possible because many PDFs contain embedded fonts that cannot be directly reused during rewriting.
- Replacement text that is much longer than the original may overlap nearby content.
- The current implementation paints a white rectangle over the original text area before drawing the replacement text.

## Tech stack

- Browser-side JavaScript
- PDF.js for text extraction
- pdf-lib for rebuilding the PDF
- GitHub Pages for free hosting

## Free one-click GitHub hosting

This repository includes a GitHub Actions workflow at [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) that publishes the contents of [public/index.html](public/index.html) to GitHub Pages.

To enable it in GitHub:

1. Open the repository Settings page.
2. Open Pages.
3. Under Build and deployment, choose GitHub Actions.
4. Push to `main`.
5. Wait for the `Deploy GitHub Pages` workflow to finish.

After that, opening the GitHub Pages URL is the one-click way to use the app.

## Run locally

1. Install dependencies:

```powershell
npm install
```

2. Start the app:

```powershell
npm start
```

3. Open the app:

```text
http://localhost:3000
```

Local Node usage is still supported, but it is no longer required for the hosted GitHub Pages version.

## One-click start on Windows

If you do not want to open VS Code or run terminal commands manually:

1. Double-click `start-pdf-tool.cmd`
2. Or double-click `start-pdf-tool-hidden.vbs` to start it with less visible terminal noise
3. Your browser will open `http://localhost:3000`

Notes:

- The first run may take longer because it installs `node_modules`
- You still need Node.js installed on the machine
- A terminal window may stay open while the server is running when using the `.cmd` launcher

## Hosted mode limitations

- The GitHub Pages version has no backend, so all processing happens in your browser tab.
- Font matching is based on standard PDF fonts in hosted mode, so some edited text may look slightly different from the original.
- Large PDFs may use more browser memory than the local server version.

## Project files

- `server.js`: Express server and upload endpoints
- `src/pdfEditor.js`: PDF extraction and replacement logic
- `public/index.html`: UI layout
- `public/app.js`: browser-side logic
- `public/styles.css`: styling

## Simplified flow

- Upload PDF
- Search extracted text
- Edit selected text
- Queue changes
- Build and download updated PDF