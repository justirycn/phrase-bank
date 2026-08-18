function safeNonce(value: unknown): string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    throw new Error("CSP nonce must be a safe base64 or hexadecimal token");
  }
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/** Returns the static shell for the local-only bilingual review application. */
export function renderLocalReviewPage({ nonce }: { nonce: string }): string {
  const escapedNonce = safeNonce(nonce);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>本地 Qwen 句库审核</title>
  <style nonce="${escapedNonce}">
    :root { color-scheme: light; font-family: system-ui, sans-serif; color: #172033; background: #f5f7fb; }
    * { box-sizing: border-box; }
    html { scroll-padding-top: 1rem; }
    body { margin: 0; min-width: 0; overflow-x: hidden; }
    button, input, select, textarea { font: inherit; color: inherit; }
    button, input, select { min-height: 44px; }
    button { border: 1px solid #52617a; border-radius: .5rem; background: #fff; padding: .55rem .8rem; cursor: pointer; }
    button:hover:not(:disabled) { background: #e8edf7; }
    button[aria-pressed="true"] { color: #fff; border-color: #174f9b; background: #174f9b; }
    button:disabled { cursor: not-allowed; opacity: .58; }
    :focus-visible { outline: 3px solid #e07700; outline-offset: 3px; }
    .skip-link { position: absolute; left: .5rem; top: -5rem; z-index: 2; background: #fff; padding: .75rem; }
    .skip-link:focus { top: .5rem; }
    header, main { width: min(100% - 2rem, 82rem); margin-inline: auto; }
    header { padding-block: 1.25rem .5rem; }
    h1 { margin: 0 0 .5rem; font-size: clamp(1.55rem, 5vw, 2.25rem); }
    h2, h3 { scroll-margin-top: 1rem; }
    main { padding-bottom: 6rem; }
    .panel, article { max-width: 100%; border: 1px solid #cbd3df; border-radius: .8rem; background: #fff; padding: 1rem; box-shadow: 0 1px 3px rgb(20 35 60 / 10%); }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(10rem, 100%), 1fr)); gap: .7rem; margin-block: 1rem; }
    .summary div { min-width: 0; border-left: .25rem solid #3268ad; padding-left: .65rem; }
    .summary dt { color: #4d5b70; }
    .summary dd { margin: .2rem 0 0; font-weight: 700; overflow-wrap: anywhere; }
    .status-line { min-height: 1.5rem; margin-block: .6rem; }
    .error { color: #9e1b1b; font-weight: 650; }
    .filters { display: flex; flex-wrap: wrap; align-items: end; gap: .75rem; }
    .filters label { display: grid; min-width: min(12rem, 100%); gap: .25rem; }
    .filters .check { display: flex; min-width: auto; min-height: 44px; align-items: center; gap: .4rem; }
    .filters .check input { width: 1.25rem; min-height: 1.25rem; }
    input[type="search"], select, textarea { max-width: 100%; border: 1px solid #718096; border-radius: .45rem; background: #fff; padding: .6rem; }
    #search { width: min(25rem, 100%); }
    .approval { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin-block: 1rem; }
    #review-list { display: grid; gap: 1rem; margin-block: 1rem; }
    article { overflow-wrap: anywhere; }
    .row-heading { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: .5rem; }
    .meta, .badges, .actions { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
    .meta { color: #42516a; }
    .badge { display: inline-flex; align-items: center; min-height: 2rem; border-radius: 999px; background: #edf1f7; padding: .25rem .65rem; }
    .badge.hint { color: #713b00; background: #fff0cf; }
    .bilingual { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; margin-block: 1rem; }
    .language { min-width: 0; border-left: .2rem solid #8ba5c8; padding-left: .75rem; }
    .language p { white-space: pre-wrap; overflow-wrap: anywhere; }
    .note-field { display: grid; gap: .35rem; margin-block: .8rem; }
    textarea { width: 100%; min-height: 5.5rem; resize: vertical; }
    .row-status { min-height: 1.5rem; color: #42516a; }
    .empty { text-align: center; color: #4d5b70; }
    @media (max-width: 700px) {
      header, main { width: min(100% - 1rem, 82rem); }
      .bilingual { grid-template-columns: 1fr; }
      .filters > *, .filters label, .filters button { flex: 1 1 100%; width: 100%; }
      .filters .check { flex: 1 1 auto; width: auto; }
      .actions button { flex: 1 1 8rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">跳到审核内容</a>
  <header>
    <h1>本地 Qwen 句库审核</h1>
    <p>候选双语内容为只读；只有审核备注可以编辑。此页面不会执行 Git、发布或部署操作。</p>
  </header>
  <main id="main-content">
    <section class="panel" aria-labelledby="summary-heading">
      <h2 id="summary-heading">审核概览</h2>
      <dl class="summary">
        <div><dt>版本</dt><dd id="version-value">—</dd></div>
        <div><dt>核心句</dt><dd id="core-count">600</dd></div>
        <div><dt>总句数</dt><dd id="total-count">2000</dd></div>
        <div><dt>报告</dt><dd id="report-value">—</dd></div>
        <div><dt>门禁</dt><dd id="gate-value">—</dd></div>
        <div><dt>候选哈希</dt><dd id="hash-value">—</dd></div>
        <div><dt>审核状态</dt><dd id="approved-value">—</dd></div>
        <div><dt>抽样</dt><dd id="sampled-count">0</dd></div>
        <div><dt>通过</dt><dd id="pass-count">0</dd></div>
        <div><dt>问题</dt><dd id="issue-count">0</dd></div>
        <div><dt>未决定</dt><dd id="undecided-count">0</dd></div>
      </dl>
      <p id="load-status" class="status-line" role="status" aria-live="polite">正在加载审核数据…</p>
      <p id="page-error" class="status-line error" role="alert" hidden></p>
      <button id="retry" type="button" hidden>重新加载</button>
    </section>

    <section class="panel" aria-labelledby="filter-heading">
      <h2 id="filter-heading">筛选候选句</h2>
      <div class="filters">
        <label for="search">搜索<input id="search" type="search" autocomplete="off" placeholder="ID、双语、分类或父级 ID"></label>
        <label for="category">分类<select id="category"><option value="">全部分类</option></select></label>
        <label for="subcategory">子分类<select id="subcategory"><option value="">全部子分类</option></select></label>
        <label for="kind">类型<select id="kind"><option value="">全部类型</option><option value="core">核心句</option><option value="example">例句</option></select></label>
        <label class="check" for="sample-only"><input id="sample-only" type="checkbox" checked>仅看抽样</label>
        <label class="check" for="issue-only"><input id="issue-only" type="checkbox">仅看问题</label>
        <label class="check" for="hint-only"><input id="hint-only" type="checkbox">仅看提示</label>
        <button id="clear-filters" type="button">清除筛选</button>
      </div>
    </section>

    <section class="approval panel" aria-labelledby="approval-heading">
      <div>
        <h2 id="approval-heading">版本批准</h2>
        <p id="approval-help">加载完成后将显示剩余数量或阻塞问题。</p>
      </div>
      <button id="approve" type="button" aria-describedby="approval-help" disabled>批准此版本</button>
      <span id="approval-status" role="status" aria-live="polite"></span>
    </section>

    <section aria-labelledby="list-heading">
      <h2 id="list-heading">候选句</h2>
      <p id="result-count" role="status" aria-live="polite"></p>
      <div id="review-list"></div>
    </section>
  </main>
  <script type="module" nonce="${escapedNonce}">
    const byId = (id) => document.getElementById(id);
    const elements = {
      version: byId("version-value"), core: byId("core-count"), total: byId("total-count"),
      report: byId("report-value"), gate: byId("gate-value"), hash: byId("hash-value"),
      approved: byId("approved-value"), sampled: byId("sampled-count"), pass: byId("pass-count"),
      issue: byId("issue-count"), undecided: byId("undecided-count"), loadStatus: byId("load-status"),
      error: byId("page-error"), retry: byId("retry"), search: byId("search"), category: byId("category"),
      subcategory: byId("subcategory"), kind: byId("kind"), sampleOnly: byId("sample-only"),
      issueOnly: byId("issue-only"), hintOnly: byId("hint-only"), clear: byId("clear-filters"),
      approve: byId("approve"), approvalHelp: byId("approval-help"), approvalStatus: byId("approval-status"),
      resultCount: byId("result-count"), list: byId("review-list"),
    };
    const retryButton = elements.retry;
    const pendingIds = new Set();
    let model = null;
    let loading = false;
    let approvalPending = false;

    function setText(element, value) {
      element.textContent = value == null || value === "" ? "—" : String(value);
    }

    function reviewItems() {
      return model && model.items && typeof model.items === "object" ? model.items : {};
    }

    function hintsFor(phrase) {
      if (Array.isArray(phrase.hints)) return phrase.hints;
      return model && model.hintsById && Array.isArray(model.hintsById[phrase.id]) ? model.hintsById[phrase.id] : [];
    }

    function sampledSet() {
      return new Set(model && Array.isArray(model.sampledIds) ? model.sampledIds : []);
    }

    function addOption(select, value) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }

    function resetOptions(select, firstLabel) {
      select.replaceChildren();
      const first = document.createElement("option");
      first.value = "";
      first.textContent = firstLabel;
      select.append(first);
    }

    function updateFilterOptions() {
      const currentCategory = elements.category.value;
      resetOptions(elements.category, "全部分类");
      const categories = [...new Set(model.phrases.map((phrase) => phrase.categoryId))];
      for (const category of categories) addOption(elements.category, category);
      if (categories.includes(currentCategory)) elements.category.value = currentCategory;
      updateSubcategoryOptions();
    }

    function updateSubcategoryOptions() {
      const selected = elements.subcategory.value;
      resetOptions(elements.subcategory, "全部子分类");
      const subcategories = [...new Set(model.phrases
        .filter((phrase) => !elements.category.value || phrase.categoryId === elements.category.value)
        .map((phrase) => phrase.subcategory))];
      for (const subcategory of subcategories) addOption(elements.subcategory, subcategory);
      if (subcategories.includes(selected)) elements.subcategory.value = selected;
    }

    function updateSummary() {
      const items = reviewItems();
      const sampleIds = model.sampledIds || [];
      const decisions = Object.values(items);
      const passCount = decisions.filter(({ decision }) => decision === "pass").length;
      const issueCount = decisions.filter(({ decision }) => decision === "issue").length;
      const undecidedCount = sampleIds.filter((id) => !items[id]).length;
      setText(elements.version, model.version);
      setText(elements.core, model.coreCount ?? 600);
      setText(elements.total, model.totalCount ?? model.phrases.length ?? 2000);
      setText(elements.report, model.reportStatus ?? model.report ?? "—");
      setText(elements.gate, model.gateStatus ?? model.gate ?? "—");
      setText(elements.hash, model.candidateSha256 ? model.candidateSha256.slice(0, 12) : "—");
      setText(elements.approved, model.approvedAt ? "已批准" : "未批准");
      setText(elements.sampled, sampleIds.length);
      setText(elements.pass, passCount);
      setText(elements.issue, issueCount);
      setText(elements.undecided, undecidedCount);
      const reason = model.approvalMessage || (undecidedCount > 0
        ? "还有 " + undecidedCount + " 条抽样句未决定。"
        : issueCount > 0 ? "还有 " + issueCount + " 条问题需要解决。"
        : model.canApprove === true ? "所有批准条件均已满足。" : "报告或门禁仍未通过。");
      setText(elements.approvalHelp, reason);
      elements.approve.disabled = approvalPending || model.canApprove !== true;
    }

    function appendMeta(container, value) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = value;
      container.append(badge);
    }

    function makeButton(label, decision, item, phrase, note, rowStatus) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-pressed", String(item && item.decision === decision));
      button.disabled = pendingIds.has(phrase.id);
      button.addEventListener("click", () => submitDecision(phrase.id, decision, note, rowStatus));
      return button;
    }

    function renderPhrase(phrase) {
      const item = reviewItems()[phrase.id];
      const article = document.createElement("article");
      article.id = "phrase-" + phrase.id;
      article.setAttribute("aria-labelledby", "heading-" + phrase.id);
      const headingRow = document.createElement("div");
      headingRow.className = "row-heading";
      const heading = document.createElement("h3");
      heading.id = "heading-" + phrase.id;
      heading.textContent = phrase.id;
      const meta = document.createElement("div");
      meta.className = "meta";
      appendMeta(meta, phrase.categoryId);
      appendMeta(meta, phrase.subcategory);
      appendMeta(meta, phrase.kind === "core" ? "核心句" : "例句");
      if (phrase.parentPhraseId) appendMeta(meta, "父级核心句：" + phrase.parentPhraseId);
      headingRow.append(heading, meta);

      const bilingual = document.createElement("div");
      bilingual.className = "bilingual";
      const englishBox = document.createElement("section");
      englishBox.className = "language";
      const englishLabel = document.createElement("strong");
      englishLabel.textContent = "English";
      const english = document.createElement("p");
      english.lang = "en";
      english.textContent = phrase.english;
      englishBox.append(englishLabel, english);
      const chineseBox = document.createElement("section");
      chineseBox.className = "language";
      const chineseLabel = document.createElement("strong");
      chineseLabel.textContent = "中文";
      const chinese = document.createElement("p");
      chinese.lang = "zh-CN";
      chinese.textContent = phrase.chinese;
      chineseBox.append(chineseLabel, chinese);
      bilingual.append(englishBox, chineseBox);

      const badges = document.createElement("div");
      badges.className = "badges";
      for (const hint of hintsFor(phrase)) {
        const badge = document.createElement("span");
        badge.className = "badge hint";
        badge.textContent = hint.code + "：" + hint.message;
        badges.append(badge);
      }

      const noteField = document.createElement("div");
      noteField.className = "note-field";
      const noteLabel = document.createElement("label");
      noteLabel.htmlFor = "note-" + phrase.id;
      noteLabel.textContent = "审核备注（" + phrase.id + "）";
      const note = document.createElement("textarea");
      note.id = "note-" + phrase.id;
      note.maxLength = 1000;
      note.setAttribute("aria-label", "审核备注：" + phrase.id);
      note.value = item && typeof item.note === "string" ? item.note : "";
      note.disabled = pendingIds.has(phrase.id);
      noteField.append(noteLabel, note);

      const actions = document.createElement("div");
      actions.className = "actions";
      const rowStatus = document.createElement("span");
      rowStatus.className = "row-status";
      rowStatus.setAttribute("role", pendingIds.has(phrase.id) ? "status" : "alert");
      rowStatus.setAttribute("aria-live", "polite");
      if (pendingIds.has(phrase.id)) rowStatus.textContent = "正在保存…";
      actions.append(
        makeButton("通过", "pass", item, phrase, note, rowStatus),
        makeButton("标记问题", "issue", item, phrase, note, rowStatus),
        rowStatus,
      );
      article.append(headingRow, bilingual, badges, noteField, actions);
      return article;
    }

    function matchesSearch(phrase, query) {
      if (!query) return true;
      const haystack = [phrase.id, phrase.english, phrase.chinese, phrase.categoryId, phrase.subcategory, phrase.parentPhraseId || ""]
        .join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    }

    function renderRows() {
      if (!model) return;
      const query = elements.search.value.trim().toLocaleLowerCase();
      const samples = sampledSet();
      const items = reviewItems();
      const phrases = model.phrases.filter((phrase) =>
        matchesSearch(phrase, query)
        && (!elements.category.value || phrase.categoryId === elements.category.value)
        && (!elements.subcategory.value || phrase.subcategory === elements.subcategory.value)
        && (!elements.kind.value || phrase.kind === elements.kind.value)
        && (!elements.sampleOnly.checked || samples.has(phrase.id))
        && (!elements.issueOnly.checked || items[phrase.id]?.decision === "issue")
        && (!elements.hintOnly.checked || hintsFor(phrase).length > 0));
      elements.list.replaceChildren();
      for (const phrase of phrases) elements.list.append(renderPhrase(phrase));
      if (phrases.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "没有符合当前筛选条件的候选句。";
        elements.list.append(empty);
      }
      setText(elements.resultCount, "显示 " + phrases.length + " 条候选句");
    }

    function applyPayload(payload) {
      const phrases = payload.content && Array.isArray(payload.content.phrases)
        ? payload.content.phrases : Array.isArray(payload.phrases) ? payload.phrases : [];
      const items = payload.review && payload.review.items ? payload.review.items : payload.items;
      const sampledIds = payload.review && payload.review.sampledIds ? payload.review.sampledIds : payload.sampledIds;
      const version = payload.content && payload.content.version ? payload.content.version : payload.version;
      const coreCount = payload.report && payload.report.coreCount != null ? payload.report.coreCount : payload.coreCount;
      const totalCount = payload.report && payload.report.totalCount != null ? payload.report.totalCount : payload.totalCount;
      const approvedAt = payload.review && payload.review.approvedAt ? payload.review.approvedAt : payload.approvedAt;
      model = {
        ...payload, phrases, items: items || {}, sampledIds: Array.isArray(sampledIds) ? sampledIds : [],
        version, coreCount, totalCount, approvedAt,
        reportStatus: payload.report && payload.report.status ? payload.report.status : payload.reportStatus,
        gateStatus: payload.gateStatus || (payload.report && payload.report.status === "pass" ? "通过" : "未通过"),
      };
      updateSummary();
      updateFilterOptions();
      renderRows();
    }

    function showError(message) {
      elements.error.textContent = message;
      elements.error.hidden = false;
    }

    async function readJson(response) {
      if (!response.ok) throw new Error("请求失败（" + response.status + "）");
      return response.json();
    }

    async function loadReview() {
      if (loading) return;
      loading = true;
      retryButton.hidden = true;
      elements.error.hidden = true;
      elements.loadStatus.textContent = "正在加载审核数据…";
      try {
        const payload = await readJson(await fetch("/api/review", { headers: { Accept: "application/json" }, credentials: "same-origin" }));
        applyPayload(payload);
        elements.loadStatus.textContent = "审核数据已加载。";
      } catch (error) {
        const detail = error instanceof Error ? error.message : "未知错误";
        showError("加载失败：" + detail);
        elements.loadStatus.textContent = "审核数据未加载。";
        retryButton.hidden = false;
      } finally {
        loading = false;
      }
    }

    async function submitDecision(id, decision, note, rowStatus) {
      if (!model || pendingIds.has(id)) return;
      pendingIds.add(id);
      rowStatus.textContent = "正在保存…";
      rowStatus.setAttribute("role", "status");
      renderRows();
      try {
        const payload = await readJson(await fetch("/api/decision", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ id, decision, note: note.value, candidateSha256: model.candidateSha256 }),
        }));
        pendingIds.delete(id);
        applyPayload(payload);
      } catch (error) {
        pendingIds.delete(id);
        renderRows();
        const current = document.getElementById("note-" + id);
        if (current) current.value = note.value;
        const detail = error instanceof Error ? error.message : "未知错误";
        showError("保存 " + id + " 失败：" + detail);
      }
    }

    async function approveVersion() {
      if (!model || approvalPending || model.canApprove !== true) return;
      const confirmation = window.prompt("请输入要批准的确切版本号：", "");
      if (confirmation !== model.version) {
        if (confirmation !== null) showError("版本号不匹配，未执行批准。");
        return;
      }
      approvalPending = true;
      elements.approve.disabled = true;
      elements.approvalStatus.textContent = "正在批准…";
      elements.error.hidden = true;
      try {
        const payload = await readJson(await fetch("/api/approve", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ version: model.version, candidateSha256: model.candidateSha256 }),
        }));
        approvalPending = false;
        applyPayload(payload);
        elements.approvalStatus.textContent = "版本已批准。";
      } catch (error) {
        approvalPending = false;
        updateSummary();
        const detail = error instanceof Error ? error.message : "未知错误";
        elements.approvalStatus.textContent = "批准失败，可以重试。";
        showError("批准失败：" + detail);
      }
    }

    for (const control of [elements.search, elements.subcategory, elements.kind, elements.sampleOnly, elements.issueOnly, elements.hintOnly]) {
      control.addEventListener("input", renderRows);
      control.addEventListener("change", renderRows);
    }
    elements.category.addEventListener("change", () => { updateSubcategoryOptions(); renderRows(); });
    elements.clear.addEventListener("click", () => {
      elements.search.value = ""; elements.category.value = ""; elements.kind.value = "";
      elements.sampleOnly.checked = true; elements.issueOnly.checked = false; elements.hintOnly.checked = false;
      updateSubcategoryOptions(); elements.subcategory.value = ""; renderRows();
    });
    retryButton.addEventListener("click", loadReview);
    elements.approve.addEventListener("click", approveVersion);
    loadReview();
  </script>
</body>
</html>`;
}
