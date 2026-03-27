import {
  applyTextReplacements,
  extractTextSpans,
  getPdfJs,
  getPdfLib
} from "./pdfEditorBrowser.js";

const state = {
  originalPdfBytes: null,
  fileName: null,
  spans: [],
  filteredSpans: [],
  selectedSpanId: null,
  replacements: new Map()
};

const uploadForm = document.getElementById("upload-form");
const fileInput = document.getElementById("pdf-file");
const statusEl = document.getElementById("status");
const workspaceEl = document.getElementById("workspace");
const spanListEl = document.getElementById("span-list");
const searchInputEl = document.getElementById("search-input");
const spanCounterEl = document.getElementById("span-counter");
const emptyStateEl = document.getElementById("empty-state");
const editorEl = document.getElementById("editor");
const selectionMetaEl = document.getElementById("selection-meta");
const originalTextEl = document.getElementById("original-text");
const newTextEl = document.getElementById("new-text");
const fontFamilyOverrideEl = document.getElementById("font-family-override");
const fontStyleOverrideEl = document.getElementById("font-style-override");
const fontSizeScaleEl = document.getElementById("font-size-scale");
const yOffsetEl = document.getElementById("y-offset");
const inkStrengthEl = document.getElementById("ink-strength");
const preserveSizeEl = document.getElementById("preserve-size");
const queueEditButton = document.getElementById("queue-edit");
const changesListEl = document.getElementById("changes-list");
const buildPdfButton = document.getElementById("build-pdf");
const flattenOutputEl = document.getElementById("flatten-output");
const warningsEl = document.getElementById("warnings");

uploadForm.addEventListener("submit", handleUpload);
searchInputEl.addEventListener("input", renderSpanList);
queueEditButton.addEventListener("click", queueSelectedEdit);
buildPdfButton.addEventListener("click", buildUpdatedPdf);

async function handleUpload(event) {
  event.preventDefault();

  const file = fileInput.files[0];
  if (!file) {
    setStatus("Select a PDF file first.", true);
    return;
  }

  warningsEl.innerHTML = "";
  changesListEl.innerHTML = "";

  try {
    setStatus("Reading PDF in the browser and extracting text...");
    const pdfBytes = new Uint8Array(await file.arrayBuffer());
    const spans = await extractTextSpans(pdfBytes);

    state.originalPdfBytes = pdfBytes;
    state.fileName = file.name;
    state.spans = spans;
    state.replacements = new Map();
    state.selectedSpanId = null;

    workspaceEl.classList.remove("hidden");
    clearSelection();
    renderSpanList();
    renderChanges();

    if (!spans.length) {
      setStatus("No editable text spans were found. This simplified tool only supports normal text PDFs.", true);
      return;
    }

    setStatus(`Extracted ${spans.length} editable text spans from ${file.name}.`);
  } catch (error) {
    setStatus(error.message || "Could not process the PDF.", true);
  }
}

function renderSpanList() {
  const query = searchInputEl.value.trim().toLowerCase();
  state.filteredSpans = state.spans.filter((span) => span.text.toLowerCase().includes(query));
  spanCounterEl.textContent = `${state.filteredSpans.length} spans`;
  spanListEl.innerHTML = "";

  if (!state.filteredSpans.length) {
    spanListEl.innerHTML = '<div class="placeholder">No extracted text matches the current search.</div>';
    return;
  }

  for (const span of state.filteredSpans) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `span-item${span.id === state.selectedSpanId ? " selected" : ""}`;
    button.innerHTML = `
      <strong>Page ${span.pageNumber + 1} | Span ${span.id}</strong>
      <span>${escapeHtml(trimText(span.text, 120))}</span>
    `;
    button.addEventListener("click", () => selectSpan(span.id));
    spanListEl.appendChild(button);
  }
}

function selectSpan(spanId) {
  persistCurrentSelection();
  state.selectedSpanId = spanId;

  const span = state.spans.find((item) => item.id === spanId);
  if (!span) {
    clearSelection();
    return;
  }

  emptyStateEl.classList.add("hidden");
  editorEl.classList.remove("hidden");
  selectionMetaEl.textContent = `Page ${span.pageNumber + 1} | ${getSpanStyleSummary(span)}`;
  originalTextEl.value = span.text;
  const replacement = state.replacements.get(span.id);
  newTextEl.value = replacement?.newText ?? span.text;
  loadTuningControls(replacement?.tuning);
  renderSpanList();
}

function clearSelection() {
  state.selectedSpanId = null;
  emptyStateEl.classList.remove("hidden");
  editorEl.classList.add("hidden");
  loadTuningControls();
  renderSpanList();
}

function queueSelectedEdit() {
  const span = persistCurrentSelection();
  if (!span) {
    setStatus("Choose a text span before queuing an edit.", true);
    return;
  }

  if (state.replacements.has(span.id)) {
    setStatus(`Queued an edit for span ${span.id} on page ${span.pageNumber + 1}.`);
    return;
  }

  setStatus(`No change detected for span ${span.id}.`, true);
}

function renderChanges() {
  changesListEl.innerHTML = "";

  if (!state.replacements.size) {
    changesListEl.innerHTML = '<div class="placeholder">No changes queued yet.</div>';
    return;
  }

  for (const replacement of state.replacements.values()) {
    const span = state.spans.find((item) => item.id === replacement.id);
    if (!span) {
      continue;
    }

    const card = document.createElement("article");
    card.className = "change-card";
    card.innerHTML = `
      <div class="change-top">
        <strong>Page ${span.pageNumber + 1} | Span ${span.id}</strong>
        <button type="button">Remove</button>
      </div>
      <p><span>Original</span>${escapeHtml(span.text)}</p>
      <p><span>New</span>${escapeHtml(replacement.newText)}</p>
    `;
    const tuningSummary = formatTuningSummary(replacement.tuning);
    if (tuningSummary) {
      const tuningNote = document.createElement("div");
      tuningNote.className = "change-note";
      tuningNote.textContent = tuningSummary;
      card.appendChild(tuningNote);
    }
    card.querySelector("button").addEventListener("click", () => {
      state.replacements.delete(span.id);
      renderChanges();
      if (state.selectedSpanId === span.id) {
        newTextEl.value = span.text;
        loadTuningControls();
      }
    });
    changesListEl.appendChild(card);
  }
}

async function buildUpdatedPdf() {
  persistCurrentSelection();

  if (!state.originalPdfBytes) {
    setStatus("Upload a PDF first.", true);
    return;
  }

  if (!state.replacements.size) {
    setStatus("Queue at least one edit before building the updated PDF.", true);
    return;
  }

  setStatus("Applying text changes and building the updated PDF...");
  warningsEl.innerHTML = "";

  try {
    const result = await applyTextReplacements(
      state.originalPdfBytes,
      state.spans,
      Array.from(state.replacements.values())
    );

    const blob = new Blob([result.pdfBytes], { type: "application/pdf" });
    const warnings = [...result.warnings];
    let finalBlob = blob;

    if (flattenOutputEl.checked) {
      setStatus("Flattening the updated PDF to remove the original hidden text layer...");
      finalBlob = await flattenPdfBlob(blob);
      warnings.push("Flattened output removes the original hidden text layer, so copied text from the edited PDF will no longer return the old source text.");
    }

    renderWarnings(warnings);

    const downloadUrl = URL.createObjectURL(finalBlob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = buildOutputName(state.fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
    }, 30000);

    setStatus(flattenOutputEl.checked
      ? "Updated PDF generated and flattened. The download should start automatically."
      : "Updated PDF generated. The download should start automatically.");
  } catch (error) {
    setStatus(error.message || "Could not build the updated PDF.", true);
  }
}

async function flattenPdfBlob(sourceBlob) {
  const pdfjsLib = await getPdfJs();
  const pdfLib = await getPdfLib();
  const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: sourceBytes });
  const sourcePdf = await loadingTask.promise;
  const outputPdf = await pdfLib.PDFDocument.create();

  for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
    const page = await sourcePdf.getPage(pageNumber);
    const renderViewport = page.getViewport({ scale: 2 });
    const baseViewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);

    await page.render({
      canvasContext: context,
      viewport: renderViewport
    }).promise;

    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Could not flatten the edited PDF page."));
      }, "image/png");
    });

    const pngBytes = await pngBlob.arrayBuffer();
    const image = await outputPdf.embedPng(pngBytes);
    const outputPage = outputPdf.addPage([baseViewport.width, baseViewport.height]);
    outputPage.drawImage(image, {
      x: 0,
      y: 0,
      width: baseViewport.width,
      height: baseViewport.height
    });
  }

  const flattenedBytes = await outputPdf.save({
    useObjectStreams: false,
    addDefaultPage: false
  });

  return new Blob([flattenedBytes], { type: "application/pdf" });
}

function renderWarnings(warnings) {
  warningsEl.innerHTML = "";
  if (!warnings.length) {
    return;
  }

  for (const warning of warnings) {
    const item = document.createElement("div");
    item.className = "warning-item";
    item.textContent = warning;
    warningsEl.appendChild(item);
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function persistCurrentSelection() {
  if (!state.selectedSpanId || !newTextEl) {
    return null;
  }

  const span = state.spans.find((item) => item.id === state.selectedSpanId);
  if (!span) {
    return null;
  }

  const nextValue = newTextEl.value;
  const tuning = getCurrentTuning();
  if (nextValue !== span.text) {
    state.replacements.set(span.id, {
      id: span.id,
      newText: nextValue,
      tuning
    });
  } else {
    state.replacements.delete(span.id);
  }

  renderChanges();
  return span;
}

function getSpanStyleSummary(span) {
  const fontName = span.fontFamily || span.fontName || "Unknown font";
  return `${fontName} | ${span.fontSize.toFixed(1)} pt`;
}

function getCurrentTuning() {
  return {
    fontFamily: fontFamilyOverrideEl.value,
    fontStyle: fontStyleOverrideEl.value,
    fontSizeScale: Number(fontSizeScaleEl.value || 100),
    yOffset: Number(yOffsetEl.value || 0),
    inkStrength: Number(inkStrengthEl.value || 112),
    preserveOriginalSize: preserveSizeEl.checked
  };
}

function loadTuningControls(tuning = null) {
  fontFamilyOverrideEl.value = tuning?.fontFamily || "auto";
  fontStyleOverrideEl.value = tuning?.fontStyle || "auto";
  fontSizeScaleEl.value = String(tuning?.fontSizeScale ?? 100);
  yOffsetEl.value = String(tuning?.yOffset ?? 0);
  inkStrengthEl.value = String(tuning?.inkStrength ?? 112);
  preserveSizeEl.checked = tuning?.preserveOriginalSize ?? true;
}

function formatTuningSummary(tuning) {
  if (!tuning) {
    return "";
  }

  const parts = [];
  if (tuning.fontFamily && tuning.fontFamily !== "auto") {
    parts.push(`font ${tuning.fontFamily}`);
  }
  if (tuning.fontStyle && tuning.fontStyle !== "auto") {
    parts.push(`style ${tuning.fontStyle}`);
  }
  if (Number(tuning.fontSizeScale) !== 100) {
    parts.push(`size ${tuning.fontSizeScale}%`);
  }
  if (Number(tuning.yOffset) !== 0) {
    parts.push(`y ${tuning.yOffset > 0 ? "+" : ""}${tuning.yOffset}`);
  }
  if (Number(tuning.inkStrength) !== 112) {
    parts.push(`ink ${tuning.inkStrength}%`);
  }
  if (tuning.preserveOriginalSize === false) {
    parts.push("auto-fit size");
  } else {
    parts.push("keep size");
  }

  return parts.length ? `Manual tuning: ${parts.join(" | ")}` : "";
}

function trimText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function buildOutputName(fileName) {
  return fileName.toLowerCase().endsWith(".pdf")
    ? `${fileName.slice(0, -4)}_edited.pdf`
    : `${fileName}_edited.pdf`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br>");
}