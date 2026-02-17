(function () {
  const imageInput = document.getElementById("imageInput");
  const releaseInput = document.getElementById("releaseInput");
  const partInput = document.getElementById("partInput");
  const topColorInputs = document.querySelectorAll('input[name="topColor"]');
  const previewCanvas = document.getElementById("previewCanvas");
  const scanBtn = document.getElementById("scanBtn");
  const pdfBtn = document.getElementById("pdfBtn");
  const printBtn = document.getElementById("printBtn");
  const clearBtn = document.getElementById("clearBtn");
  const scanStatus = document.getElementById("scanStatus");

  const PART_RE = /PART\s*NUMBER\s*[:#]?\s*([A-Z0-9_\/-]+)/i;
  const RELEASE_RE = /RELEASE\s*[:#]?\s*([A-Z0-9_\/-]+)/i;
  const JOB_RE = /JOB\s*NUMBER\s*[:#]?\s*([A-Z0-9_\/-]+)/i;
  const LETTER_LANDSCAPE_PT = { width: 792, height: 612 };
  const FIXED_BLEED_MM = 6.35;
  const PART_WRAP_THRESHOLD = 18;

  scanBtn.addEventListener("click", scanImage);
  pdfBtn.addEventListener("click", downloadPdf);
  printBtn.addEventListener("click", printPdf);
  clearBtn.addEventListener("click", clearForm);
  releaseInput.addEventListener("input", renderPreview);
  partInput.addEventListener("input", renderPreview);
  topColorInputs.forEach((input) => {
    input.addEventListener("change", renderPreview);
  });
  window.addEventListener("resize", renderPreview);

  function setStatus(message) {
    scanStatus.textContent = message;
  }

  function normalizeValue(value) {
    return value.trim().toUpperCase();
  }

  async function scanImage() {
    const file = imageInput.files && imageInput.files[0];
    if (!file) {
      setStatus("Select an image first.");
      return;
    }
    if (!window.Tesseract) {
      setStatus("OCR library failed to load. Refresh and try again.");
      return;
    }

    try {
      scanBtn.disabled = true;
      setStatus("Scanning image...");

      const result = await window.Tesseract.recognize(file, "eng", {
        logger: (msg) => {
          if (msg.status === "recognizing text" && typeof msg.progress === "number") {
            setStatus(`Scanning: ${Math.round(msg.progress * 100)}%`);
          }
        }
      });

      const text = result.data && result.data.text ? result.data.text : "";
      const fields = extractFields(text);
      if (!fields.partNumber || !fields.release) {
        setStatus("Could not find both Release and Part Number. Enter manually.");
        return;
      }

      releaseInput.value = fields.release;
      partInput.value = fields.partNumber;
      renderPreview();
      setStatus("Fields detected. Check preview, then download or print.");
    } catch (err) {
      setStatus(`OCR failed: ${err.message || "Unknown error"}`);
    } finally {
      scanBtn.disabled = false;
    }
  }

  function extractFields(rawText) {
    const normalized = rawText.replace(/\s+/g, " ").toUpperCase();
    const partMatch = normalized.match(PART_RE);
    const releaseMatch = normalized.match(RELEASE_RE) || normalized.match(JOB_RE);
    return {
      partNumber: partMatch ? partMatch[1].trim() : "",
      release: releaseMatch ? releaseMatch[1].trim() : ""
    };
  }

  function splitIntoTwoLines(text) {
    const separators = [];
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === "-" || char === "_" || char === "/" || char === " ") {
        separators.push(i);
      }
    }

    if (separators.length === 0) {
      const mid = Math.floor(text.length / 2);
      return [text.slice(0, mid).trim(), text.slice(mid).trim()];
    }

    let bestLeft = text;
    let bestRight = "";
    let bestScore = Number.MAX_SAFE_INTEGER;
    separators.forEach((idx) => {
      const left = text.slice(0, idx + 1).trim();
      const right = text.slice(idx + 1).trim();
      if (!left || !right) {
        return;
      }
      const score = Math.abs(left.length - right.length);
      if (score < bestScore) {
        bestScore = score;
        bestLeft = left;
        bestRight = right;
      }
    });

    if (bestRight) {
      return [bestLeft, bestRight];
    }
    const mid = Math.floor(text.length / 2);
    return [text.slice(0, mid).trim(), text.slice(mid).trim()];
  }

  function splitLines(text, count) {
    if (count <= 1 || text.length < 2) {
      return [text];
    }
    if (count === 2) {
      return splitIntoTwoLines(text);
    }
    const chunkSize = Math.max(1, Math.floor(text.length / count));
    const lines = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      lines.push(text.slice(i, i + chunkSize));
    }
    if (lines.length > count) {
      const head = lines.slice(0, count - 1);
      const tail = lines.slice(count - 1).join("");
      return head.concat(tail);
    }
    return lines;
  }

  function textHeight(size) {
    return size * 1.15;
  }

  function fitBlock(measureApi, text, maxWidth, maxHeight, opts) {
    const settings = {
      minSize: 12,
      maxSize: 220,
      maxLines: 2,
      preferWrapped: false,
      ...opts
    };
    const lineCounts = [];
    for (let i = 1; i <= settings.maxLines; i += 1) {
      lineCounts.push(i);
    }
    if (settings.preferWrapped && settings.maxLines > 1) {
      lineCounts.reverse();
    }

    for (let lcIndex = 0; lcIndex < lineCounts.length; lcIndex += 1) {
      const lineCount = lineCounts[lcIndex];
      const lines = splitLines(text, lineCount);
      for (let size = settings.maxSize; size >= settings.minSize; size -= 1) {
        measureApi.setFontSize(size);
        const lineGap = lines.length > 1 ? Math.max(4, size * 0.18) : 0;
        const blockHeight = (textHeight(size) * lines.length) + (lineGap * (lines.length - 1));
        let widest = 0;
        for (let i = 0; i < lines.length; i += 1) {
          const lineWidth = measureApi.getTextWidth(lines[i]);
          if (lineWidth > widest) {
            widest = lineWidth;
          }
        }
        if (widest <= maxWidth && blockHeight <= maxHeight) {
          return { lines, size, lineGap };
        }
      }
    }

    const fallbackLines = splitLines(text, settings.maxLines);
    return { lines: fallbackLines, size: settings.minSize, lineGap: Math.max(4, settings.minSize * 0.18) };
  }

  function drawLinesFromTop(doc, lines, x, topY, size, lineGap) {
    let y = topY;
    doc.setFontSize(size);
    for (let i = 0; i < lines.length; i += 1) {
      doc.text(lines[i], x, y, { baseline: "top" });
      y += textHeight(size);
      if (i < lines.length - 1) {
        y += lineGap;
      }
    }
    return y;
  }

  function mmToPt(mm) {
    return (mm * 72) / 25.4;
  }

  function parseTopColor() {
    const allowed = new Set(["#DCEBFF", "#D9FBE7", "#FFF1D6", "#FFE1E6", "#E5E7EB"]);
    const selected = document.querySelector('input[name="topColor"]:checked');
    const value = selected && selected.value ? selected.value.toUpperCase() : "";
    if (allowed.has(value)) {
      return value;
    }
    return "#DCEBFF";
  }

  function hexToRgb(hex) {
    const raw = (hex || "").replace("#", "");
    if (raw.length !== 6) {
      return { r: 220, g: 235, b: 255 };
    }
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16)
    };
  }

  function getLayout(pageWidth, pageHeight) {
    const bleedPt = mmToPt(FIXED_BLEED_MM);
    const contentX = bleedPt;
    const contentY = bleedPt;
    const contentWidth = Math.max(100, pageWidth - (bleedPt * 2));
    const contentHeight = Math.max(100, pageHeight - (bleedPt * 2));
    const topRatio = 0.35;
    const topSectionHeight = contentHeight * topRatio;
    const bottomSectionHeight = contentHeight - topSectionHeight;
    const dividerY = contentY + topSectionHeight;
    const marginX = Math.max(24, contentWidth * 0.03);
    const sectionTop = 16;
    const sectionBottom = 16;
    const titleGap = 8;
    const releaseTitleSize = 21;
    const partTitleSize = 42;
    const usableWidth = contentWidth - (marginX * 2);
    const releaseValueMaxHeight =
      topSectionHeight - sectionTop - sectionBottom - textHeight(releaseTitleSize) - titleGap;
    const partValueMaxHeight =
      bottomSectionHeight - sectionTop - sectionBottom - textHeight(partTitleSize) - titleGap;

    return {
      contentX,
      contentY,
      contentWidth,
      topSectionHeight,
      dividerY,
      marginX,
      sectionTop,
      titleGap,
      releaseTitleSize,
      partTitleSize,
      usableWidth,
      releaseValueMaxHeight,
      partValueMaxHeight
    };
  }

  function getFieldValuesForLayout(usePlaceholders) {
    const release = normalizeValue(releaseInput.value);
    const partNumber = normalizeValue(partInput.value);
    if (usePlaceholders) {
      return {
        release: release || "M22849G",
        partNumber: partNumber || "ABCD1234EFGH5678IJKL9012MNOP3456QRST7890"
      };
    }
    return { release, partNumber };
  }

  function buildPdfDocument(release, partNumber, topColorHex) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "letter"
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const layout = getLayout(pageWidth, pageHeight);

    const topRgb = hexToRgb(topColorHex);
    doc.setFillColor(topRgb.r, topRgb.g, topRgb.b);
    doc.rect(layout.contentX, layout.contentY, layout.contentWidth, layout.topSectionHeight, "F");

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(2.5);
    doc.line(layout.contentX, layout.dividerY, layout.contentX + layout.contentWidth, layout.dividerY);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);

    const releaseX = layout.contentX + layout.marginX;
    const releaseTop = layout.contentY + layout.sectionTop;
    doc.setFontSize(layout.releaseTitleSize);
    doc.text("RELEASE", releaseX, releaseTop, { baseline: "top" });
    const releaseBlock = fitBlock(doc, release, layout.usableWidth, layout.releaseValueMaxHeight, {
      maxSize: 105,
      minSize: 14,
      maxLines: 1,
      preferWrapped: false
    });
    drawLinesFromTop(
      doc,
      releaseBlock.lines,
      releaseX,
      releaseTop + textHeight(layout.releaseTitleSize) + layout.titleGap,
      releaseBlock.size,
      releaseBlock.lineGap
    );

    const bottomX = layout.contentX + layout.marginX;
    const bottomTop = layout.dividerY + layout.sectionTop;
    doc.setFontSize(layout.partTitleSize);
    doc.text("PART NUMBER", bottomX, bottomTop, { baseline: "top" });

    const preferWrapped = partNumber.length >= PART_WRAP_THRESHOLD;
    const partBlock = fitBlock(doc, partNumber, layout.usableWidth, layout.partValueMaxHeight, {
      maxSize: 280,
      minSize: 20,
      maxLines: 2,
      preferWrapped
    });
    drawLinesFromTop(
      doc,
      partBlock.lines,
      bottomX,
      bottomTop + textHeight(layout.partTitleSize) + layout.titleGap,
      partBlock.size,
      partBlock.lineGap
    );

    return doc;
  }

  function setCanvasFont(ctx, sizePt, scale) {
    const px = Math.max(1, sizePt * scale);
    ctx.font = `700 ${px}px Arial, sans-serif`;
  }

  function drawCanvasLinesFromTop(ctx, lines, x, topY, size, lineGap, mapX, mapY, scale) {
    let y = topY;
    setCanvasFont(ctx, size, scale);
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], mapX(x), mapY(y));
      y += textHeight(size);
      if (i < lines.length - 1) {
        y += lineGap;
      }
    }
  }

  function renderPreview() {
    if (!previewCanvas) {
      return;
    }

    const ctx = previewCanvas.getContext("2d");
    const cssWidth = previewCanvas.clientWidth || 780;
    const cssHeight = previewCanvas.clientHeight || Math.round(cssWidth * (8.5 / 11));
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const targetHeight = Math.max(1, Math.floor(cssHeight * dpr));
    if (previewCanvas.width !== targetWidth || previewCanvas.height !== targetHeight) {
      previewCanvas.width = targetWidth;
      previewCanvas.height = targetHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const scale = Math.min(cssWidth / LETTER_LANDSCAPE_PT.width, cssHeight / LETTER_LANDSCAPE_PT.height);
    const offsetX = (cssWidth - (LETTER_LANDSCAPE_PT.width * scale)) / 2;
    const offsetY = (cssHeight - (LETTER_LANDSCAPE_PT.height * scale)) / 2;
    const mapX = (x) => offsetX + (x * scale);
    const mapY = (y) => offsetY + (y * scale);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(offsetX, offsetY, LETTER_LANDSCAPE_PT.width * scale, LETTER_LANDSCAPE_PT.height * scale);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      offsetX + 0.5,
      offsetY + 0.5,
      (LETTER_LANDSCAPE_PT.width * scale) - 1,
      (LETTER_LANDSCAPE_PT.height * scale) - 1
    );

    const topColor = parseTopColor();
    const layout = getLayout(LETTER_LANDSCAPE_PT.width, LETTER_LANDSCAPE_PT.height);
    const values = getFieldValuesForLayout(true);

    ctx.fillStyle = topColor;
    ctx.fillRect(
      mapX(layout.contentX),
      mapY(layout.contentY),
      layout.contentWidth * scale,
      layout.topSectionHeight * scale
    );

    ctx.strokeStyle = "#111827";
    ctx.lineWidth = Math.max(1, 2.5 * scale);
    ctx.beginPath();
    ctx.moveTo(mapX(layout.contentX), mapY(layout.dividerY));
    ctx.lineTo(mapX(layout.contentX + layout.contentWidth), mapY(layout.dividerY));
    ctx.stroke();

    const measureApi = {
      setFontSize(size) {
        setCanvasFont(ctx, size, scale);
      },
      getTextWidth(text) {
        return ctx.measureText(text).width / scale;
      }
    };

    ctx.fillStyle = "#000000";

    const releaseX = layout.contentX + layout.marginX;
    const releaseTop = layout.contentY + layout.sectionTop;
    setCanvasFont(ctx, layout.releaseTitleSize, scale);
    ctx.textBaseline = "top";
    ctx.fillText("RELEASE", mapX(releaseX), mapY(releaseTop));
    const releaseBlock = fitBlock(measureApi, values.release, layout.usableWidth, layout.releaseValueMaxHeight, {
      maxSize: 105,
      minSize: 14,
      maxLines: 1,
      preferWrapped: false
    });
    drawCanvasLinesFromTop(
      ctx,
      releaseBlock.lines,
      releaseX,
      releaseTop + textHeight(layout.releaseTitleSize) + layout.titleGap,
      releaseBlock.size,
      releaseBlock.lineGap,
      mapX,
      mapY,
      scale
    );

    const bottomX = layout.contentX + layout.marginX;
    const bottomTop = layout.dividerY + layout.sectionTop;
    setCanvasFont(ctx, layout.partTitleSize, scale);
    ctx.fillText("PART NUMBER", mapX(bottomX), mapY(bottomTop));
    const preferWrapped = values.partNumber.length >= PART_WRAP_THRESHOLD;
    const partBlock = fitBlock(measureApi, values.partNumber, layout.usableWidth, layout.partValueMaxHeight, {
      maxSize: 280,
      minSize: 20,
      maxLines: 2,
      preferWrapped
    });
    drawCanvasLinesFromTop(
      ctx,
      partBlock.lines,
      bottomX,
      bottomTop + textHeight(layout.partTitleSize) + layout.titleGap,
      partBlock.size,
      partBlock.lineGap,
      mapX,
      mapY,
      scale
    );
  }

  function getValidatedFields() {
    const values = getFieldValuesForLayout(false);
    if (!values.release || !values.partNumber) {
      setStatus("Release and Part Number are required.");
      return null;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      setStatus("PDF library failed to load. Refresh and try again.");
      return null;
    }
    const topColor = parseTopColor();
    return { ...values, topColor };
  }

  function downloadPdf() {
    const fields = getValidatedFields();
    if (!fields) {
      return;
    }
    const doc = buildPdfDocument(fields.release, fields.partNumber, fields.topColor);
    const safeRelease = fields.release.replace(/[^A-Z0-9_-]/g, "");
    const fileName = `inventory_label_${safeRelease || "output"}.pdf`;
    doc.save(fileName);
    setStatus("PDF downloaded (Letter landscape, fixed bleed).");
  }

  function printPdf() {
    const fields = getValidatedFields();
    if (!fields) {
      return;
    }
    const doc = buildPdfDocument(fields.release, fields.partNumber, fields.topColor);
    if (typeof doc.autoPrint === "function") {
      doc.autoPrint();
    }
    const blobUrl = doc.output("bloburl");
    const printWindow = window.open(blobUrl, "_blank");
    if (!printWindow) {
      setStatus("Pop-up blocked. Allow pop-ups to open print preview.");
      return;
    }
    setStatus("Print preview opened (Letter landscape, fixed bleed).");
  }

  function clearForm() {
    imageInput.value = "";
    releaseInput.value = "";
    partInput.value = "";
    const defaultSwatch = document.querySelector('input[name="topColor"][value="#DCEBFF"]');
    if (defaultSwatch) {
      defaultSwatch.checked = true;
    }
    renderPreview();
    setStatus("Cleared.");
  }

  renderPreview();
})();
