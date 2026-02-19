(function () {
  const imageInput = document.getElementById("imageInput");
  const releaseInput = document.getElementById("releaseInput");
  const partInput = document.getElementById("partInput");
  const topColorInputs = document.querySelectorAll('input[name="topColor"]');
  const previewCanvas = document.getElementById("previewCanvas");
  const previewFrame = document.querySelector(".preview-frame");
  const modeAdvancedBtn = document.getElementById("modeAdvancedBtn");
  const modeQuickBtn = document.getElementById("modeQuickBtn");
  const advancedSections = document.querySelectorAll(".advanced-only");
  const quickSections = document.querySelectorAll(".quick-only");
  const scanBtn = document.getElementById("scanBtn");
  const pdfBtn = document.getElementById("pdfBtn");
  const printBtn = document.getElementById("printBtn");
  const clearBtn = document.getElementById("clearBtn");
  const scanStatus = document.getElementById("scanStatus");
  const quickBarcodeVideo = document.getElementById("quickBarcodeVideo");
  const quickPartInput = document.getElementById("quickPartInput");
  const quickReleaseInput = document.getElementById("quickReleaseInput");
  const quickScanStatus = document.getElementById("quickScanStatus");
  const startQuickScanBtn = document.getElementById("startQuickScanBtn");
  const stopQuickScanBtn = document.getElementById("stopQuickScanBtn");
  const quickPdfBtn = document.getElementById("quickPdfBtn");
  const quickPrintBtn = document.getElementById("quickPrintBtn");
  const quickClearBtn = document.getElementById("quickClearBtn");

  const PART_RE = /PART\s*NUMBER\s*[:#]?\s*([A-Z0-9_\/-]+)/i;
  const RELEASE_RE = /RELEASE\s*[:#]?\s*([A-Z0-9_\/-]+)/i;
  const JOB_RE = /JOB\s*NUMBER\s*[:#]?\s*([A-Z0-9_\/-]+)/i;
  const A4_LANDSCAPE_PT = { width: 841.89, height: 595.28 };
  const FIXED_BLEED_MM = 10;
  const PART_WRAP_THRESHOLD = 18;
  const RELEASE_MIN_LEN = 4;
  const RELEASE_MAX_LEN = 14;
  let currentMode = "advanced";
  let quickScanStream = null;
  let quickScanTimer = null;
  let quickDetectBusy = false;
  let quickBarcodeDetector = null;
  let quickScanEngine = null;
  let quickZxingReader = null;
  let quickZxingControls = null;

  scanBtn.addEventListener("click", scanImage);
  pdfBtn.addEventListener("click", downloadPdf);
  printBtn.addEventListener("click", () => {
    void printPdf();
  });
  clearBtn.addEventListener("click", clearForm);
  modeAdvancedBtn.addEventListener("click", () => setMode("advanced"));
  modeQuickBtn.addEventListener("click", () => setMode("quick"));
  startQuickScanBtn.addEventListener("click", () => {
    void startQuickBarcodeScan();
  });
  stopQuickScanBtn.addEventListener("click", stopQuickBarcodeScan);
  quickPdfBtn.addEventListener("click", downloadQuickPdf);
  quickPrintBtn.addEventListener("click", () => {
    void printQuickPdf();
  });
  quickClearBtn.addEventListener("click", clearQuickForm);
  releaseInput.addEventListener("input", renderPreview);
  partInput.addEventListener("input", renderPreview);
  topColorInputs.forEach((input) => {
    input.addEventListener("change", renderPreview);
  });
  window.addEventListener("resize", renderPreview);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(renderPreview, 120);
  });
  if (window.ResizeObserver && previewFrame) {
    const previewResizeObserver = new ResizeObserver(() => {
      renderPreview();
    });
    previewResizeObserver.observe(previewFrame);
  }
  window.addEventListener("beforeunload", stopQuickBarcodeScan);

  function setStatus(message) {
    scanStatus.textContent = message;
  }

  function normalizeValue(value) {
    return value.trim().toUpperCase();
  }

  function setMode(mode) {
    currentMode = mode === "quick" ? "quick" : "advanced";
    const showQuick = currentMode === "quick";

    advancedSections.forEach((section) => {
      section.classList.toggle("is-hidden", showQuick);
    });
    quickSections.forEach((section) => {
      section.classList.toggle("is-hidden", !showQuick);
    });

    modeAdvancedBtn.classList.toggle("active", !showQuick);
    modeQuickBtn.classList.toggle("active", showQuick);

    if (!showQuick) {
      stopQuickBarcodeScan();
    } else {
      setQuickStatus("Camera idle");
    }
  }

  function setQuickStatus(message) {
    if (quickScanStatus) {
      quickScanStatus.textContent = message;
    }
  }

  function isNativeBarcodeAvailable() {
    return "BarcodeDetector" in window;
  }

  function isZxingAvailable() {
    return !!(window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader);
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

      const fields = { partNumber: "", release: "" };

      // 1) Barcode for part number (primary).
      const barcodePart = await detectBarcodePartNumber(file);

      // 2) OCR pass: part from first-colon region, release from last colon.
      const text = await runOcr(file, "Scanning");
      const ocrColonPart = extractPartAfterFirstColonBeforeDescription(text);
      const releaseAfterLastColon = extractReleaseAfterLastColon(text);
      fields.partNumber = barcodePart || ocrColonPart;
      fields.release = releaseAfterLastColon;

      if (!fields.partNumber || !fields.release) {
        setStatus("Trying enhanced scan...");
        const enhancedBlob = await buildEnhancedImage(file);
        if (enhancedBlob) {
          const enhancedText = await runOcr(enhancedBlob, "Enhanced scan");
          const enhancedColonPart = extractPartAfterFirstColonBeforeDescription(enhancedText);
          const enhancedLastColonRelease = extractReleaseAfterLastColon(enhancedText);

          fields.partNumber = fields.partNumber || barcodePart || enhancedColonPart;
          fields.release = fields.release || enhancedLastColonRelease;
        }
      }

      if (!fields.partNumber || !fields.release) {
        if (fields.release) {
          releaseInput.value = fields.release;
        }
        if (fields.partNumber) {
          partInput.value = fields.partNumber;
        }
        renderPreview();
        setStatus("Could not find both fields from scan. Please complete manually.");
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

  async function detectBarcodePartNumber(file) {
    if (!("BarcodeDetector" in window)) {
      return "";
    }
    try {
      const detector = await createBarcodeDetector();
      if (!detector) {
        return "";
      }

      const image = await loadImageFromFile(file);
      const sources = buildBarcodeSources(image);
      let bestValue = "";
      let bestScore = -1;

      for (let i = 0; i < sources.length; i += 1) {
        const source = sources[i];
        let barcodes = [];
        try {
          barcodes = await detector.detect(source);
        } catch (_err) {
          barcodes = [];
        }
        if (!Array.isArray(barcodes) || barcodes.length === 0) {
          continue;
        }
        const bestFromSource = pickBestBarcodeValue(barcodes);
        if (bestFromSource) {
          const score = scoreBarcodeCandidate(bestFromSource);
          if (score > bestScore) {
            bestScore = score;
            bestValue = bestFromSource;
          }
        }
      }

      return bestValue;
    } catch (_err) {
      return "";
    }
  }

  async function createBarcodeDetector() {
    if (!isNativeBarcodeAvailable()) {
      return null;
    }
    try {
      const preferredFormats = [
        "code_128",
        "code_39",
        "codabar",
        "itf",
        "ean_13",
        "ean_8",
        "upc_a",
        "upc_e"
      ];

      if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = preferredFormats.filter((f) => supported.includes(f));
        if (formats.length > 0) {
          return new window.BarcodeDetector({ formats });
        }
      }
      return new window.BarcodeDetector();
    } catch (_err) {
      return null;
    }
  }

  function createZXingReader() {
    if (!isZxingAvailable()) {
      return null;
    }
    if (quickZxingReader) {
      return quickZxingReader;
    }
    try {
      quickZxingReader = new window.ZXingBrowser.BrowserMultiFormatReader();
      return quickZxingReader;
    } catch (_err) {
      return null;
    }
  }

  async function loadImageFromFile(file) {
    let objectUrl = "";
    try {
      objectUrl = URL.createObjectURL(file);
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = objectUrl;
      });
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  function buildBarcodeSources(image) {
    const sources = [image];
    const topBands = [
      { top: 0.0, height: 0.42, left: 0.0, width: 1.0, scale: 1.0, enhance: false },
      { top: 0.0, height: 0.32, left: 0.0, width: 1.0, scale: 1.6, enhance: false },
      { top: 0.0, height: 0.26, left: 0.03, width: 0.94, scale: 2.0, enhance: false },
      { top: 0.0, height: 0.22, left: 0.02, width: 0.96, scale: 2.2, enhance: true }
    ];
    for (let i = 0; i < topBands.length; i += 1) {
      const cfg = topBands[i];
      const canvas = createBarcodeCanvas(image, cfg);
      if (canvas) {
        sources.push(canvas);
      }
    }
    return sources;
  }

  function createBarcodeCanvas(image, cfg) {
    const srcW = image.naturalWidth || image.width;
    const srcH = image.naturalHeight || image.height;
    if (!srcW || !srcH) {
      return null;
    }

    const sx = Math.max(0, Math.floor(srcW * cfg.left));
    const sy = Math.max(0, Math.floor(srcH * cfg.top));
    const sw = Math.max(1, Math.floor(srcW * cfg.width));
    const sh = Math.max(1, Math.floor(srcH * cfg.height));

    const dw = Math.max(1, Math.floor(sw * cfg.scale));
    const dh = Math.max(1, Math.floor(sh * cfg.scale));
    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return null;
    }

    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh);
    if (cfg.enhance) {
      const imageData = ctx.getImageData(0, 0, dw, dh);
      const px = imageData.data;
      for (let i = 0; i < px.length; i += 4) {
        const gray = (0.299 * px[i]) + (0.587 * px[i + 1]) + (0.114 * px[i + 2]);
        const boosted = Math.max(0, Math.min(255, ((gray - 128) * 1.9) + 128));
        px[i] = boosted;
        px[i + 1] = boosted;
        px[i + 2] = boosted;
      }
      ctx.putImageData(imageData, 0, 0);
    }
    return canvas;
  }

  function isLikelyPartToken(value) {
    const v = cleanCandidate(value, { minLen: 4, maxLen: 80 });
    if (!v) {
      return false;
    }
    if (v.includes("RELEASE") || v.includes("DESCRIPTION") || v.includes("JOB") || v.includes("NUMBER")) {
      return false;
    }
    if (!/[A-Z0-9]/.test(v)) {
      return false;
    }
    return true;
  }

  function scoreBarcodeCandidate(value) {
    let score = value.length;
    if (/[A-Z]/.test(value)) {
      score += 12;
    }
    if (/\d/.test(value)) {
      score += 8;
    }
    if (value.length >= 6 && value.length <= 24) {
      score += 10;
    }
    if (value.length > 40) {
      score -= 15;
    }
    return score;
  }

  function pickBestBarcodeValue(barcodes) {
    if (!Array.isArray(barcodes) || barcodes.length === 0) {
      return "";
    }
    let bestValue = "";
    let bestScore = -1;
    for (let j = 0; j < barcodes.length; j += 1) {
      const raw = (barcodes[j] && barcodes[j].rawValue) ? String(barcodes[j].rawValue) : "";
      const cleaned = cleanCandidate(raw, { minLen: 4, maxLen: 80 });
      if (!isLikelyPartToken(cleaned)) {
        continue;
      }
      const score = scoreBarcodeCandidate(cleaned);
      if (score > bestScore) {
        bestScore = score;
        bestValue = cleaned;
      }
    }
    return bestValue;
  }

  async function startQuickBarcodeScan() {
    if (currentMode !== "quick") {
      setMode("quick");
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setQuickStatus("Camera not supported in this browser.");
      return;
    }
    if (quickScanStream || quickZxingControls) {
      setQuickStatus("Scanning already running...");
      return;
    }

    if (!isNativeBarcodeAvailable() && !isZxingAvailable()) {
      setQuickStatus("Barcode scanning not supported on this browser.");
      return;
    }

    if (isNativeBarcodeAvailable()) {
      quickBarcodeDetector = quickBarcodeDetector || await createBarcodeDetector();
      if (!quickBarcodeDetector) {
        setQuickStatus("Could not initialize barcode detector.");
        return;
      }
    } else {
      const started = await startQuickScanWithZXing();
      if (!started) {
        setQuickStatus("Could not start fallback scanner on this browser.");
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      quickScanStream = stream;
      quickScanEngine = "native";
      quickBarcodeVideo.srcObject = stream;
      await quickBarcodeVideo.play();

      setQuickStatus("Camera live. Point barcode at center.");
      quickScanTimer = window.setInterval(() => {
        void runQuickBarcodeTick();
      }, 220);
    } catch (_err) {
      setQuickStatus("Unable to access camera. Check permissions.");
      stopQuickBarcodeScan();
    }
  }

  async function startQuickScanWithZXing() {
    const reader = createZXingReader();
    if (!reader) {
      return false;
    }
    try {
      quickScanEngine = "zxing";
      quickZxingControls = await reader.decodeFromVideoDevice(
        undefined,
        quickBarcodeVideo,
        (result) => {
          if (!result) {
            return;
          }
          const raw = typeof result.getText === "function" ? result.getText() : String(result.text || "");
          const cleaned = cleanCandidate(raw, { minLen: 4, maxLen: 80 });
          if (isLikelyPartToken(cleaned)) {
            if (quickPartInput.value !== cleaned) {
              quickPartInput.value = cleaned;
            }
            setQuickStatus(`Detected part: ${cleaned}`);
          }
        }
      );
      setQuickStatus("Camera live. Point barcode at center.");
      return true;
    } catch (_err) {
      quickScanEngine = null;
      quickZxingControls = null;
      return false;
    }
  }

  async function runQuickBarcodeTick() {
    if (quickScanEngine !== "native") {
      return;
    }
    if (!quickBarcodeDetector || !quickBarcodeVideo || quickDetectBusy) {
      return;
    }
    if (!quickScanStream || quickBarcodeVideo.readyState < 2) {
      return;
    }
    quickDetectBusy = true;
    try {
      const barcodes = await quickBarcodeDetector.detect(quickBarcodeVideo);
      const best = pickBestBarcodeValue(barcodes);
      if (best) {
        if (quickPartInput.value !== best) {
          quickPartInput.value = best;
        }
        setQuickStatus(`Detected part: ${best}`);
      }
    } catch (_err) {
      // Ignore single-frame scan errors while camera stream stabilizes.
    } finally {
      quickDetectBusy = false;
    }
  }

  function stopQuickBarcodeScan() {
    if (quickScanTimer) {
      window.clearInterval(quickScanTimer);
      quickScanTimer = null;
    }
    if (quickZxingControls && typeof quickZxingControls.stop === "function") {
      quickZxingControls.stop();
      quickZxingControls = null;
    }
    quickScanEngine = null;
    quickDetectBusy = false;
    if (quickScanStream) {
      quickScanStream.getTracks().forEach((track) => track.stop());
      quickScanStream = null;
    }
    if (quickBarcodeVideo && quickBarcodeVideo.srcObject) {
      quickBarcodeVideo.srcObject = null;
    }
    if (currentMode === "quick") {
      setQuickStatus("Camera stopped.");
    }
  }

  async function runOcr(imageSource, phaseLabel) {
    const result = await window.Tesseract.recognize(imageSource, "eng", {
      logger: (msg) => {
        if (msg.status === "recognizing text" && typeof msg.progress === "number") {
          setStatus(`${phaseLabel}: ${Math.round(msg.progress * 100)}%`);
        }
      }
    });
    return result && result.data && result.data.text ? result.data.text : "";
  }

  async function buildEnhancedImage(file) {
    let objectUrl = "";
    try {
      objectUrl = URL.createObjectURL(file);
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = objectUrl;
      });

      const maxEdge = 1800;
      const scale = Math.min(
        1,
        maxEdge / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height)
      );
      const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return null;
      }

      ctx.drawImage(image, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const gray = (0.299 * r) + (0.587 * g) + (0.114 * b);
        const contrastBoost = Math.max(0, Math.min(255, ((gray - 128) * 1.7) + 128));
        const bw = contrastBoost > 165 ? 255 : 0;
        pixels[i] = bw;
        pixels[i + 1] = bw;
        pixels[i + 2] = bw;
      }
      ctx.putImageData(imageData, 0, 0);

      return await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
    } catch (_err) {
      return null;
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  function extractPartAfterFirstColonBeforeDescription(rawText) {
    const normalized = normalizeOcrText(rawText);
    const singleLine = normalized.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    if (!singleLine) {
      return "";
    }

    // Preferred pattern: PART NUMBER:<value>
    const labelMatch = singleLine.match(/\bPART\s*NUMBER\s*:\s*([A-Z0-9][A-Z0-9_\/\-]{3,80})/);
    if (labelMatch && labelMatch[1]) {
      const labeled = cleanCandidate(labelMatch[1], { minLen: 4, maxLen: 80 });
      if (isLikelyPartToken(labeled)) {
        return labeled;
      }
    }

    const firstColon = singleLine.indexOf(":");
    if (firstColon < 0) {
      return "";
    }

    let end = singleLine.length;
    const descriptionIndex = singleLine.indexOf("DESCRIPTION", firstColon + 1);
    if (descriptionIndex > firstColon) {
      end = descriptionIndex;
    }

    const rawPart = singleLine.slice(firstColon + 1, end).trim();
    const candidate = cleanCandidate(rawPart, { minLen: 4, maxLen: 80 });
    if (!isLikelyPartToken(candidate)) {
      return "";
    }
    return candidate;
  }

  function extractReleaseAfterLastColon(rawText) {
    const normalized = normalizeOcrText(rawText);
    const directRelease = normalized.match(/\bRELEA[5S]E\s*:\s*([A-Z0-9][A-Z0-9_\/\-]{3,20})/);
    if (directRelease && directRelease[1]) {
      const direct = cleanCandidate(directRelease[1], { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN });
      if (isLikelyReleaseToken(direct)) {
        return direct;
      }
    }
    const idx = normalized.lastIndexOf(":");
    if (idx < 0 || idx >= normalized.length - 1) {
      return "";
    }
    const tail = normalized.slice(idx + 1).trim();
    const token = (tail.match(/[A-Z0-9][A-Z0-9_\/\-]{3,20}/) || [])[0] || "";
    const candidate = cleanCandidate(token, { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN });
    if (isLikelyReleaseToken(candidate)) {
      return candidate;
    }
    return "";
  }

  function extractFields(rawText) {
    const normalizedText = normalizeOcrText(rawText);
    const lines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);

    const partMatch = findBestField(lines, [
      /\bPART\s*(?:NUMBER|NUM8ER|NO|#)?\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9 _\/\-]{2,})$/,
      /\bP\/N\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9 _\/\-]{2,})$/
    ], { minLen: 4, maxLen: 80 });

    const releaseMatch = findBestField(lines, [
      /\bRELEA[5S]E\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,})$/,
      /\bREL\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,})$/,
      /\bJOB\s*NUMBER\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,})$/
    ], { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN }, {
      valueValidator: isLikelyReleaseToken,
      nextLineValidator: isLikelyReleaseToken
    });

    const flat = lines.join(" ");
    const fallbackPart = partMatch || findFromFlatText(flat, [
      /\bPART\s*(?:NUMBER|NUM8ER|NO|#)?\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9 _\/\-]{2,})/,
      /\bP\/N\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9 _\/\-]{2,})/
    ], { minLen: 4, maxLen: 80 });

    const fallbackRelease = releaseMatch || findFromFlatText(flat, [
      /\bRELEA[5S]E\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,})/,
      /\bREL\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,})/,
      /\bJOB\s*NUMBER\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,})/
    ], { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN }, {
      valueValidator: isLikelyReleaseToken
    });

    return {
      partNumber: fallbackPart || "",
      release: fallbackRelease || ""
    };
  }

  function extractReleaseFromLastLine(rawText) {
    const normalized = normalizeOcrText(rawText);
    const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      return "";
    }

    const last = lines[lines.length - 1];
    const labelMatch = last.match(/\b(?:RELEA[5S]E|REL|JOB\s*NUMBER)\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,})/);
    if (labelMatch && labelMatch[1]) {
      const value = cleanCandidate(labelMatch[1], { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN });
      if (isLikelyReleaseToken(value)) {
        return value;
      }
    }

    const afterColon = last.match(/[:#\-]\s*([A-Z0-9][A-Z0-9_\/\-]{2,})$/);
    if (afterColon && afterColon[1]) {
      const value = cleanCandidate(afterColon[1], { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN });
      if (isLikelyReleaseToken(value)) {
        return value;
      }
    }

    const tokens = last.match(/[A-Z0-9][A-Z0-9_\/\-]{3,14}/g) || [];
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const value = cleanCandidate(tokens[i], { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN });
      if (isLikelyReleaseToken(value)) {
        return value;
      }
    }
    return "";
  }

  function extractReleaseFromBottom(rawText) {
    const normalized = normalizeOcrText(rawText);
    const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      return "";
    }

    const tail = lines.slice(Math.max(0, lines.length - 8));
    for (let i = tail.length - 1; i >= 0; i -= 1) {
      const line = tail[i];
      if (!line || /DESCRIPTION|QTY|DATE|PO#|PO |EMP#/.test(line)) {
        continue;
      }

      const patterns = [
        /\bRELEA[5S]E\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,14})/,
        /\bRELEA[5S]E([A-Z0-9][A-Z0-9_\/\-]{2,14})/,
        /\bREL\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,14})/,
        /\bJOB\s*NUMBER\b\s*[:#\-]?\s*([A-Z0-9][A-Z0-9_\/\-]{2,14})/
      ];

      for (let p = 0; p < patterns.length; p += 1) {
        const match = line.match(patterns[p]);
        if (match && match[1]) {
          const candidate = cleanCandidate(match[1], { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN });
          if (isLikelyReleaseToken(candidate)) {
            return candidate;
          }
        }
      }
    }
    return "";
  }

  function isLikelyReleaseToken(value) {
    const v = cleanCandidate(value, { minLen: RELEASE_MIN_LEN, maxLen: RELEASE_MAX_LEN });
    if (!v) {
      return false;
    }
    if (!/[A-Z]/.test(v) || !/\d/.test(v)) {
      return false;
    }
    if (v.includes("DESCRIPTION") || v.includes("SUPPLY") || v.includes("VDC")) {
      return false;
    }
    return true;
  }

  function normalizeOcrText(text) {
    return (text || "")
      .toUpperCase()
      .replace(/\r/g, "\n")
      .replace(/[|]/g, "I")
      .replace(/[“”]/g, "\"")
      .replace(/[^\S\n]+/g, " ");
  }

  function cleanCandidate(value, limits) {
    const compact = (value || "")
      .replace(/[^A-Z0-9_\/\- ]/g, " ")
      .replace(/\s+/g, "")
      .trim();
    if (!compact) {
      return "";
    }
    const minLen = limits && limits.minLen ? limits.minLen : 1;
    const maxLen = limits && limits.maxLen ? limits.maxLen : 200;
    if (compact.length < minLen || compact.length > maxLen) {
      return "";
    }
    return compact;
  }

  function findBestField(lines, patterns, limits, options) {
    const opts = options || {};
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (let p = 0; p < patterns.length; p += 1) {
        const match = line.match(patterns[p]);
        if (match && match[1]) {
          const candidate = cleanCandidate(match[1], limits);
          if (candidate && (!opts.valueValidator || opts.valueValidator(candidate))) {
            return candidate;
          }
        }
      }
      if (i + 1 < lines.length && /PART|RELEA|REL|JOB\s*NUMBER/.test(line)) {
        const nextCandidate = cleanCandidate(lines[i + 1], limits);
        if (nextCandidate && (!opts.nextLineValidator || opts.nextLineValidator(nextCandidate))) {
          return nextCandidate;
        }
      }
    }
    return "";
  }

  function findFromFlatText(text, patterns, limits, options) {
    const opts = options || {};
    for (let i = 0; i < patterns.length; i += 1) {
      const match = text.match(patterns[i]);
      if (match && match[1]) {
        const candidate = cleanCandidate(match[1], limits);
        if (candidate && (!opts.valueValidator || opts.valueValidator(candidate))) {
          return candidate;
        }
      }
    }
    return "";
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
      format: "a4"
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
    ctx.strokeRect(
      offsetX + 0.5,
      offsetY + 0.5,
      (A4_LANDSCAPE_PT.width * scale) - 1,
      (A4_LANDSCAPE_PT.height * scale) - 1
    );

    const topColor = parseTopColor();
    const layout = getLayout(A4_LANDSCAPE_PT.width, A4_LANDSCAPE_PT.height);
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

  function getQuickValidatedFields() {
    const partNumber = normalizeValue(quickPartInput.value);
    const release = normalizeValue(quickReleaseInput.value);
    if (!partNumber || !release) {
      setQuickStatus("Part Number and Release are required.");
      return null;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      setQuickStatus("PDF library failed to load. Refresh and try again.");
      return null;
    }
    const topColor = parseTopColor();
    return { partNumber, release, topColor };
  }

  function downloadPdf() {
    const fields = getValidatedFields();
    if (!fields) {
      return;
    }
    runDownloadExport(fields, setStatus);
  }

  function downloadQuickPdf() {
    const fields = getQuickValidatedFields();
    if (!fields) {
      return;
    }
    runDownloadExport(fields, setQuickStatus);
  }

  function buildOutputFileName(release) {
    const safeRelease = release.replace(/[^A-Z0-9_-]/g, "");
    return `inventory_label_${safeRelease || "output"}.pdf`;
  }

  async function trySharePdf(doc, fileName) {
    if (!navigator.share || typeof File === "undefined") {
      return false;
    }
    try {
      const blob = doc.output("blob");
      const file = new File([blob], fileName, { type: "application/pdf" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        return false;
      }
      await navigator.share({
        files: [file],
        title: "Inventory Label PDF",
        text: "Choose Print from the share options."
      });
      return true;
    } catch (_err) {
      return false;
    }
  }

  function runDownloadExport(fields, statusSetter) {
    const doc = buildPdfDocument(fields.release, fields.partNumber, fields.topColor);
    const fileName = buildOutputFileName(fields.release);
    doc.save(fileName);
    statusSetter("PDF downloaded (A4 landscape, fixed bleed).");
  }

  async function printPdf() {
    const fields = getValidatedFields();
    if (!fields) {
      return;
    }
    await runPrintExport(fields, setStatus);
  }

  async function printQuickPdf() {
    const fields = getQuickValidatedFields();
    if (!fields) {
      return;
    }
    await runPrintExport(fields, setQuickStatus);
  }

  async function runPrintExport(fields, statusSetter) {
    const fileName = buildOutputFileName(fields.release);

    // Open tab first to reduce popup blocking on mobile browsers.
    const printWindow = window.open("", "_blank");
    const doc = buildPdfDocument(fields.release, fields.partNumber, fields.topColor);
    if (typeof doc.autoPrint === "function") {
      doc.autoPrint();
    }

    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);

    if (printWindow) {
      printWindow.location.href = blobUrl;
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 120000);
      statusSetter("Print preview opened (A4 landscape, fixed bleed).");
      return;
    }

    const shared = await trySharePdf(doc, fileName);
    if (shared) {
      URL.revokeObjectURL(blobUrl);
      statusSetter("Share sheet opened. Choose Print / AirPrint.");
      return;
    }

    URL.revokeObjectURL(blobUrl);
    doc.save(fileName);
    statusSetter("Print preview blocked on this device. PDF downloaded instead.");
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

  function clearQuickForm() {
    quickPartInput.value = "";
    quickReleaseInput.value = "";
    setQuickStatus("Cleared.");
  }

  setMode("quick");
  renderPreview();
})();
