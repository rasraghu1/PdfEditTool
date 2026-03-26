import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

import { extractTextSpans, applyTextReplacements } from "./src/pdfEditor.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const sessions = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/pdfjs-dist", express.static(path.join(__dirname, "node_modules", "pdfjs-dist")));
app.use("/vendor/pdf-lib", express.static(path.join(__dirname, "node_modules", "pdf-lib", "dist")));

app.post("/api/extract", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a PDF file." });
    }

    const pdfBytes = req.file.buffer;
    const spans = await extractTextSpans(pdfBytes);
    const sessionId = uuidv4();

    sessions.set(sessionId, {
      fileName: req.file.originalname,
      pdfBytes,
      spans,
      createdAt: Date.now()
    });

    return res.json({
      sessionId,
      fileName: req.file.originalname,
      spanCount: spans.length,
      spans
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to extract PDF text." });
  }
});

app.post("/api/apply", async (req, res) => {
  try {
    const { sessionId, replacements } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Upload session not found. Please upload the PDF again." });
    }

    const result = await applyTextReplacements(session.pdfBytes, session.spans, replacements || []);
    const outputName = buildOutputName(session.fileName);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${outputName}"`);
    res.setHeader("X-Pdf-Warnings", encodeURIComponent(JSON.stringify(result.warnings)));

    return res.send(Buffer.from(result.pdfBytes));
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to update PDF." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`PDF editor running at http://localhost:${port}`);
});

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.createdAt > 1000 * 60 * 60) {
      sessions.delete(sessionId);
    }
  }
}, 1000 * 60 * 10);

function buildOutputName(fileName) {
  if (fileName.toLowerCase().endsWith(".pdf")) {
    return `${fileName.slice(0, -4)}_edited.pdf`;
  }

  return `${fileName}_edited.pdf`;
}