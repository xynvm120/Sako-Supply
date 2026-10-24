try {
  const preference = localStorage.getItem("sako-theme");
  document.documentElement.dataset.theme = ["light", "dark"].includes(
    preference,
  )
    ? preference
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
} catch {
  document.documentElement.dataset.theme = matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches
    ? "dark"
    : "light";
}
