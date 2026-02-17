(function () {
  const imageInput = document.getElementById("imageInput");
  const releaseInput = document.getElementById("releaseInput");
  const partInput = document.getElementById("partInput");
  const scanBtn = document.getElementById("scanBtn");
  const pdfBtn = document.getElementById("pdfBtn");
  const clearBtn = document.getElementById("clearBtn");
  const scanStatus = document.getElementById("scanStatus");

  const PART_RE = /PART\s*NUMBER\s*[:#]?\s*([A-Z0-9_\/-]+)/i;
  const RELEASE_RE = /RELEASE\s*[:#]?\s*([A-Z0-9_\/-]+)/i;
  const JOB_RE = /JOB\s*NUMBER\s*[:#]?\s*([A-Z0-9_\/-]+)/i;

  scanBtn.addEventListener("click", scanImage);
  pdfBtn.addEventListener("click", generatePdf);
  clearBtn.addEventListener("click", clearForm);

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
      setStatus("Fields detected. Check values, then download PDF.");
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

  function fitBlock(doc, text, maxWidth, maxHeight, opts) {
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
        doc.setFontSize(size);
        const lineGap = lines.length > 1 ? Math.max(4, size * 0.18) : 0;
        const blockHeight = (textHeight(size) * lines.length) + (lineGap * (lines.length - 1));
        let widest = 0;
        for (let i = 0; i < lines.length; i += 1) {
          const lineWidth = doc.getTextWidth(lines[i]);
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

  function generatePdf() {
    const release = normalizeValue(releaseInput.value);
    const partNumber = normalizeValue(partInput.value);
    if (!release || !partNumber) {
      setStatus("Release and Part Number are required.");
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      setStatus("PDF library failed to load. Refresh and try again.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "a4"
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const half = pageHeight / 2;

    doc.setFillColor(220, 235, 255);
    doc.rect(0, 0, pageWidth, half, "F");

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(3);
    doc.line(0, half, pageWidth, half);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);

    const marginX = 30;
    const sectionTop = 18;
    const sectionBottom = 20;
    const titleGap = 10;
    const titleSize = 38;
    const usableWidth = pageWidth - (marginX * 2);
    const valueMaxHeight = half - sectionTop - sectionBottom - textHeight(titleSize) - titleGap;

    doc.setFontSize(titleSize);
    doc.text("RELEASE", marginX, sectionTop, { baseline: "top" });
    const releaseBlock = fitBlock(doc, release, usableWidth, valueMaxHeight, {
      maxSize: 225,
      minSize: 30,
      maxLines: 1,
      preferWrapped: false
    });
    drawLinesFromTop(
      doc,
      releaseBlock.lines,
      marginX,
      sectionTop + textHeight(titleSize) + titleGap,
      releaseBlock.size,
      releaseBlock.lineGap
    );

    const bottomTop = half + sectionTop;
    doc.setFontSize(titleSize);
    doc.text("PART NUMBER", marginX, bottomTop, { baseline: "top" });

    const preferWrapped = partNumber.length >= 22;
    const partBlock = fitBlock(doc, partNumber, usableWidth, valueMaxHeight, {
      maxSize: 225,
      minSize: 20,
      maxLines: 2,
      preferWrapped
    });
    drawLinesFromTop(
      doc,
      partBlock.lines,
      marginX,
      bottomTop + textHeight(titleSize) + titleGap,
      partBlock.size,
      partBlock.lineGap
    );

    const safeRelease = release.replace(/[^A-Z0-9_-]/g, "");
    const fileName = `inventory_label_${safeRelease || "output"}.pdf`;
    doc.save(fileName);
    setStatus("PDF downloaded.");
  }

  function clearForm() {
    imageInput.value = "";
    releaseInput.value = "";
    partInput.value = "";
    setStatus("Cleared.");
  }
})();
