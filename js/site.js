const root = document.documentElement;
const header = document.querySelector(".site-header");
const nav = document.querySelector(".nav");

/* Header shadow on scroll + reading progress */
const progress = document.querySelector("[data-read-progress]");
const articleBody = document.querySelector(".article-body");

function onScroll() {
  if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
  if (progress && articleBody) {
    const rect = articleBody.getBoundingClientRect();
    const total = rect.height - window.innerHeight * 0.6;
    const ratio = total > 0 ? Math.min(Math.max(-rect.top / total, 0), 1) : 1;
    progress.style.transform = `scaleX(${ratio})`;
  }
}

onScroll();
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);

/* Local writing studio nav entry on localhost */
const localHostnames = new Set(["", "localhost", "127.0.0.1", "::1"]);
if (nav && localHostnames.has(window.location.hostname)) {
  const studioLink = document.createElement("a");
  studioLink.href = "/studio/";
  studioLink.textContent = "写作台";
  if (window.location.pathname.indexOf("/studio/") === 0) {
    studioLink.className = "is-active";
    studioLink.setAttribute("aria-current", "page");
  }
  nav.appendChild(studioLink);
}

/* Theme toggle */
const themeToggle = document.querySelector("[data-theme-toggle]");
if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (error) {
      /* storage unavailable */
    }
  });
}

/* Mobile navigation */
const navToggle = document.querySelector("[data-nav-toggle]");
if (navToggle && header) {
  const setOpen = (open) => {
    header.classList.toggle("nav-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
  };
  navToggle.addEventListener("click", () => setOpen(!header.classList.contains("nav-open")));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  window.matchMedia("(min-width: 721px)").addEventListener("change", () => setOpen(false));
}

/* Private content decryption */
const privatePosts = document.querySelectorAll("[data-private-post]");

function base64ToBytes(value) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function decryptPrivatePayload(payload, password) {
  if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === "undefined") {
    throw new Error("UNSUPPORTED_CRYPTO");
  }

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(payload.salt),
      iterations: payload.iterations,
      hash: payload.hash,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return textDecoder.decode(decrypted);
}

privatePosts.forEach((privatePost) => {
  const form = privatePost.querySelector("[data-private-form]");
  const panel = privatePost.querySelector(".private-post-panel");
  const status = privatePost.querySelector("[data-private-status]");
  const content = privatePost.querySelector("[data-private-content]");
  const payloadNode = privatePost.querySelector("[data-private-payload]");
  if (!form || !panel || !status || !content || !payloadNode) return;

  const payload = JSON.parse(payloadNode.textContent);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = new FormData(form).get("password");
    const button = form.querySelector("button");
    status.textContent = "正在解锁...";
    status.classList.remove("is-error");
    if (button) button.disabled = true;

    try {
      const html = await decryptPrivatePayload(payload, String(password || ""));
      content.innerHTML = html;
      content.hidden = false;
      panel.hidden = true;
    } catch (error) {
      status.classList.add("is-error");
      status.textContent =
        error && error.message === "UNSUPPORTED_CRYPTO"
          ? "当前浏览器环境不支持安全解密，请使用 HTTPS 地址或现代浏览器。"
          : "密码不正确，请再试一次。";
      if (button) button.disabled = false;
    }
  });
});

/* Header search panel */
(function initSearch() {
  const toggle = document.querySelector(".search-toggle");
  const panel = document.getElementById("search-panel");
  if (!toggle || !panel) return;

  const input = panel.querySelector(".search-input");
  const results = panel.querySelector(".search-results");
  const empty = panel.querySelector(".search-empty");
  const searchUrl = toggle.dataset.searchUrl || "/search.xml";
  let index = null;
  let indexPromise = null;

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (!indexPromise) {
      indexPromise = fetch(searchUrl)
        .then((res) => (res.ok ? res.text() : ""))
        .then((xmlText) => {
          const doc = new DOMParser().parseFromString(xmlText, "application/xml");
          index = Array.from(doc.querySelectorAll("entry")).map((entry) => {
            const titleNode = entry.querySelector("title");
            const urlNode = entry.querySelector("url");
            const linkNode = entry.querySelector("link");
            const contentNode = entry.querySelector("content");
            return {
              title: titleNode ? titleNode.textContent : "",
              url: urlNode
                ? urlNode.textContent
                : linkNode
                  ? linkNode.getAttribute("href") || ""
                  : "",
              content: contentNode
                ? contentNode.textContent
                    .replace(/<[^>]+>/g, " ")
                    .replace(/\s+/g, " ")
                    .trim()
                : "",
            };
          });
          return index;
        })
        .catch(() => {
          index = [];
          return index;
        });
    }
    return indexPromise;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function snippet(text, query) {
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) return text.slice(0, 80);
    const start = Math.max(0, at - 24);
    const end = Math.min(text.length, at + query.length + 48);
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }

  function renderResults(query) {
    const q = query.trim();
    results.textContent = "";
    if (!q) {
      empty.hidden = true;
      return;
    }
    const ql = q.toLowerCase();
    const matches = index
      .map((entry) => {
        const titleAt = entry.title.toLowerCase().indexOf(ql);
        const contentAt = entry.content.toLowerCase().indexOf(ql);
        if (titleAt < 0 && contentAt < 0) return null;
        return { entry, titleAt };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const rank = (item) => (item.titleAt >= 0 ? 0 : 1);
        return rank(a) - rank(b) || a.titleAt - b.titleAt;
      })
      .slice(0, 8);

    empty.hidden = matches.length > 0;
    matches.forEach(({ entry }) => {
      const item = document.createElement("a");
      item.className = "search-result";
      item.href = entry.url;
      item.setAttribute("role", "option");
      item.innerHTML =
        `<strong>${escapeHtml(entry.title)}</strong>` +
        `<span>${escapeHtml(snippet(entry.content, q))}</span>`;
      results.appendChild(item);
    });
  }

  let debounceTimer = null;
  function open() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.classList.add("is-open");
    loadIndex().then(() => renderResults(input.value));
    input.focus();
  }

  function close() {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.remove("is-open");
  }

  toggle.addEventListener("click", () => {
    if (panel.hidden) open();
    else close();
  });

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderResults(input.value), 120);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = results.querySelector("a");
      if (first) window.location.href = first.href;
    } else if (event.key === "Escape") {
      close();
    }
  });

  document.addEventListener("click", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) {
      close();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  });
})();
