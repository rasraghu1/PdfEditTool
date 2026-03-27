import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb
} from "https://esm.sh/pdf-lib@1.17.1";

const standardFontDataUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

export async function getPdfJs() {
  return pdfjsLib;
}

export async function getPdfLib() {
  return {
    PDFDocument
  };
}

export async function extractTextSpans(pdfBytes) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    useWorkerFetch: true,
    isEvalSupported: false,
    standardFontDataUrl
  });
  const pdf = await loadingTask.promise;
  const spans = [];
  let spanId = 1;

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const rawSpans = [];

    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) {
        continue;
      }

      const style = textContent.styles?.[item.fontName] || {};
      const [scaleX, skewX, , scaleY, x, y] = item.transform;
      const fontSize = Math.abs(scaleY) || item.height || 10;
      const width = item.width || estimateWidth(item.str, fontSize);
      const height = item.height || fontSize;
      const angle = normalizeAngle(Math.atan2(skewX, scaleX) * (180 / Math.PI));
      const ascent = Number.isFinite(style.ascent) ? style.ascent : 0.82;
      const descent = Number.isFinite(style.descent) ? style.descent : -0.18;
      const top = y + ascent * fontSize;
      const bottom = y + descent * fontSize;
      const fontFamily = String(style.fontFamily || item.fontName || "Helvetica");
      const fontDescriptor = `${item.fontName || ""} ${fontFamily}`.trim();

      rawSpans.push({
        pageNumber: pageIndex - 1,
        text: item.str,
        fontName: item.fontName || "Helvetica",
        fontFamily,
        fontDescriptor,
        fontSize,
        x,
        y,
        width,
        height,
        angle,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        top,
        bottom,
        hasEol: Boolean(item.hasEOL),
        direction: item.dir || "ltr"
      });
    }

    for (const mergedSpan of mergeAdjacentSpans(rawSpans)) {
      spans.push({ id: spanId, ...mergedSpan });
      spanId += 1;
    }
  }

  return spans;
}

export async function applyTextReplacements(pdfBytes, spans, replacements) {
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true
  });

  try {
    const form = pdfDoc.getForm();
    if (form.getFields().length) {
      form.flatten();
    }
  } catch {
    // Some PDFs do not expose a usable AcroForm; continue with page-content editing.
  }

  const pages = pdfDoc.getPages();
  const warnings = [];
  const standardFontCache = {
    Helvetica: await pdfDoc.embedFont(StandardFonts.Helvetica),
    HelveticaBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    HelveticaOblique: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    HelveticaBoldOblique: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
    TimesRoman: await pdfDoc.embedFont(StandardFonts.TimesRoman),
    TimesBold: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
    TimesItalic: await pdfDoc.embedFont(StandardFonts.TimesRomanItalic),
    TimesBoldItalic: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
    Courier: await pdfDoc.embedFont(StandardFonts.Courier),
    CourierBold: await pdfDoc.embedFont(StandardFonts.CourierBold),
    CourierOblique: await pdfDoc.embedFont(StandardFonts.CourierOblique),
    CourierBoldOblique: await pdfDoc.embedFont(StandardFonts.CourierBoldOblique)
  };
  const spanMap = new Map(spans.map((span) => [span.id, span]));

  for (const replacement of replacements) {
    const span = spanMap.get(Number(replacement.id));
    if (!span) {
      warnings.push(`Skipped span ${replacement.id}: original text span not found.`);
      continue;
    }

    const page = pages[span.pageNumber];
    if (!page) {
      warnings.push(`Skipped span ${replacement.id}: page not found.`);
      continue;
    }

    const tuning = normalizeTuning(replacement.tuning);
    const font = resolveStandardFont(span, tuning, standardFontCache);
    const newText = String(replacement.newText ?? "");
    const baseFontSize = (span.fontSize || 10) * tuning.fontSizeScale;
    const sourceRegions = Array.isArray(span.sourceRegions) && span.sourceRegions.length
      ? span.sourceRegions
      : [{ x: span.x, width: span.width, top: span.top, bottom: span.bottom }];
    const minX = Math.min(...sourceRegions.map((region) => region.x));
    const maxX = Math.max(...sourceRegions.map((region) => region.x + region.width));
    const top = Math.max(...sourceRegions.map((region) => region.top));
    const bottom = Math.min(...sourceRegions.map((region) => region.bottom));
    const availableWidth = Math.max(maxX - minX, 1);
    const availableHeight = Math.max(top - bottom, span.height || baseFontSize);
    const fittedFontSize = fitFontSizeToRegion(font, newText, baseFontSize, availableWidth, availableHeight);
    const fontSize = tuning.preserveOriginalSize ? baseFontSize : fittedFontSize;
    const textWidth = font.widthOfTextAtSize(newText, fontSize);
    const textHeight = font.heightAtSize(fontSize, { descender: true });
    const ascentHeight = font.heightAtSize(fontSize, { descender: false });
    const descenderHeight = Math.max(textHeight - ascentHeight, 0);
    const verticalInset = Math.max((availableHeight - textHeight) / 2, 0);
    const baselineY = bottom + verticalInset + descenderHeight + tuning.yOffset;
    const rotation = degrees(span.angle || 0);
    const boxPadding = Math.max(1.5, fontSize * 0.18);
    const maskWidth = Math.max(maxX - minX, textWidth) + boxPadding * 2;
    const maskHeight = Math.max(availableHeight, textHeight) + boxPadding * 2;

    page.drawRectangle({
      x: minX - boxPadding,
      y: bottom - boxPadding,
      width: maskWidth,
      height: maskHeight,
      color: rgb(1, 1, 1),
      rotate: rotation,
      borderWidth: 0
    });

    page.drawText(newText, {
      x: span.x,
      y: baselineY,
      size: fontSize,
      font,
      rotate: rotation,
      color: rgb(0, 0, 0)
    });

    drawInkPasses(page, newText, {
      font,
      fontSize,
      x: span.x,
      y: baselineY,
      rotation,
      inkStrength: tuning.inkStrength
    });

    if (!tuning.preserveOriginalSize && fontSize < baseFontSize * 0.98) {
      warnings.push(
        `Span ${span.id} on page ${span.pageNumber + 1}: font size was reduced from ${baseFontSize.toFixed(1)} pt to ${fontSize.toFixed(1)} pt to keep the replacement text inside the original area.`
      );
    }

    if (tuning.preserveOriginalSize && fittedFontSize < baseFontSize * 0.98) {
      warnings.push(
        `Span ${span.id} on page ${span.pageNumber + 1}: original size ${baseFontSize.toFixed(1)} pt was preserved, so the replacement may look closer to the source but can run tighter inside the original area.`
      );
    }

    if (textWidth > availableWidth * 1.05) {
      warnings.push(
        `Span ${span.id} on page ${span.pageNumber + 1}: replacement text is wider than the original area and may overlap nearby content.`
      );
    }
  }

  const outputBytes = await pdfDoc.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false
  });

  await PDFDocument.load(outputBytes, {
    ignoreEncryption: true
  });

  return {
    pdfBytes: outputBytes,
    warnings
  };
}

function resolveStandardFont(span, tuning, standardFontCache) {
  if (tuning.fontFamily !== "auto") {
    const family = tuning.fontFamily;
    const style = tuning.fontStyle;

    if (family === "Courier New") {
      if (style === "boldItalic") {
        return standardFontCache.CourierBoldOblique;
      }
      if (style === "bold") {
        return standardFontCache.CourierBold;
      }
      if (style === "italic") {
        return standardFontCache.CourierOblique;
      }
      return standardFontCache.Courier;
    }

    if (family === "Times New Roman" || family === "Cambria") {
      if (style === "boldItalic") {
        return standardFontCache.TimesBoldItalic;
      }
      if (style === "bold") {
        return standardFontCache.TimesBold;
      }
      if (style === "italic") {
        return standardFontCache.TimesItalic;
      }
      return standardFontCache.TimesRoman;
    }
  }

  return standardFontCache[chooseStandardFontKey(span, tuning)] || standardFontCache.Helvetica;
}

function chooseStandardFontKey(span, tuning) {
  const value = `${span.fontName || ""} ${span.fontFamily || ""} ${span.fontDescriptor || ""}`.toLowerCase();
  const isBold = tuning.fontStyle === "auto"
    ? value.includes("bold") || value.includes("black")
    : tuning.fontStyle === "bold" || tuning.fontStyle === "boldItalic";
  const isItalic = tuning.fontStyle === "auto"
    ? value.includes("italic") || value.includes("oblique")
    : tuning.fontStyle === "italic" || tuning.fontStyle === "boldItalic";
  const manualFamily = tuning.fontFamily;
  const isCourier = manualFamily === "Courier New" || value.includes("courier") || looksMonospaced(span);
  const isTimes = manualFamily === "Times New Roman"
    || manualFamily === "Cambria"
    || value.includes("times")
    || value.includes("georgia")
    || value.includes("cambria")
    || (value.includes("serif") && !value.includes("sans"));

  if (isCourier) {
    if (isBold && isItalic) {
      return "CourierBoldOblique";
    }
    if (isBold) {
      return "CourierBold";
    }
    if (isItalic) {
      return "CourierOblique";
    }
    return "Courier";
  }

  if (isTimes) {
    if (isBold && isItalic) {
      return "TimesBoldItalic";
    }
    if (isBold) {
      return "TimesBold";
    }
    if (isItalic) {
      return "TimesItalic";
    }
    return "TimesRoman";
  }

  if (isBold && isItalic) {
    return "HelveticaBoldOblique";
  }
  if (isBold) {
    return "HelveticaBold";
  }
  if (isItalic) {
    return "HelveticaOblique";
  }
  return "Helvetica";
}

function normalizeTuning(tuning = {}) {
  const sizeScale = Number.isFinite(Number(tuning.fontSizeScale)) ? Number(tuning.fontSizeScale) / 100 : 1;
  const yOffset = Number.isFinite(Number(tuning.yOffset)) ? Number(tuning.yOffset) : 0;

  return {
    fontFamily: tuning.fontFamily || "auto",
    fontStyle: tuning.fontStyle || "auto",
    fontSizeScale: Math.min(Math.max(sizeScale, 0.5), 1.8),
    yOffset: Math.min(Math.max(yOffset, -20), 20),
    inkStrength: Math.min(Math.max(Number(tuning.inkStrength) || 112, 80), 180),
    preserveOriginalSize: tuning.preserveOriginalSize !== false
  };
}

function drawInkPasses(page, text, options) {
  const inkStrength = options.inkStrength || 100;
  if (inkStrength <= 100 || !text) {
    return;
  }

  const spread = Math.min(Math.max(options.fontSize * ((inkStrength - 100) / 2200), 0.03), 0.18);
  const extraPasses = inkStrength >= 135
    ? [
      { x: spread, y: 0 },
      { x: -spread * 0.45, y: 0 },
      { x: 0, y: spread * 0.18 }
    ]
    : [
      { x: spread * 0.75, y: 0 }
    ];

  for (const pass of extraPasses) {
    page.drawText(text, {
      x: options.x + pass.x,
      y: options.y + pass.y,
      size: options.fontSize,
      font: options.font,
      rotate: options.rotation,
      color: rgb(0, 0, 0),
      opacity: 0.92
    });
  }
}

function fitFontSizeToRegion(font, text, preferredSize, availableWidth, availableHeight) {
  if (!text) {
    return Math.min(preferredSize, font.sizeAtHeight(Math.max(availableHeight, 1)));
  }

  const safePreferredSize = Math.max(preferredSize, 1);
  const widthAtPreferred = Math.max(font.widthOfTextAtSize(text, safePreferredSize), 0.001);
  const widthBound = safePreferredSize * (availableWidth / widthAtPreferred);
  const heightBound = font.sizeAtHeight(Math.max(availableHeight * 0.94, 1));
  const fittedSize = Math.min(safePreferredSize, widthBound, heightBound);

  return Math.max(Math.round(fittedSize * 100) / 100, 4);
}

function estimateWidth(text, fontSize) {
  return Math.max(text.length * fontSize * 0.5, fontSize);
}

function mergeAdjacentSpans(rawSpans) {
  if (!rawSpans.length) {
    return [];
  }

  const merged = [];
  let current = null;

  for (const span of rawSpans) {
    if (!current || !shouldMergeSpans(current, span)) {
      if (current) {
        merged.push(finalizeMergedSpan(current));
      }
      current = startMergedSpan(span);
      continue;
    }

    const gap = span.x - (current.x + current.width);
    current.text += needsJoinSpace(current.text, span.text, gap, current.fontSize) ? ` ${span.text}` : span.text;
    current.width = Math.max(current.width, span.x + span.width - current.x);
    current.height = Math.max(current.height, span.height);
    current.top = Math.max(current.top, span.top);
    current.bottom = Math.min(current.bottom, span.bottom);
    current.sourceRegions.push({
      x: span.x,
      width: span.width,
      top: span.top,
      bottom: span.bottom
    });
    current.hasEol = current.hasEol || span.hasEol;
  }

  if (current) {
    merged.push(finalizeMergedSpan(current));
  }

  return merged;
}

function startMergedSpan(span) {
  return {
    pageNumber: span.pageNumber,
    text: span.text,
    fontName: span.fontName,
    fontFamily: span.fontFamily,
    fontDescriptor: span.fontDescriptor,
    fontSize: span.fontSize,
    x: span.x,
    y: span.y,
    width: span.width,
    height: span.height,
    angle: span.angle || 0,
    pageWidth: span.pageWidth,
    pageHeight: span.pageHeight,
    top: span.top,
    bottom: span.bottom,
    hasEol: span.hasEol,
    direction: span.direction,
    sourceRegions: [{ x: span.x, width: span.width, top: span.top, bottom: span.bottom }]
  };
}

function finalizeMergedSpan(span) {
  return {
    ...span,
    text: span.text.trim()
  };
}

function shouldMergeSpans(left, right) {
  if (left.pageNumber !== right.pageNumber) {
    return false;
  }

  if (left.direction !== right.direction) {
    return false;
  }

  const sameLine = Math.abs(left.y - right.y) <= Math.max(2, left.fontSize * 0.35);
  if (!sameLine) {
    return false;
  }

  const similarFont = Math.abs(left.fontSize - right.fontSize) <= Math.max(0.75, left.fontSize * 0.15);
  if (!similarFont) {
    return false;
  }

  const similarAngle = Math.abs((left.angle || 0) - (right.angle || 0)) <= 1;
  if (!similarAngle) {
    return false;
  }

  if (!sameFontFamily(left, right)) {
    return false;
  }

  const gap = right.x - (left.x + left.width);
  return gap <= Math.max(24, left.fontSize * 2.6);
}

function needsJoinSpace(leftText, rightText, gap, fontSize) {
  if (!leftText || !rightText) {
    return false;
  }

  if (/\s$/.test(leftText) || /^\s/.test(rightText)) {
    return false;
  }

  return gap > Math.max(1.5, fontSize * 0.2);
}

function sameFontFamily(left, right) {
  const leftFamily = normalizeFontFamily(left.fontFamily || left.fontDescriptor || left.fontName);
  const rightFamily = normalizeFontFamily(right.fontFamily || right.fontDescriptor || right.fontName);
  return leftFamily === rightFamily;
}

function normalizeFontFamily(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/bold|italic|oblique|regular|mt|psmt/g, "");
}

function looksMonospaced(span) {
  if (!span?.text || !span?.width || !span?.fontSize) {
    return false;
  }

  const compactText = span.text.replace(/\s+/g, "");
  if (compactText.length < 4) {
    return false;
  }

  const averageCharWidth = span.width / Math.max(span.text.length, 1);
  return averageCharWidth >= span.fontSize * 0.45 && averageCharWidth <= span.fontSize * 0.72;
}

function normalizeAngle(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const rounded = Math.round(value * 1000) / 1000;
  if (Math.abs(rounded) < 0.001) {
    return 0;
  }

  return rounded;
}