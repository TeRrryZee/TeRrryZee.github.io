(function initStudio() {
  const root = document.querySelector("[data-studio]");
  if (!root) return;

  const fields = {
    title: root.querySelector('[data-field="title"]'),
    date: root.querySelector('[data-field="date"]'),
    category: root.querySelector('[data-field="category"]'),
    tags: root.querySelector('[data-field="tags"]'),
    slug: root.querySelector('[data-field="slug"]'),
    private: root.querySelector('[data-field="private"]'),
    body: root.querySelector('[data-field="body"]'),
  };
  const status = root.querySelector("[data-status]");
  const support = root.querySelector("[data-support]");
  const preview = root.querySelector("[data-preview]");
  const actionButtons = root.querySelectorAll("[data-action]");
  const hasFileSystemAccess =
    typeof window.showOpenFilePicker === "function" &&
    typeof window.showSaveFilePicker === "function";

  let fileHandle = null;
  let currentFileName = "";
  let dirty = false;
  let slugEdited = false;

  function setStatus(message, tone) {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone || "";
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function datetimeLocalNow() {
    const now = new Date();
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
    ].join("-") + "T" + [pad(now.getHours()), pad(now.getMinutes())].join(":");
  }

  function dateForFrontMatter(value) {
    if (!value) return "";
    const normalized = value.replace("T", " ");
    return normalized.length === 16 ? normalized + ":00" : normalized;
  }

  function localValueFromDate(value) {
    if (!value) return datetimeLocalNow();
    const normalized = value.trim().replace(" ", "T");
    return normalized.slice(0, 16);
  }

  function stripYamlQuotes(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return trimmed.slice(1, -1);
      }
    }
    if (
      trimmed.startsWith("'") && trimmed.endsWith("'")
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function yamlScalar(value) {
    const text = String(value || "").trim().replace(/\r?\n/g, " ");
    if (!text) return '""';
    if (/[:#\[\]{},&*!|>'"%@`]/.test(text) || /^[-?]/.test(text) || /^(true|false|null|yes|no|on|off)$/i.test(text)) {
      return JSON.stringify(text);
    }
    return text;
  }

  function slugify(value) {
    const text = String(value || "")
      .trim()
      .replace(/[\\/:*?"<>|#%{}^~[\]`;\s]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return text || "untitled-post";
  }

  function splitList(value) {
    return String(value || "")
      .split(/[,\uFF0C]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function parseList(lines, key) {
    const keyPattern = new RegExp("^" + key + ":\\s*(.*)$");
    const startIndex = lines.findIndex((line) => keyPattern.test(line));
    if (startIndex < 0) return [];

    const direct = keyPattern.exec(lines[startIndex]);
    const value = direct ? direct[1].trim() : "";
    if (value.startsWith("[") && value.endsWith("]")) {
      return value
        .slice(1, -1)
        .split(",")
        .map(stripYamlQuotes)
        .filter(Boolean);
    }
    if (value) return [stripYamlQuotes(value)];

    const result = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^[A-Za-z_][\w-]*:/.test(line)) break;
      const item = /^\s*-\s*(.*)$/.exec(line);
      if (item) result.push(stripYamlQuotes(item[1]));
    }
    return result.filter(Boolean);
  }

  function parseMarkdownDocument(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    if (!match) {
      return {
        meta: {},
        body: text,
      };
    }

    const yaml = match[1];
    const lines = yaml.split(/\r?\n/);
    const scalar = (key) => {
      const line = lines.find((item) => new RegExp("^" + key + ":\\s*").test(item));
      if (!line) return "";
      return stripYamlQuotes(line.replace(new RegExp("^" + key + ":\\s*"), ""));
    };

    return {
      meta: {
        title: scalar("title"),
        date: scalar("date"),
        category: parseList(lines, "categories")[0] || scalar("category"),
        tags: parseList(lines, "tags"),
        private: scalar("private") === "true",
      },
      body: match[2],
    };
  }

  function makeFrontMatter() {
    const tags = splitList(fields.tags.value);
    const dateValue = dateForFrontMatter(fields.date.value);
    const lines = [
      "---",
      "title: " + yamlScalar(fields.title.value),
      "date: " + (dateValue || '""'),
    ];

    const category = fields.category.value.trim();
    if (category) {
      lines.push("categories:", "  - " + yamlScalar(category));
    }

    if (tags.length) {
      lines.push("tags:");
      tags.forEach((tag) => lines.push("  - " + yamlScalar(tag)));
    }

    if (fields.private.checked) {
      lines.push("private: true", "private_group: private");
    }

    lines.push("---", "");
    return lines.join("\n");
  }

  function makeDocument() {
    return makeFrontMatter() + fields.body.value.trimStart().replace(/\s*$/, "\n");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderInline(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }

  function renderMarkdown(markdown) {
    const blocks = String(markdown || "").replace(/\r\n/g, "\n").split(/\n{2,}/);
    if (!markdown.trim()) {
      return '<p class="studio-preview-empty">开始写正文后，这里会出现预览。</p>';
    }

    return blocks
      .map((block) => {
        const text = block.trim();
        if (!text) return "";
        const fence = /^```([\s\S]*)```$/.exec(text);
        if (fence) return "<pre><code>" + escapeHtml(fence[1].trim()) + "</code></pre>";
        const heading = /^(#{1,3})\s+(.+)$/.exec(text);
        if (heading) {
          const level = heading[1].length + 1;
          return "<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">";
        }
        if (/^>\s?/.test(text)) {
          return "<blockquote>" + renderInline(text.replace(/^>\s?/gm, "")).replace(/\n/g, "<br>") + "</blockquote>";
        }
        if (/^-\s+/.test(text)) {
          const items = text
            .split("\n")
            .filter((line) => /^-\s+/.test(line))
            .map((line) => "<li>" + renderInline(line.replace(/^-\s+/, "")) + "</li>")
            .join("");
          return "<ul>" + items + "</ul>";
        }
        return "<p>" + renderInline(text).replace(/\n/g, "<br>") + "</p>";
      })
      .join("");
  }

  function refreshPreview() {
    if (!preview) return;
    preview.innerHTML = renderMarkdown(fields.body.value);
  }

  function setDocument(document, fileName) {
    const parsed = parseMarkdownDocument(document);
    fields.title.value = parsed.meta.title || "";
    fields.date.value = localValueFromDate(parsed.meta.date);
    fields.category.value = parsed.meta.category || "";
    fields.tags.value = (parsed.meta.tags || []).join(", ");
    fields.private.checked = Boolean(parsed.meta.private);
    fields.body.value = parsed.body || "";
    currentFileName = fileName || "";
    fields.slug.value = currentFileName ? currentFileName.replace(/\.md$/i, "") : slugify(fields.title.value);
    slugEdited = Boolean(currentFileName);
    dirty = false;
    refreshPreview();
    setStatus(currentFileName ? "已打开：" + currentFileName : "新文章已准备好。", "ok");
  }

  function newDocument() {
    if (dirty && !window.confirm("当前文章还没保存，要放弃这些改动吗？")) return;
    fileHandle = null;
    const title = "未命名文章";
    setDocument(
      [
        "---",
        "title: " + title,
        "date: " + dateForFrontMatter(datetimeLocalNow()),
        "categories:",
        "  - 随笔",
        "---",
        "",
        "",
      ].join("\n"),
      ""
    );
    fields.title.focus();
    fields.title.select();
  }

  async function openMarkdown() {
    if (!hasFileSystemAccess) {
      setStatus("当前浏览器不支持直接打开本地文件。可以使用 Chrome 或 Edge 的 localhost 预览。", "warn");
      return;
    }
    if (dirty && !window.confirm("当前文章还没保存，要先放弃这些改动并打开新文件吗？")) return;

    try {
      const handles = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Markdown",
            accept: { "text/markdown": [".md", ".markdown"] },
          },
        ],
      });
      fileHandle = handles[0];
      const file = await fileHandle.getFile();
      setDocument(await file.text(), file.name);
    } catch (error) {
      if (error && error.name !== "AbortError") {
        setStatus("打开失败：" + error.message, "warn");
      }
    }
  }

  function downloadMarkdown() {
    const name = slugify(fields.slug.value || fields.title.value) + ".md";
    const blob = new Blob([makeDocument()], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    setStatus("已下载副本：" + name, "ok");
  }

  async function saveMarkdown() {
    const documentText = makeDocument();
    if (!hasFileSystemAccess) {
      downloadMarkdown();
      setStatus("当前浏览器不支持直接保存，已改为下载 Markdown 副本。", "warn");
      return;
    }

    try {
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: slugify(fields.slug.value || fields.title.value) + ".md",
          types: [
            {
              description: "Markdown",
              accept: { "text/markdown": [".md"] },
            },
          ],
        });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(documentText);
      await writable.close();
      currentFileName = fileHandle.name || currentFileName;
      dirty = false;
      setStatus("已保存：" + (currentFileName || fields.slug.value + ".md"), "ok");
    } catch (error) {
      if (error && error.name !== "AbortError") {
        setStatus("保存失败：" + error.message, "warn");
      }
    }
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(makeDocument());
      setStatus("Markdown 已复制到剪贴板。", "ok");
    } catch (error) {
      setStatus("复制失败，可以用下载副本或手动全选复制。", "warn");
    }
  }

  function markDirty() {
    dirty = true;
    refreshPreview();
    if (!slugEdited) fields.slug.value = slugify(fields.title.value);
  }

  Object.entries(fields).forEach(([name, field]) => {
    if (!field) return;
    field.addEventListener("input", () => {
      if (name === "slug") slugEdited = true;
      markDirty();
    });
    field.addEventListener("change", markDirty);
  });

  actionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "new") newDocument();
      if (action === "open") openMarkdown();
      if (action === "save") saveMarkdown();
      if (action === "copy") copyMarkdown();
      if (action === "download") downloadMarkdown();
    });
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveMarkdown();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (support) {
    support.textContent = hasFileSystemAccess
      ? "当前浏览器支持直接保存本地 Markdown。"
      : "当前浏览器会使用下载副本保存。Chrome / Edge 的 localhost 预览可直接写回文件。";
    support.dataset.ready = hasFileSystemAccess ? "true" : "false";
  }

  newDocument();
})();
