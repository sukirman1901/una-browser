document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-password-toggle]");
  if (!button) return;
  const input = document.getElementById(button.dataset.passwordToggle);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.setAttribute("aria-pressed", String(show));
  button.textContent = show ? "Hide" : "Show";
  input.focus();
});

document.querySelectorAll("form").forEach((form) => {
  let busy = false;
  form.addEventListener("submit", (event) => {
    if (busy) { event.preventDefault(); return; }
    busy = true;
    const button = event.submitter;
    if (button) button.setAttribute("aria-busy", "true");
  });
});
