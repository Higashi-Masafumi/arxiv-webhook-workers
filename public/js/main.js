document.addEventListener("DOMContentLoaded", () => {
  // Initialize copy buttons
  const copyButtons = document.querySelectorAll(".btn-copy");
  copyButtons.forEach((btn) => {
    btn.addEventListener("click", handleCopy);
  });

  // Check URL parameters for success page
  if (window.location.pathname.includes("success.html")) {
    const params = new URLSearchParams(window.location.search);
    const databaseId = params.get("database_id");
    const workerUrl = params.get("worker_url");

    if (databaseId) {
      const dbLink = document.getElementById("database-link");
      if (dbLink) {
        dbLink.href = `https://notion.so/${databaseId.replace(/-/g, "")}`;
      }
    }

    if (workerUrl) {
      const webhookUrl = `${workerUrl}/notion/webhook`;
      const urlElement = document.getElementById("webhook-url");
      if (urlElement) {
        urlElement.textContent = webhookUrl;
      }
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
