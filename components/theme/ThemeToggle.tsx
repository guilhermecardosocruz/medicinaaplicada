"use client";

export function ThemeToggle() {
  function toggle() {
    const isLight = document.documentElement.classList.toggle("light");
    localStorage.setItem("theme", isLight ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-full border border-[var(--border)] bg-card px-3 py-1.5 text-xs font-semibold text-app hover:opacity-80"
      aria-label="Alternar tema"
    >
      Tema
    </button>
  );
}
