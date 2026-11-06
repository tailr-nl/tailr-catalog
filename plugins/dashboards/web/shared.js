/* Schermhelpers; alle vertalingen komen via dezelfde laag als de Tailr-shell. */
(() => {
    const host = () => window.parent.tailr;
    const t = (key, vars = {}) => host()?.t(key, vars) ?? key.replace(/\{(\w+)\}/g, (all, name) => vars[name] ?? all);
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const text = (value) => typeof value === "object" && value ? value[host()?.locale] || value.en || value.nl || "" : value || "";
    const name = (tool) => text(tool.title) || tool.name.split("__").pop().replaceAll("_", " ");
    const call = (path, init) => host() ? host().api(path, init) : fetch(path, { credentials: "same-origin", method: init?.method ?? (init?.body ? "POST" : "GET"), headers: { "content-type": "application/json" }, body: init?.body ? JSON.stringify(init.body) : undefined }).then(async (res) => { const data = await res.json(); if (!res.ok)
        throw Object.assign(new Error(data.error?.message ?? data.error ?? res.status), { body: data }); return data; });
    const toast = (kind, message) => host()?.toast[kind](message);
    const when = (at) => host()?.formatDateTime?.(at) ?? (at ? new Date(at).toLocaleString(host()?.locale ?? "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
    const theme = () => window.parent.document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    document.documentElement.lang = host()?.locale ?? "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape")
        document.querySelectorAll("details.db-menu[open]").forEach((el) => { el.open = false; el.querySelector("summary").focus(); }); });
    document.addEventListener("pointerdown", (e) => document.querySelectorAll("details.db-menu[open]").forEach((el) => { if (!el.contains(e.target))
        el.open = false; }));
    window.DashboardUI = { t, esc, text, name, call, toast, when, theme };
})();
