const contact = document.querySelector("#support-contact");
if (contact) {
  fetch("/api/config").then(r => r.ok ? r.json() : null).then(config => {
    if (!config?.supportEmail) return;
    const link = document.createElement("a");
    link.href = "mailto:" + encodeURIComponent(config.supportEmail);
    link.textContent = config.supportEmail;
    contact.replaceChildren("Email the project support contact: ",link);
  }).catch(() => {});
}
