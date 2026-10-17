(function () {
  "use strict";

  const STORAGE_KEYS = Object.freeze({
    theme: "kalkulator-saintifik:theme:v1",
    memory: "kalkulator-saintifik:memory:v1",
    history: "kalkulator-saintifik:history:v1"
  });

  const MAX_HISTORY = 50;
  const MAX_INPUT_LENGTH = 500;
  const DISPLAY_PRECISION = 12;
  const NUMBER_PATTERN = /^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/;
  const TRAILING_NUMBER_PATTERN = /(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

  const FUNCTION_NAMES = new Set([
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "sqrt",
    "log",
    "ln",
    "abs"
  ]);

  const FUNCTION_LABELS = Object.freeze({
    sin: "sin",
    cos: "cos",
    tan: "tan",
    asin: "sin⁻¹",
    acos: "cos⁻¹",
    atan: "tan⁻¹",
    sqrt: "√",
    log: "log",
    ln: "ln",
    abs: "|x|"
  });

  const numberFormatter = new Intl.NumberFormat("ms-MY", {
    maximumSignificantDigits: DISPLAY_PRECISION,
    useGrouping: true
  });

  class CalculatorError extends Error {
    constructor(message) {
      super(message);
      this.name = "CalculatorError";
    }
  }

  function tokenize(source) {
    const tokens = [];
    let index = 0;

    while (index < source.length) {
      const character = source[index];

      if (/\s/.test(character)) {
        index += 1;
        continue;
      }

      const numberMatch = source.slice(index).match(NUMBER_PATTERN);
      if (numberMatch) {
        const raw = numberMatch[0];
        const value = Number(raw);

        if (!Number.isFinite(value)) {
          throw new CalculatorError("Nombor tersebut terlalu besar untuk dikira.");
        }

        tokens.push({ type: "NUMBER", value, raw, position: index });
        index += raw.length;
        continue;
      }

      if (/[A-Za-z]/.test(character)) {
        let identifierEnd = index + 1;

        while (identifierEnd < source.length && /[A-Za-z]/.test(source[identifierEnd])) {
          identifierEnd += 1;
        }

        const raw = source.slice(index, identifierEnd);
        const identifier = raw.toLowerCase();

        if (identifier === "mod") {
          tokens.push({ type: "MOD", raw, position: index });
        } else if (FUNCTION_NAMES.has(identifier)) {
          tokens.push({ type: "FUNCTION", name: identifier, raw, position: index });
        } else if (identifier === "pi") {
          tokens.push({ type: "CONSTANT", name: "pi", value: Math.PI, raw, position: index });
        } else if (identifier === "e") {
          tokens.push({ type: "CONSTANT", name: "e", value: Math.E, raw, position: index });
        } else {
          throw new CalculatorError(`Fungsi “${raw}” tidak dikenali.`);
        }

        index = identifierEnd;
        continue;
      }

      switch (character) {
        case "π":
          tokens.push({ type: "CONSTANT", name: "pi", value: Math.PI, raw: character, position: index });
          break;
        case "+":
          tokens.push({ type: "PLUS", position: index });
          break;
        case "-":
        case "−":
          tokens.push({ type: "MINUS", position: index });
          break;
        case "*":
        case "×":
          tokens.push({ type: "MULTIPLY", position: index });
          break;
        case "/":
        case "÷":
          tokens.push({ type: "DIVIDE", position: index });
          break;
        case "^":
          tokens.push({ type: "POWER", position: index });
          break;
        case "%":
          tokens.push({ type: "PERCENT", position: index });
          break;
        case "(":
          tokens.push({ type: "LPAREN", position: index });
          break;
        case ")":
          tokens.push({ type: "RPAREN", position: index });
          break;
        case ".":
          throw new CalculatorError("Titik perpuluhan mesti diikuti dengan nombor.");
        default:
          throw new CalculatorError(`Aksara “${character}” tidak sah dalam ungkapan.`);
      }

      index += 1;
    }

    return tokens;
  }

  class ExpressionParser {
    constructor(tokens, angleMode) {
      this.tokens = tokens;
      this.index = 0;
      this.angleMode = angleMode;
    }

    parse() {
      const value = this.parseExpression();
      const trailingToken = this.peek();

      if (trailingToken) {
        if (trailingToken.type === "RPAREN") {
          throw new CalculatorError("Terdapat kurungan tutup yang tidak sepadan.");
        }

        if (
          trailingToken.type === "NUMBER" ||
          trailingToken.type === "CONSTANT" ||
          trailingToken.type === "FUNCTION" ||
          trailingToken.type === "LPAREN"
        ) {
          throw new CalculatorError("Letakkan operator di antara nilai-nilai tersebut.");
        }

        throw new CalculatorError("Ungkapan mengandungi simbol tambahan yang tidak sah.");
      }

      return ensureFinite(value);
    }

    peek(offset = 0) {
      return this.tokens[this.index + offset] || null;
    }

    consume(type) {
      if (this.peek()?.type === type) {
        return this.tokens[this.index++];
      }

      return null;
    }

    parseExpression() {
      let value = this.parseTerm();

      while (this.peek()?.type === "PLUS" || this.peek()?.type === "MINUS") {
        const operator = this.tokens[this.index++].type;
        const right = this.parseTerm();
        value = operator === "PLUS" ? value + right : value - right;
        value = ensureFinite(value);
      }

      return value;
    }

    parseTerm() {
      let value = this.parseUnary();

      while (true) {
        const token = this.peek();

        if (!token) {
          break;
        }

        if (token.type === "MULTIPLY" || token.type === "DIVIDE" || token.type === "MOD") {
          this.index += 1;
          const right = this.parseUnary();

          if (token.type === "DIVIDE") {
            if (right === 0) {
              throw new CalculatorError("Pembahagian dengan sifar tidak dibenarkan.");
            }
            value /= right;
          } else if (token.type === "MOD") {
            if (right === 0) {
              throw new CalculatorError("Modulus dengan sifar tidak dibenarkan.");
            }
            value %= right;
          } else {
            value *= right;
          }

          value = ensureFinite(value);
          continue;
        }

        if (this.startsImplicitFactor(token)) {
          const right = this.parseUnary();
          value = ensureFinite(value * right);
          continue;
        }

        break;
      }

      return value;
    }

    startsImplicitFactor(token) {
      return (
        token.type === "CONSTANT" ||
        token.type === "FUNCTION" ||
        token.type === "LPAREN"
      );
    }

    parseUnary() {
      if (this.peek()?.type === "PLUS") {
        this.index += 1;
        return this.parseUnary();
      }

      if (this.peek()?.type === "MINUS") {
        this.index += 1;
        return -this.parseUnary();
      }

      return this.parsePower();
    }

    parsePower() {
      const base = this.parsePostfix();

      if (!this.consume("POWER")) {
        return base;
      }

      const exponent = this.parseUnary();
      const result = Math.pow(base, exponent);

      if (Number.isNaN(result)) {
        throw new CalculatorError("Kuasa tersebut tidak menghasilkan nombor nyata.");
      }

      return ensureFinite(result);
    }

    parsePostfix() {
      let value = this.parsePrimary();

      while (this.consume("PERCENT")) {
        value /= 100;
      }

      return value;
    }

    parsePrimary() {
      const token = this.peek();

      if (!token) {
        throw new CalculatorError("Ungkapan tidak lengkap.");
      }

      if (token.type === "NUMBER") {
        this.index += 1;
        return token.value;
      }

      if (token.type === "CONSTANT") {
        this.index += 1;
        return token.value;
      }

      if (token.type === "FUNCTION") {
        this.index += 1;
        return this.parseFunction(token);
      }

      if (token.type === "LPAREN") {
        this.index += 1;

        if (this.peek()?.type === "RPAREN") {
          throw new CalculatorError("Kurungan kosong tidak sah.");
        }

        const value = this.parseExpression();

        if (!this.consume("RPAREN")) {
          throw new CalculatorError("Kurungan tidak ditutup.");
        }

        return value;
      }

      if (token.type === "RPAREN") {
        throw new CalculatorError("Terdapat kurungan tutup yang tidak sepadan.");
      }

      if (token.type === "PERCENT") {
        throw new CalculatorError("Tanda peratus memerlukan nombor di hadapannya.");
      }

      if (token.type === "MOD") {
        throw new CalculatorError("Operator mod memerlukan nilai di kedua-dua belah.");
      }

      throw new CalculatorError("Ungkapan tidak lengkap atau operator tidak lengkap.");
    }

    parseFunction(token) {
      const label = FUNCTION_LABELS[token.name] || token.name;

      if (this.peek()?.type !== "LPAREN") {
        throw new CalculatorError(`Letakkan “(” selepas fungsi ${label}.`);
      }

      this.index += 1;

      if (this.peek()?.type === "RPAREN") {
        throw new CalculatorError(`Fungsi ${label} memerlukan satu nilai.`);
      }

      const argument = this.parseExpression();

      if (!this.consume("RPAREN")) {
        throw new CalculatorError(`Kurungan bagi fungsi ${label} tidak ditutup.`);
      }

      return ensureFinite(applyFunction(token.name, argument, this.angleMode));
    }
  }

  function toRadians(value, angleMode) {
    return angleMode === "deg" ? (value * Math.PI) / 180 : value;
  }

  function fromRadians(value, angleMode) {
    return angleMode === "deg" ? (value * 180) / Math.PI : value;
  }

  function snapTrigResult(value) {
    if (Math.abs(value) < 1e-12) {
      return 0;
    }

    if (Math.abs(value - 1) < 1e-12) {
      return 1;
    }

    if (Math.abs(value + 1) < 1e-12) {
      return -1;
    }

    return value;
  }

  function applyFunction(name, value, angleMode) {
    switch (name) {
      case "sin":
        return snapTrigResult(Math.sin(toRadians(value, angleMode)));

      case "cos":
        return snapTrigResult(Math.cos(toRadians(value, angleMode)));

      case "tan": {
        const radians = toRadians(value, angleMode);

        if (Math.abs(Math.cos(radians)) < 1e-12) {
          throw new CalculatorError("Tangen tidak tertakrif untuk sudut ini.");
        }

        return snapTrigResult(Math.tan(radians));
      }

      case "asin":
        if (value < -1 || value > 1) {
          throw new CalculatorError("Fungsi songsang trigonometri hanya menerima nilai antara −1 dan 1.");
        }
        return fromRadians(Math.asin(value), angleMode);

      case "acos":
        if (value < -1 || value > 1) {
          throw new CalculatorError("Fungsi songsang trigonometri hanya menerima nilai antara −1 dan 1.");
        }
        return fromRadians(Math.acos(value), angleMode);

      case "atan":
        return fromRadians(Math.atan(value), angleMode);

      case "sqrt":
        if (value < 0) {
          throw new CalculatorError("Punca kuasa dua hanya untuk nombor bukan negatif.");
        }
        return Math.sqrt(value);

      case "log":
        if (value <= 0) {
          throw new CalculatorError("Logaritma hanya untuk nombor positif.");
        }
        return Math.log10(value);

      case "ln":
        if (value <= 0) {
          throw new CalculatorError("Logaritma asli hanya untuk nombor positif.");
        }
        return Math.log(value);

      case "abs":
        return Math.abs(value);

      default:
        throw new CalculatorError("Fungsi tersebut tidak disokong.");
    }
  }

  function ensureFinite(value) {
    if (Number.isNaN(value)) {
      throw new CalculatorError("Operasi ini tidak menghasilkan nombor nyata.");
    }

    if (!Number.isFinite(value)) {
      throw new CalculatorError("Hasil terlalu besar untuk dikira.");
    }

    return value;
  }

  function evaluateExpression(expression, angleMode = "deg") {
    if (typeof expression !== "string") {
      throw new CalculatorError("Ungkapan tidak sah.");
    }

    if (angleMode !== "deg" && angleMode !== "rad") {
      throw new CalculatorError("Unit sudut tidak sah.");
    }

    const trimmedExpression = expression.trim();

    if (!trimmedExpression) {
      throw new CalculatorError("Masukkan ungkapan untuk dikira.");
    }

    if (trimmedExpression.length > MAX_INPUT_LENGTH) {
      throw new CalculatorError(`Ungkapan terhad kepada ${MAX_INPUT_LENGTH} aksara.`);
    }

    const tokens = tokenize(trimmedExpression);

    if (!tokens.length) {
      throw new CalculatorError("Masukkan ungkapan untuk dikira.");
    }

    return new ExpressionParser(tokens, angleMode).parse();
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) {
      return "Ralat";
    }

    if (Object.is(value, -0) || value === 0) {
      return "0";
    }

    const absolute = Math.abs(value);
    let rounded = Number(value.toPrecision(DISPLAY_PRECISION));

    if (Object.is(rounded, -0)) {
      rounded = 0;
    }

    if (absolute >= 1e12 || absolute < 1e-9) {
      return formatExponential(rounded);
    }

    return numberFormatter.format(rounded);
  }

  function formatExponential(value) {
    const parts = value.toExponential(8).split("e");
    const mantissa = parts[0].replace(/\.?0+$/, "");
    const exponent = Number(parts[1]);

    return `${mantissa}e${exponent >= 0 ? "+" : ""}${exponent}`;
  }

  function readStoredJSON(key, fallbackValue) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallbackValue : JSON.parse(raw);
    } catch (error) {
      return fallbackValue;
    }
  }

  function writeStoredJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Aplikasi tetap berfungsi jika storan pelayar tidak tersedia.
    }
  }

  function initApp() {
    const dom = {
      root: document.documentElement,
      themeColor: document.getElementById("themeColor"),
      themeToggle: document.getElementById("themeToggle"),
      themeLabel: document.getElementById("themeLabel"),
      expression: document.getElementById("expression"),
      result: document.getElementById("result"),
      errorMessage: document.getElementById("errorMessage"),
      errorText: document.getElementById("errorText"),
      memoryBadge: document.getElementById("memoryBadge"),
      angleBadge: document.getElementById("angleBadge"),
      angleButtons: Array.from(document.querySelectorAll("[data-angle]")),
      memoryButtons: Array.from(document.querySelectorAll("[data-memory]")),
      calculator: document.getElementById("calculator"),
      historyList: document.getElementById("historyList"),
      historyEmpty: document.getElementById("historyEmpty"),
      clearHistory: document.getElementById("clearHistory"),
      statusMessage: document.getElementById("statusMessage")
    };

    if (!dom.expression || !dom.result || !dom.calculator) {
      return;
    }

    const savedTheme = readStoredJSON(STORAGE_KEYS.theme, null);
    const prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    let historyIdCounter = 0;
    let announceTimer = 0;

    const state = {
      theme: savedTheme === "dark" || savedTheme === "light" ? savedTheme : (prefersDark ? "dark" : "light"),
      angleMode: "deg",
      memory: normalizeMemory(readStoredJSON(STORAGE_KEYS.memory, null)),
      history: normalizeHistory(readStoredJSON(STORAGE_KEYS.history, [])),
      lastResult: null
    };

    let lastSelection = { start: 0, end: 0 };

    function isFinePointer() {
      return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: fine)").matches
      );
    }

    function announce(message) {
      if (!dom.statusMessage) {
        return;
      }

      window.clearTimeout(announceTimer);
      dom.statusMessage.textContent = "";

      announceTimer = window.setTimeout(() => {
        dom.statusMessage.textContent = message;
      }, 40);
    }

    function createHistoryId() {
      if (typeof window.crypto?.randomUUID === "function") {
        return window.crypto.randomUUID();
      }

      historyIdCounter += 1;
      return `catatan-${Date.now().toString(36)}-${historyIdCounter.toString(36)}`;
    }

    function normalizeHistory(rawHistory) {
      if (!Array.isArray(rawHistory)) {
        return [];
      }

      const normalized = [];
      const usedIds = new Set();

      for (const item of rawHistory) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const expression = typeof item.expression === "string" ? item.expression.trim() : "";
        const result = Number(item.result);

        if (!expression || expression.length > MAX_INPUT_LENGTH || !Number.isFinite(result)) {
          continue;
        }

        let id = typeof item.id === "string" && item.id ? item.id : createHistoryId();

        if (usedIds.has(id)) {
          id = createHistoryId();
        }

        usedIds.add(id);
        normalized.push({ id, expression, result });

        if (normalized.length >= MAX_HISTORY) {
          break;
        }
      }

      return normalized;
    }

    function normalizeMemory(rawMemory) {
      if (
        rawMemory &&
        typeof rawMemory === "object" &&
        Number.isFinite(Number(rawMemory.value)) &&
        typeof rawMemory.active === "boolean"
      ) {
        return {
          active: rawMemory.active,
          value: Number(rawMemory.value)
        };
      }

      if (Number.isFinite(Number(rawMemory))) {
        return { active: true, value: Number(rawMemory) };
      }

      return { active: false, value: 0 };
    }

    function persistHistory() {
      writeStoredJSON(STORAGE_KEYS.history, state.history);
    }

    function persistMemory() {
      writeStoredJSON(STORAGE_KEYS.memory, state.memory);
    }

    function applyTheme(theme, persist = false) {
      state.theme = theme;
      dom.root.dataset.theme = theme;

      const isDark = theme === "dark";
      const nextLabel = isDark ? "Tema cerah" : "Tema gelap";

      if (dom.themeToggle) {
        dom.themeToggle.setAttribute("aria-pressed", String(isDark));
        dom.themeToggle.setAttribute("aria-label", `Tukar ke ${nextLabel.toLowerCase()}`);
      }

      if (dom.themeLabel) {
        dom.themeLabel.textContent = nextLabel;
      }

      if (dom.themeColor) {
        dom.themeColor.setAttribute("content", isDark ? "#07120f" : "#edf4f0");
      }

      if (persist) {
        writeStoredJSON(STORAGE_KEYS.theme, theme);
      }
    }

    function updateAngleUI() {
      if (dom.angleBadge) {
        dom.angleBadge.textContent = state.angleMode.toUpperCase();
      }

      for (const button of dom.angleButtons) {
        const isActive = button.dataset.angle === state.angleMode;
        button.setAttribute("aria-pressed", String(isActive));
      }
    }

    function updateMemoryUI() {
      const isActive = state.memory.active;

      if (dom.memoryBadge) {
        dom.memoryBadge.hidden = !isActive;
        dom.memoryBadge.title = isActive
          ? `Memori: ${formatNumber(state.memory.value)}`
          : "Memori aktif";

        if (isActive) {
          dom.memoryBadge.setAttribute(
            "aria-label",
            `Memori aktif: ${formatNumber(state.memory.value)}`
          );
        } else {
          dom.memoryBadge.removeAttribute("aria-label");
        }
      }

      for (const button of dom.memoryButtons) {
        const action = button.dataset.memory;

        if (action === "clear" || action === "recall") {
          button.disabled = !isActive;
        }
      }
    }

    function setResult(text, { preview = false, error = false } = {}) {
      dom.result.textContent = text;
      dom.result.classList.toggle("is-preview", preview && !error);
      dom.result.classList.toggle("is-error", error);
    }

    function showError(message) {
      if (dom.errorText) {
        dom.errorText.textContent = message;
      }

      if (dom.errorMessage) {
        dom.errorMessage.hidden = false;
      }

      dom.expression.setAttribute("aria-invalid", "true");
    }

    function clearError() {
      if (dom.errorText) {
        dom.errorText.textContent = "";
      }

      if (dom.errorMessage) {
        dom.errorMessage.hidden = true;
      }

      dom.expression.removeAttribute("aria-invalid");
    }

    function updatePreview() {
      const expression = dom.expression.value.trim();

      if (!expression) {
        setResult("0");
        return;
      }

      try {
        const value = evaluateExpression(expression, state.angleMode);
        setResult(formatNumber(value), { preview: true });
      } catch (error) {
        setResult("—", { preview: true });
      }
    }

    function afterExpressionChange() {
      state.lastResult = null;
      clearError();
      updatePreview();
      rememberSelection();
    }

    function rememberSelection() {
      if (document.activeElement !== dom.expression) {
        return;
      }

      lastSelection = {
        start: dom.expression.selectionStart ?? dom.expression.value.length,
        end: dom.expression.selectionEnd ?? dom.expression.value.length
      };
    }

    function getSelection() {
      const valueLength = dom.expression.value.length;

      if (document.activeElement === dom.expression) {
        return {
          start: Math.min(dom.expression.selectionStart ?? valueLength, valueLength),
          end: Math.min(dom.expression.selectionEnd ?? valueLength, valueLength)
        };
      }

      return {
        start: Math.min(lastSelection.start, valueLength),
        end: Math.min(lastSelection.end, valueLength)
      };
    }

    function focusExpression({ force = false } = {}) {
      if (!force && !isFinePointer()) {
        return;
      }

      dom.expression.focus({ preventScroll: true });

      const valueLength = dom.expression.value.length;
      const start = Math.min(lastSelection.start, valueLength);
      const end = Math.min(lastSelection.end, valueLength);
      dom.expression.setSelectionRange(start, end);
    }

    function insertText(text) {
      const { start, end } = getSelection();
      const nextLength = dom.expression.value.length - (end - start) + text.length;

      if (nextLength > MAX_INPUT_LENGTH) {
        showError(`Ungkapan terhad kepada ${MAX_INPUT_LENGTH} aksara.`);
        return false;
      }

      dom.expression.setRangeText(text, start, end, "end");
      lastSelection = {
        start: dom.expression.selectionStart ?? start + text.length,
        end: dom.expression.selectionEnd ?? start + text.length
      };
      afterExpressionChange();
      return true;
    }

    function insertNumber(value) {
      const rawValue = String(value);
      const { start } = getSelection();
      const before = dom.expression.value.slice(0, start).trimEnd();
      const needsMultiply = before !== "" && /[\dπe%)]$/.test(before);
      const formattedValue = value < 0 ? `(${rawValue})` : rawValue;

      insertText(`${needsMultiply ? "×" : ""}${formattedValue}`);
    }

    function deleteBackward() {
      const { start, end } = getSelection();

      if (start === 0 && end === 0) {
        return;
      }

      const deletionStart = start === end ? start - 1 : start;
      dom.expression.setRangeText("", deletionStart, end, "end");
      lastSelection = {
        start: dom.expression.selectionStart ?? deletionStart,
        end: dom.expression.selectionEnd ?? deletionStart
      };
      afterExpressionChange();
    }

    function clearAll({ notify = true } = {}) {
      dom.expression.value = "";
      lastSelection = { start: 0, end: 0 };
      state.lastResult = null;
      setResult("0");
      clearError();

      if (notify) {
        announce("Paparan dikosongkan.");
      }
    }

    function calculate() {
      const expression = dom.expression.value.trim();

      if (!expression) {
        setResult("Ralat", { error: true });
        showError("Masukkan ungkapan untuk dikira.");
        announce("Ralat: masukkan ungkapan untuk dikira.");
        return;
      }

      try {
        const value = evaluateExpression(expression, state.angleMode);
        clearError();
        state.lastResult = value;
        setResult(formatNumber(value));
        addHistory(expression, value);
        announce(`Hasil: ${formatNumber(value)}.`);
      } catch (error) {
        state.lastResult = null;
        setResult("Ralat", { error: true });

        if (error instanceof CalculatorError) {
          showError(error.message);
          announce(`Ralat: ${error.message}`);
        } else {
          showError("Ralat tidak dijangka. Sila semak ungkapan anda.");
          announce("Ralat tidak dijangka. Sila semak ungkapan anda.");
          console.error(error);
        }
      }
    }

    function addHistory(expression, result) {
      const latest = state.history[0];

      if (latest && latest.expression === expression && latest.result === result) {
        return;
      }

      state.history.unshift({
        id: createHistoryId(),
        expression,
        result
      });

      if (state.history.length > MAX_HISTORY) {
        state.history.length = MAX_HISTORY;
      }

      persistHistory();
      renderHistory();
    }

    function renderHistory() {
      if (!dom.historyList) {
        return;
      }

      const hasHistory = state.history.length > 0;
      dom.historyList.replaceChildren();
      dom.historyList.hidden = !hasHistory;

      if (dom.historyEmpty) {
        dom.historyEmpty.hidden = hasHistory;
      }

      if (dom.clearHistory) {
        dom.clearHistory.disabled = !hasHistory;
      }

      if (!hasHistory) {
        return;
      }

      const fragment = document.createDocumentFragment();

      for (const entry of state.history) {
        const item = document.createElement("li");
        item.className = "history-item";

        const reuseButton = document.createElement("button");
        reuseButton.type = "button";
        reuseButton.className = "history-reuse";
        reuseButton.dataset.historyUse = entry.id;
        reuseButton.setAttribute(
          "aria-label",
          `Guna semula ${entry.expression}. Hasil ${formatNumber(entry.result)}.`
        );

        const expressionSpan = document.createElement("span");
        expressionSpan.className = "history-expression";
        expressionSpan.textContent = entry.expression;
        expressionSpan.title = entry.expression;

        const resultSpan = document.createElement("span");
        resultSpan.className = "history-result";
        resultSpan.textContent = `= ${formatNumber(entry.result)}`;

        reuseButton.append(expressionSpan, resultSpan);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "history-delete";
        deleteButton.dataset.historyDelete = entry.id;
        deleteButton.setAttribute(
          "aria-label",
          `Padam pengiraan ${entry.expression}`
        );
        deleteButton.title = "Padam catatan";
        deleteButton.textContent = "×";

        item.append(reuseButton, deleteButton);
        fragment.append(item);
      }

      dom.historyList.append(fragment);
    }

    function useHistoryEntry(id) {
      const entry = state.history.find((item) => item.id === id);

      if (!entry) {
        return;
      }

      dom.expression.value = entry.expression;
      lastSelection = {
        start: entry.expression.length,
        end: entry.expression.length
      };
      state.lastResult = entry.result;
      clearError();
      setResult(formatNumber(entry.result));
      announce(`Ungkapan sejarah dimuatkan. Hasil ${formatNumber(entry.result)}.`);
      focusExpression();
    }

    function deleteHistoryEntry(id) {
      const index = state.history.findIndex((item) => item.id === id);

      if (index === -1) {
        return;
      }

      state.history.splice(index, 1);
      persistHistory();
      renderHistory();
      announce("Catatan sejarah dipadam.");

      const remainingButtons = dom.historyList.querySelectorAll("[data-history-use]");

      if (remainingButtons.length) {
        const nextIndex = Math.min(index, remainingButtons.length - 1);
        remainingButtons[nextIndex].focus();
      } else if (dom.expression) {
        dom.expression.focus({ preventScroll: true });
      }
    }

    function clearHistory() {
      if (!state.history.length) {
        return;
      }

      state.history = [];
      persistHistory();
      renderHistory();
      announce("Semua sejarah telah dipadam.");
      focusExpression();
    }

    function handleMemory(action) {
      if (action === "clear") {
        state.memory = { active: false, value: 0 };
        persistMemory();
        updateMemoryUI();
        clearError();
        announce("Memori dikosongkan.");
        return;
      }

      if (action === "recall") {
        if (!state.memory.active) {
          announce("Memori kosong.");
          return;
        }

        insertNumber(state.memory.value);
        announce(`Memori dipanggil: ${formatNumber(state.memory.value)}.`);
        return;
      }

      try {
        const currentValue = getCurrentValue();

        if (action === "store") {
          state.memory = { active: true, value: currentValue };
          persistMemory();
          updateMemoryUI();
          clearError();
          announce(`Nilai ${formatNumber(currentValue)} disimpan dalam memori.`);
          return;
        }

        if (action === "add" || action === "subtract") {
          const baseValue = state.memory.active ? state.memory.value : 0;
          const nextValue =
            action === "add" ? baseValue + currentValue : baseValue - currentValue;

          if (!Number.isFinite(nextValue)) {
            throw new CalculatorError("Nilai memori terlalu besar untuk disimpan.");
          }

          state.memory = { active: true, value: nextValue };
          persistMemory();
          updateMemoryUI();
          clearError();
          announce(`Nilai memori kini ${formatNumber(nextValue)}.`);
        }
      } catch (error) {
        if (error instanceof CalculatorError) {
          showError(error.message);
          announce(`Ralat: ${error.message}`);
        } else {
          showError("Ralat tidak dijangka semasa mengemas kini memori.");
          console.error(error);
        }
      }
    }

    function getCurrentValue() {
      const expression = dom.expression.value.trim();

      if (expression) {
        return evaluateExpression(expression, state.angleMode);
      }

      if (state.lastResult !== null) {
        return state.lastResult;
      }

      return 0;
    }

    function setAngleMode(mode) {
      if (mode !== "deg" && mode !== "rad") {
        return;
      }

      if (state.angleMode === mode) {
        return;
      }

      state.angleMode = mode;
      updateAngleUI();
      clearError();
      updatePreview();
      announce(`Unit sudut ditukar kepada ${mode === "deg" ? "darjah" : "radian"}.`);
    }

    function toggleSign() {
      const { start, end } = getSelection();
      const value = dom.expression.value;

      if (start !== end) {
        const selected = value.slice(start, end);
        insertText(`−(${selected})`);
        return;
      }

      const before = value.slice(0, start);
      const numberMatch = before.match(TRAILING_NUMBER_PATTERN);

      if (!numberMatch) {
        insertText("−");
        return;
      }

      const numberStart = start - numberMatch[0].length;
      const previousCharacter = value[numberStart - 1];

      if (previousCharacter === "−" || previousCharacter === "-") {
        const beforeSign = value.slice(0, numberStart - 1).trimEnd();
        const previousSignificant = beforeSign.slice(-1);
        const isUnary =
          beforeSign === "" ||
          /[+\-−×÷*/^(%]/.test(previousSignificant) ||
          /(?:^|\s)mod$/i.test(beforeSign);

        if (isUnary) {
          dom.expression.setRangeText("", numberStart - 1, numberStart, "preserve");
          lastSelection = {
            start: Math.max(0, start - 1),
            end: Math.max(0, end - 1)
          };
          afterExpressionChange();
          return;
        }
      }

      dom.expression.setRangeText("−", numberStart, numberStart, "preserve");
      lastSelection = {
        start: start + 1,
        end: end + 1
      };
      afterExpressionChange();
    }

    function normalizeKeyboardKey(key) {
      const replacements = {
        "*": "×",
        "/": "÷",
        "-": "−"
      };

      if (/^[0-9.+\-*/^%()]$/.test(key)) {
        return replacements[key] || key;
      }

      return null;
    }

    function handleDocumentKeydown(event) {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearAll();
        focusExpression({ force: true });
        return;
      }

      const target = event.target;
      const isExpressionInput = target === dom.expression;
      const isButton = target instanceof Element && Boolean(target.closest("button"));

      if (event.key === "Enter") {
        if (isExpressionInput || !isButton) {
          event.preventDefault();
          calculate();
        }
        return;
      }

      if (event.key === "=" && !isButton) {
        event.preventDefault();
        calculate();
        return;
      }

      if (isExpressionInput) {
        return;
      }

      if (
        target instanceof HTMLElement &&
        target.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        deleteBackward();
        focusExpression({ force: true });
        return;
      }

      const insertedKey = normalizeKeyboardKey(event.key);

      if (insertedKey !== null) {
        event.preventDefault();
        insertText(insertedKey);
        focusExpression({ force: true });
      }
    }

    function handleCalculatorClick(event) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const insertButton = target.closest("[data-insert]");

      if (insertButton) {
        insertText(insertButton.dataset.insert || "");
      } else {
        const actionButton = target.closest("[data-action]");
        const action = actionButton?.dataset.action;

        if (action === "clear") {
          clearAll();
        } else if (action === "backspace") {
          deleteBackward();
        } else if (action === "toggle-sign") {
          toggleSign();
        } else if (action === "calculate") {
          calculate();
        }

        if (actionButton && event.detail > 0) {
          focusExpression();
        }
      }

      if (insertButton && event.detail > 0) {
        focusExpression();
      }
    }

    dom.expression.addEventListener("input", () => {
      state.lastResult = null;
      clearError();
      updatePreview();
      rememberSelection();
    });

    dom.expression.addEventListener("select", rememberSelection);
    dom.expression.addEventListener("keyup", rememberSelection);
    dom.expression.addEventListener("click", rememberSelection);
    dom.expression.addEventListener("focus", rememberSelection);
    dom.expression.addEventListener("blur", rememberSelection);

    dom.expression.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        calculate();
      }
    });

    dom.calculator.addEventListener("click", handleCalculatorClick);

    for (const button of dom.angleButtons) {
      button.addEventListener("click", (event) => {
        setAngleMode(button.dataset.angle);

        if (event.detail > 0) {
          focusExpression();
        }
      });
    }

    for (const button of dom.memoryButtons) {
      button.addEventListener("click", (event) => {
        handleMemory(button.dataset.memory);

        if (event.detail > 0) {
          focusExpression();
        }
      });
    }

    dom.themeToggle?.addEventListener("click", () => {
      const nextTheme = state.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme, true);
      announce(nextTheme === "dark" ? "Tema gelap diaktifkan." : "Tema cerah diaktifkan.");
    });

    dom.clearHistory?.addEventListener("click", clearHistory);

    dom.historyList?.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const deleteButton = target.closest("[data-history-delete]");

      if (deleteButton) {
        deleteHistoryEntry(deleteButton.dataset.historyDelete);
        return;
      }

      const reuseButton = target.closest("[data-history-use]");

      if (reuseButton) {
        useHistoryEntry(reuseButton.dataset.historyUse);
      }
    });

    document.addEventListener("keydown", handleDocumentKeydown);

    applyTheme(state.theme);
    updateAngleUI();
    updateMemoryUI();
    renderHistory();
    setResult("0");
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      CalculatorError,
      evaluateExpression,
      formatNumber
    };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initApp, { once: true });
    } else {
      initApp();
    }
  }
})();
