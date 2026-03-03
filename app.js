(function () {
  const partInput = document.getElementById("partInput");
  const jobInput = document.getElementById("jobInput");
  const descriptionInput = document.getElementById("descriptionInput");
  const focusPartBtn = document.getElementById("focusPartBtn");
  const focusJobBtn = document.getElementById("focusJobBtn");
  const topColorInputs = document.querySelectorAll('input[name="topColor"]');
  const previewCanvas = document.getElementById("previewCanvas");
  const previewFrame = document.querySelector(".preview-frame");
  const pdfBtn = document.getElementById("pdfBtn");
  const printBtn = document.getElementById("printBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");

  const A4_LANDSCAPE_PT = { width: 841.89, height: 595.28 };
  const FIXED_BLEED_MM = 10;
  const DEFAULT_COLOR = "#DCEBFF";
  const TITLE_SIZE = 42;
  const JOB_MAX_SIZE = 200;
  const PART_WRAP_THRESHOLD = 22;
  const DESCRIPTION_WRAP_THRESHOLD = 28;

  partInput.addEventListener("input", renderPreview);
  partInput.addEventListener("keydown", handlePartEnter);
  jobInput.addEventListener("input", renderPreview);
  descriptionInput.addEventListener("input", renderPreview);
  topColorInputs.forEach((input) => input.addEventListener("change", renderPreview));
  focusPartBtn.addEventListener("click", () => focusField(partInput));
  focusJobBtn.addEventListener("click", () => focusField(jobInput));
  pdfBtn.addEventListener("click", downloadPdf);
  printBtn.addEventListener("click", () => {
    void printPdf();
  });
  clearBtn.addEventListener("click", clearForm);
  window.addEventListener("resize", renderPreview);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(renderPreview, 120);
  });
  if (window.ResizeObserver && previewFrame) {
    const resizeObserver = new ResizeObserver(() => renderPreview());
    resizeObserver.observe(previewFrame);
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function focusField(input) {
    input.focus();
    input.select();
  }

  function handlePartEnter(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      focusField(jobInput);
    }
  }

  function normalizeValue(value) {
    return (value || "").trim().toUpperCase();
  }

  function parseTopColor() {
    const allowed = new Set(["#DCEBFF", "#D9FBE7", "#FFF1D6", "#FFE1E6", "#E5E7EB"]);
    const selected = document.querySelector('input[name="topColor"]:checked');
    const value = selected && selected.value ? selected.value.toUpperCase() : "";
    if (allowed.has(value)) {
      return value;
    }
    return DEFAULT_COLOR;
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

  function mmToPt(mm) {
    return (mm * 72) / 25.4;
  }

  function textHeight(size) {
    return size * 1.15;
  }

  function blockHeight(lines, size, lineGap) {
    return (textHeight(size) * lines.length) + (lineGap * Math.max(0, lines.length - 1));
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
  }

  function drawLinesFromBottom(doc, lines, x, bottomY, size, lineGap) {
    const topY = bottomY - blockHeight(lines, size, lineGap);
    drawLinesFromTop(doc, lines, x, topY, size, lineGap);
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

  function drawCanvasLinesFromBottom(ctx, lines, x, bottomY, size, lineGap, mapX, mapY, scale) {
    const topY = bottomY - blockHeight(lines, size, lineGap);
    drawCanvasLinesFromTop(ctx, lines, x, topY, size, lineGap, mapX, mapY, scale);
  }

  function getLayout(pageWidth, pageHeight) {
    const bleedPt = mmToPt(FIXED_BLEED_MM);
    const contentX = bleedPt;
    const contentY = bleedPt;
    const contentWidth = Math.max(100, pageWidth - (bleedPt * 2));
    const contentHeight = Math.max(100, pageHeight - (bleedPt * 2));
    const topSectionHeight = contentHeight / 2;
    const dividerY = contentY + topSectionHeight;
    const marginX = Math.max(24, contentWidth * 0.03);
    const sectionTop = 18;
    const sectionBottom = 18;
    const titleGap = 12;
    const usableWidth = contentWidth - (marginX * 2);
    const valueMaxHeight =
      topSectionHeight - sectionTop - sectionBottom - textHeight(TITLE_SIZE) - titleGap;

    return {
      contentX,
      contentY,
      contentWidth,
      contentHeight,
      topSectionHeight,
      dividerY,
      marginX,
      sectionTop,
      sectionBottom,
      titleGap,
      usableWidth,
      valueMaxHeight
    };
  }

  function getBottomSectionSpec(layout, hasDescription) {
    const partTitleY = layout.dividerY + layout.sectionTop;
    const partValueTop = partTitleY + textHeight(TITLE_SIZE) + layout.titleGap;
    if (!hasDescription) {
      return {
        partTitleY,
        partValueTop,
        partValueMaxHeight: layout.valueMaxHeight,
        descriptionBottomY: null,
        descriptionMaxHeight: 0
      };
    }

    const sectionBottomY = layout.contentY + layout.contentHeight - layout.sectionBottom;
    const descriptionMaxHeight = Math.min(64, layout.topSectionHeight * 0.24);
    const descriptionGap = 16;
    const partValueMaxHeight = Math.max(
      56,
      (sectionBottomY - descriptionMaxHeight - descriptionGap) - partValueTop
    );

    return {
      partTitleY,
      partValueTop,
      partValueMaxHeight,
      descriptionBottomY: sectionBottomY,
      descriptionMaxHeight
    };
  }

  function getFieldValues(usePlaceholders) {
    const jobNumber = normalizeValue(jobInput.value);
    const partNumber = normalizeValue(partInput.value);
    const description = normalizeValue(descriptionInput.value);
    if (usePlaceholders) {
      return {
        jobNumber: jobNumber || "M22849G",
        partNumber: partNumber || "ABCD1234EFGH5678IJKL9012MNOP3456QRST7890",
        description
      };
    }
    return { jobNumber, partNumber, description };
  }

  function getValidatedFields() {
    const values = getFieldValues(false);
    if (!values.partNumber || !values.jobNumber) {
      setStatus("Part Number and Job Number are required.");
      return null;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      setStatus("PDF library failed to load. Refresh and try again.");
      return null;
    }
    return { ...values, topColor: parseTopColor() };
  }

  function buildPdfDocument(values) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "a4"
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const layout = getLayout(pageWidth, pageHeight);

    const topRgb = hexToRgb(values.topColor);
    doc.setFillColor(topRgb.r, topRgb.g, topRgb.b);
    doc.rect(layout.contentX, layout.contentY, layout.contentWidth, layout.topSectionHeight, "F");

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(3);
    doc.line(layout.contentX, layout.dividerY, layout.contentX + layout.contentWidth, layout.dividerY);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);

    const topX = layout.contentX + layout.marginX;
    const topY = layout.contentY + layout.sectionTop;
    doc.setFontSize(TITLE_SIZE);
    doc.text("JOB NUMBER", topX, topY, { baseline: "top" });

    const topValueBlock = fitBlock(doc, values.jobNumber, layout.usableWidth, layout.valueMaxHeight, {
      maxSize: JOB_MAX_SIZE,
      minSize: 14,
      maxLines: 1,
      preferWrapped: false
    });
    drawLinesFromTop(
      doc,
      topValueBlock.lines,
      topX,
      topY + textHeight(TITLE_SIZE) + layout.titleGap,
      topValueBlock.size,
      topValueBlock.lineGap
    );

    const bottomX = layout.contentX + layout.marginX;
    const bottomSpec = getBottomSectionSpec(layout, Boolean(values.description));
    doc.setFontSize(TITLE_SIZE);
    doc.text("PART NUMBER", bottomX, bottomSpec.partTitleY, { baseline: "top" });

    const preferWrapped = values.partNumber.length >= PART_WRAP_THRESHOLD;
    const partValueBlock = fitBlock(doc, values.partNumber, layout.usableWidth, bottomSpec.partValueMaxHeight, {
      maxSize: 220,
      minSize: 16,
      maxLines: 2,
      preferWrapped
    });
    drawLinesFromTop(
      doc,
      partValueBlock.lines,
      bottomX,
      bottomSpec.partValueTop,
      partValueBlock.size,
      partValueBlock.lineGap
    );

    if (values.description) {
      const descriptionBlock = fitBlock(
        doc,
        values.description,
        layout.usableWidth,
        bottomSpec.descriptionMaxHeight,
        {
          maxSize: 34,
          minSize: 16,
          maxLines: 2,
          preferWrapped: values.description.length >= DESCRIPTION_WRAP_THRESHOLD
        }
      );
      drawLinesFromBottom(
        doc,
        descriptionBlock.lines,
        bottomX,
        bottomSpec.descriptionBottomY,
        descriptionBlock.size,
        descriptionBlock.lineGap
      );
    }

    return doc;
  }

  function buildOutputFileName(jobNumber) {
    const safe = normalizeValue(jobNumber).replace(/[^A-Z0-9_-]/g, "");
    return `inventory_label_${safe || "output"}.pdf`;
  }

  function renderPreview() {
    const ctx = previewCanvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const frameWidth = previewFrame ? previewFrame.getBoundingClientRect().width : 0;
    const cssWidth = Math.max(1, Math.floor(frameWidth || previewCanvas.clientWidth || 780));
    if (cssWidth < 40) {
      window.requestAnimationFrame(renderPreview);
      return;
    }
    const cssHeight = Math.round(cssWidth * (A4_LANDSCAPE_PT.height / A4_LANDSCAPE_PT.width));
    previewCanvas.style.height = `${cssHeight}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const targetHeight = Math.max(1, Math.floor(cssHeight * dpr));
    if (previewCanvas.width !== targetWidth || previewCanvas.height !== targetHeight) {
      previewCanvas.width = targetWidth;
      previewCanvas.height = targetHeight;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const scale = Math.min(cssWidth / A4_LANDSCAPE_PT.width, cssHeight / A4_LANDSCAPE_PT.height);
    const offsetX = (cssWidth - (A4_LANDSCAPE_PT.width * scale)) / 2;
    const offsetY = (cssHeight - (A4_LANDSCAPE_PT.height * scale)) / 2;
    const mapX = (x) => offsetX + (x * scale);
    const mapY = (y) => offsetY + (y * scale);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(offsetX, offsetY, A4_LANDSCAPE_PT.width * scale, A4_LANDSCAPE_PT.height * scale);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, (A4_LANDSCAPE_PT.width * scale) - 1, (A4_LANDSCAPE_PT.height * scale) - 1);

    const values = getFieldValues(true);
    const layout = getLayout(A4_LANDSCAPE_PT.width, A4_LANDSCAPE_PT.height);
    const topColor = parseTopColor();

    ctx.fillStyle = topColor;
    ctx.fillRect(
      mapX(layout.contentX),
      mapY(layout.contentY),
      layout.contentWidth * scale,
      layout.topSectionHeight * scale
    );

    ctx.strokeStyle = "#111827";
    ctx.lineWidth = Math.max(1, 3 * scale);
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

    const topX = layout.contentX + layout.marginX;
    const topY = layout.contentY + layout.sectionTop;
    setCanvasFont(ctx, TITLE_SIZE, scale);
    ctx.textBaseline = "top";
    ctx.fillText("JOB NUMBER", mapX(topX), mapY(topY));

    const topValueBlock = fitBlock(measureApi, values.jobNumber, layout.usableWidth, layout.valueMaxHeight, {
      maxSize: JOB_MAX_SIZE,
      minSize: 14,
      maxLines: 1,
      preferWrapped: false
    });
    drawCanvasLinesFromTop(
      ctx,
      topValueBlock.lines,
      topX,
      topY + textHeight(TITLE_SIZE) + layout.titleGap,
      topValueBlock.size,
      topValueBlock.lineGap,
      mapX,
      mapY,
      scale
    );

    const bottomX = layout.contentX + layout.marginX;
    const bottomSpec = getBottomSectionSpec(layout, Boolean(values.description));
    setCanvasFont(ctx, TITLE_SIZE, scale);
    ctx.fillText("PART NUMBER", mapX(bottomX), mapY(bottomSpec.partTitleY));

    const preferWrapped = values.partNumber.length >= PART_WRAP_THRESHOLD;
    const partValueBlock = fitBlock(
      measureApi,
      values.partNumber,
      layout.usableWidth,
      bottomSpec.partValueMaxHeight,
      {
      maxSize: 220,
      minSize: 16,
      maxLines: 2,
      preferWrapped
      }
    );
    drawCanvasLinesFromTop(
      ctx,
      partValueBlock.lines,
      bottomX,
      bottomSpec.partValueTop,
      partValueBlock.size,
      partValueBlock.lineGap,
      mapX,
      mapY,
      scale
    );

    if (values.description) {
      const descriptionBlock = fitBlock(
        measureApi,
        values.description,
        layout.usableWidth,
        bottomSpec.descriptionMaxHeight,
        {
          maxSize: 34,
          minSize: 16,
          maxLines: 2,
          preferWrapped: values.description.length >= DESCRIPTION_WRAP_THRESHOLD
        }
      );
      drawCanvasLinesFromBottom(
        ctx,
        descriptionBlock.lines,
        bottomX,
        bottomSpec.descriptionBottomY,
        descriptionBlock.size,
        descriptionBlock.lineGap,
        mapX,
        mapY,
        scale
      );
    }
  }

  function downloadPdf() {
    const values = getValidatedFields();
    if (!values) {
      return;
    }
    const doc = buildPdfDocument(values);
    const fileName = buildOutputFileName(values.jobNumber);
    doc.save(fileName);
    setStatus("PDF downloaded.");
  }

  async function printPdf() {
    const values = getValidatedFields();
    if (!values) {
      return;
    }
    const fileName = buildOutputFileName(values.jobNumber);
    const printWindow = window.open("", "_blank");
    const doc = buildPdfDocument(values);
    if (typeof doc.autoPrint === "function") {
      doc.autoPrint();
    }

    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);

    if (printWindow) {
      printWindow.location.href = blobUrl;
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      setStatus("Print preview opened.");
      return;
    }

    URL.revokeObjectURL(blobUrl);
    doc.save(fileName);
    setStatus("Print preview blocked. PDF downloaded instead.");
  }

  function clearForm() {
    partInput.value = "";
    jobInput.value = "";
    descriptionInput.value = "";
    const defaultSwatch = document.querySelector(`input[name="topColor"][value="${DEFAULT_COLOR}"]`);
    if (defaultSwatch) {
      defaultSwatch.checked = true;
    }
    renderPreview();
    setStatus("Cleared.");
    focusField(partInput);
  }

  renderPreview();
  focusField(partInput);
})();
