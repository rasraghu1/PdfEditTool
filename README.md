# PDF Text Editor

This is a JavaScript web tool that lets you upload a normal text-based PDF, inspect the extracted text spans, change the text you need, and download an updated PDF.

## What the tool does

- Uploads a PDF through the browser.
- Extracts text spans from each page.
- Lets you search the extracted text and pick the exact span to edit.
- Rebuilds the PDF with your replacement text placed over the original text area.

## Important limitations

- This works best for text-based PDFs.
- Scanned PDFs or image-only PDFs are not supported in this simplified version.
- The tool preserves position and font size closely, but exact font reuse is not always possible because many PDFs contain embedded fonts that cannot be directly reused during rewriting.
- Replacement text that is much longer than the original may overlap nearby content.
- The current implementation paints a white rectangle over the original text area before drawing the replacement text.

## Tech stack

- Node.js
- Express
- PDF.js for text extraction
- pdf-lib for rebuilding the PDF

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

## One-click start on Windows

If you do not want to open VS Code or run terminal commands manually:

1. Double-click `start-pdf-tool.cmd`
2. Or double-click `start-pdf-tool-hidden.vbs` to start it with less visible terminal noise
3. Your browser will open `http://localhost:3000`

Notes:

- The first run may take longer because it installs `node_modules`
- You still need Node.js installed on the machine
- A terminal window may stay open while the server is running when using the `.cmd` launcher

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