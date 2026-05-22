const header = document.querySelector(".site-header");

function syncHeader() {
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 24);
}

syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

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
    if (button) button.disabled = true;

    try {
      const html = await decryptPrivatePayload(payload, String(password || ""));
      content.innerHTML = html;
      content.hidden = false;
      panel.hidden = true;
    } catch (error) {
      status.textContent =
        error && error.message === "UNSUPPORTED_CRYPTO"
          ? "当前浏览器环境不支持安全解密，请使用 HTTPS 地址或现代浏览器。"
          : "密码不正确，请再试一次。";
      if (button) button.disabled = false;
    }
  });
});
