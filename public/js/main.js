document.addEventListener("DOMContentLoaded", () => {
  // Initialize copy buttons
  const copyButtons = document.querySelectorAll(".btn-copy");
  copyButtons.forEach((btn) => {
    btn.addEventListener("click", handleCopy);
  });

  // Check for success page elements
  const dbLink = document.getElementById("database-link");
  const urlElement = document.getElementById("webhook-url");

  if (dbLink || urlElement) {
    const params = new URLSearchParams(window.location.search);
    const databaseId = params.get("database_id");
    const workerUrl = params.get("worker_url");

    // データベースリンクの設定
    if (databaseId && dbLink) {
      // NotionのURL形式: https://notion.so/{database_id_without_hyphens}
      const notionDatabaseId = databaseId.replace(/-/g, "");
      dbLink.href = `https://notion.so/${notionDatabaseId}`;
    } else if (dbLink) {
      // database_idが取得できない場合はリンクを無効化
      dbLink.style.opacity = "0.5";
      dbLink.style.pointerEvents = "none";
      dbLink.textContent = "データベースIDが見つかりません";
    }

    // Webhook URLの設定
    if (workerUrl && urlElement) {
      const webhookUrl = `${workerUrl}/notion/webhook`;
      urlElement.textContent = webhookUrl;
    } else if (urlElement) {
      // worker_urlが取得できない場合は現在のオリジンから推測
      const currentOrigin = window.location.origin;
      const webhookUrl = `${currentOrigin}/notion/webhook`;
      urlElement.textContent = webhookUrl;
      console.warn("worker_url parameter not found, using current origin");
    }
  }
});

async function handleCopy(e) {
  const btn = e.currentTarget;
  const targetId = btn.dataset.target;
  const targetElement = document.getElementById(targetId);

  if (!targetElement) return;

  const textToCopy = targetElement.textContent.trim();

  try {
    await navigator.clipboard.writeText(textToCopy);
    showToast("コピーしました！");
  } catch (err) {
    console.error("Failed to copy:", err);
    showToast("コピーに失敗しました");
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger reflow
  toast.offsetHeight;

  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      document.body.removeChild(toast);
    }, 300);
  }, 2000);
}
