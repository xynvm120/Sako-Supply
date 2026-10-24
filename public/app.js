const $ = (s) => document.querySelector(s);
const themeMedia = matchMedia("(prefers-color-scheme: dark)");
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark";
  $("#theme-toggle").setAttribute("aria-pressed", String(dark));
  $("#theme-toggle").setAttribute(
    "aria-label",
    dark ? "Switch to light mode" : "Switch to dark mode",
  );
  $("#theme-label").textContent = dark ? "Light" : "Dark";
}
applyTheme(
  document.documentElement.dataset.theme ||
    (themeMedia.matches ? "dark" : "light"),
);
$("#theme-toggle").onclick = () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  try {
    localStorage.setItem("sako-theme", theme);
  } catch {}
};
themeMedia.addEventListener("change", (event) => {
  try {
    if (["light", "dark"].includes(localStorage.getItem("sako-theme"))) return;
  } catch {}
  applyTheme(event.matches ? "dark" : "light");
});
const money = (n) =>
  "₱" +
  Number(n).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (s) =>
  new Date(s).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
const badge = (s) =>
  `<span class="badge ${s === "Cancelled" ? "danger" : s === "Completed" || s === "Paid" || s === "Demo paid" ? "good" : ""}">${esc(s)}</span>`;
const paymentName = (m) =>
  ({
    cash: "Cash",
    card: "Card (demo)",
    gcash: "GCash (demo)",
    maya: "Maya (demo)",
  })[m] || m;
let products = [],
  filter = "all",
  cart = {},
  user = null,
  isAdmin = false,
  orders = [],
  config = { deliveryFee: 150 },
  adminTab = "overview",
  adminOrders = [],
  adminData = null;
let map = null,
  marker = null,
  trackingTimer = null;
try {
  cart = JSON.parse(localStorage.getItem("sako-cart") || "{}");
  if (!cart || Array.isArray(cart) || typeof cart !== "object") cart = {};
} catch {
  cart = {};
}
async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Request failed");
  return d;
}
const post = (url, data, method = "POST") =>
  api(url, { method, body: JSON.stringify(data) });
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
function show(id) {
  if (!$(id).open) $(id).showModal();
}
function save() {
  try {
    localStorage.setItem("sako-cart", JSON.stringify(cart));
  } catch {}
  $("#cart-count").textContent = Object.values(cart).reduce((a, b) => a + b, 0);
}
function accountLabel() {
  $("#account-link").textContent = isAdmin
    ? "Admin account"
    : user
      ? `Hi, ${user.name.split(" ")[0]}`
      : "Sign in";
  $("#admin-link").hidden = !isAdmin;
  $("#orders-link").hidden = !user;
  $("#welcome-title").textContent = user
    ? `Fresh picks for you, ${user.name.split(" ")[0]}.`
    : "A little closer to the harvest.";
}
function sack(p) {
  if (p.image)
    return `<img class="rice-photo" src="${esc(p.image)}" alt="${esc(p.name)} 25 kg rice sack">`;
  return `<div class="mini-sack" style="--sack-color:${p.name === "Jasmine" ? "#6d5639" : p.name === "Brown rice" ? "#8a4f2c" : "#164d37"}"><strong>sako✳</strong><span class="rice-name">${esc(p.name)}</span><i>❧</i><small>25 KG WHOLESALE RICE</small><b>25 kg</b></div>`;
}
function render() {
  let list = products.filter(
    (p) =>
      (filter === "all" ||
        p.tag === filter ||
        (filter === "Premium" && p.tag === "Bestseller")) &&
      `${p.name} ${p.variety}`
        .toLowerCase()
        .includes($("#search").value.toLowerCase()),
  );
  if ($("#sort").value === "price") list.sort((a, b) => a.price - b.price);
  if ($("#sort").value === "price-desc") list.sort((a, b) => b.price - a.price);
  $("#result-count").textContent = `${list.length} wholesale rice selections`;
  $("#products").innerHTML = list.length
    ? list
        .map(
          (p) =>
            `<article class="product"><button class="product-art" data-detail="${p.id}" aria-label="View ${esc(p.name)} details"><span class="tag">${esc(p.tag)}</span>${sack(p)}<span class="weight">VIEW RICE DETAILS →</span></button><div class="product-title"><button class="product-name" data-detail="${p.id}">${esc(p.name)}</button><span>25 kg</span></div><p>${esc(p.variety)}</p><div class="price-row"><span class="price">${money(p.price)} <small>/ sack</small></span><button class="add" data-add="${p.id}" aria-label="Add ${esc(p.name)} to bag" ${p.stock === 0 ? "disabled" : ""}>+</button></div><div class="stock">${p.stock > 0 ? `● ${p.stock} sacks available` : "Out of stock"}</div></article>`,
        )
        .join("")
    : '<p class="empty">No rice matches your search. Try another variety.</p>';
}
async function refresh() {
  products = await api("/api/products");
  let adjusted = false;
  for (const id of Object.keys(cart)) {
    const p = products.find((x) => x.id === +id);
    if (!p || !Number.isInteger(cart[id]) || cart[id] < 1) {
      delete cart[id];
      adjusted = true;
    } else if (cart[id] > p.stock) {
      if (p.stock) cart[id] = p.stock;
      else delete cart[id];
      adjusted = true;
    }
  }
  save();
  render();
  if (adjusted) toast("Your bag was updated to match available 25 kg stock.");
}
function add(id, quantity = 1) {
  const p = products.find((p) => p.id === +id);
  if (!p || !Number.isInteger(quantity) || quantity < 1) return;
  if ((cart[p.id] || 0) + quantity > p.stock)
    return toast("That quantity exceeds available stock.");
  cart[p.id] = (cart[p.id] || 0) + quantity;
  save();
  toast(`${quantity} sack${quantity > 1 ? "s" : ""} of ${p.name} added`);
}
function productView(id) {
  const p = products.find((p) => p.id === +id);
  if (!p) return;
  $("#product-content").innerHTML =
    `<div class="detail-product"><div class="product-art">${sack(p)}</div><div><div class="eyebrow">${esc(p.tag)} · 25 KG SACK</div><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><p class="price">${money(p.price)} <small>per 25 kg sack</small></p><p>${p.stock} sacks available · ${p.stock * 25} kg</p><form id="detail-add"><label>Number of sacks<input type="number" name="quantity" value="1" min="1" max="${p.stock}" required></label><button class="primary checkout-button" ${p.stock ? "" : "disabled"}>Add to bag →</button></form></div></div><div class="detail-notes"><div><h3>Texture & character</h3><p>${esc(p.texture)}</p></div><div><h3>Cooking notes</h3><p>${esc(p.cooking)}</p></div></div><p class="form-note">Rice type / retail description, not a commercial brand claim. Philippine-market sample listing. Price, origin, and stock require supplier confirmation. Store in a cool, dry place.</p>`;
  $("#detail-add").onsubmit = (e) => {
    e.preventDefault();
    add(p.id, Number(new FormData(e.target).get("quantity")));
  };
  show("#product-dialog");
}
$("#products").onclick = (e) => {
  const d = e.target.closest("[data-detail]"),
    a = e.target.closest("[data-add]");
  if (d) productView(d.dataset.detail);
  if (a) add(a.dataset.add);
};
$("#filters").onclick = (e) => {
  if (!e.target.dataset.filter) return;
  filter = e.target.dataset.filter;
  document
    .querySelectorAll("[data-filter]")
    .forEach((b) => b.classList.toggle("selected", b === e.target));
  render();
};
$("#search").oninput = render;
$("#sort").onchange = render;
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  }),
);
function authView(mode = "login") {
  show("#account-dialog");
  $("#account-title").textContent = user ? "Your account" : "Welcome to Sako";
  if (user) {
    $("#account-content").innerHTML =
      `<p>${esc(user.email)}</p><form id="profile"><div class="form-grid"><label>Full name<input name="name" value="${esc(user.name)}" required maxlength="150" autocomplete="name"></label><label>Mobile number<input name="phone" value="${esc(user.phone)}" required pattern="[+0-9 -]{10,16}" autocomplete="tel"></label><label class="wide">Default delivery address<textarea name="address" maxlength="500" autocomplete="street-address">${esc(user.address)}</textarea></label></div><button class="primary checkout-button">Save profile</button><p id="profile-error" role="alert"></p></form><button id="customer-logout" class="secondary">Log out</button>`;
    $("#profile").onsubmit = async (e) => {
      e.preventDefault();
      try {
        user = (
          await post(
            "/api/profile",
            Object.fromEntries(new FormData(e.target)),
            "PATCH",
          )
        ).user;
        accountLabel();
        toast("Profile saved");
      } catch (e) {
        $("#profile-error").textContent = e.message;
      }
    };
    $("#customer-logout").onclick = async () => {
      try {
        await post("/api/logout", {});
        user = null;
        isAdmin = false;
        accountLabel();
        $("#account-dialog").close();
        $("#orders-dialog").close();
        $("#detail-dialog").close();
        $("#receipt-dialog").close();
        $("#orders-content").innerHTML = "";
        $("#detail-content").innerHTML = "";
        $("#receipt-content").innerHTML = "";
        orders = [];
        toast("You are logged out");
      } catch (e) {
        toast(e.message);
      }
    };
    return;
  }
  $("#account-content").innerHTML =
    `<div class="auth-intro"><span class="eyebrow">WELCOME TO YOUR ONLINE BIGASAN</span><h3>Good rice. Great company.</h3><p>One sign-in for customers and store administrators.</p></div><div class="tabs"><button id="login-tab" class="${mode === "login" ? "chosen" : ""}">Sign in</button><button id="register-tab" class="${mode === "register" ? "chosen" : ""}">Create account</button></div><p>Order 25 kg sacks and keep all your receipts in one place.</p><form id="customer-auth">${mode === "register" ? '<label>Full name<input name="name" autocomplete="name" required maxlength="150"></label>' : ""}<label>Email address<input name="email" type="email" autocomplete="email" required maxlength="254"></label><label>Password<input name="password" type="password" autocomplete="${mode === "register" ? "new-password" : "current-password"}" minlength="8" maxlength="128" required></label><p class="form-note">${mode === "register" ? "Use at least 8 characters. For this demo, use fictional contact information." : "Welcome back. Your orders are saved to your account."}</p><button class="primary checkout-button">${mode === "register" ? "Create account" : "Sign in"} →</button><p id="auth-error" role="alert"></p></form>`;
  $("#login-tab").onclick = () => authView("login");
  $("#register-tab").onclick = () => authView("register");
  $("#customer-auth").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      const result = await post(
        "/api/auth/" + mode,
        Object.fromEntries(new FormData(e.target)),
      );
      user = result.user;
      isAdmin = result.admin === true;
      accountLabel();
      $("#account-dialog").close();
      toast(mode === "register" ? "Your account is ready" : "Welcome back");
      if (isAdmin) {
        $("#cart-dialog").close();
        await adminView("overview");
      } else if ($("#cart-dialog").open) cartView();
    } catch (e) {
      $("#auth-error").textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
}
$("#account-link").onclick = () =>
  isAdmin ? adminView("overview") : authView();
function cartView() {
  const items = products.filter((p) => cart[p.id]);
  const sub = items.reduce((a, p) => a + p.price * cart[p.id], 0),
    count = items.reduce((a, p) => a + cart[p.id], 0);
  $("#cart-content").innerHTML = items.length
    ? `<div class="demo-notice">DEFENSE DEMO · No real payments or deliveries</div>${items.map((p) => `<div class="cart-row"><div><b>${esc(p.name)} · 25 kg</b><small>${money(p.price)} per sack</small></div><div class="quantity"><button data-change="${p.id}" data-delta="-1" aria-label="Decrease quantity">−</button><input class="cart-qty" data-quantity="${p.id}" aria-label="Sacks of ${esc(p.name)}" type="number" min="1" max="${p.stock}" value="${cart[p.id]}"><button data-change="${p.id}" data-delta="1" aria-label="Increase quantity">+</button></div><b>${money(p.price * cart[p.id])}</b><button class="remove" data-remove="${p.id}" aria-label="Remove ${esc(p.name)}">×</button></div>`).join("")}<p class="form-note">${count} sacks · ${count * 25} kg total. Every listed package is a 25 kg sack.</p>${user ? `<form id="checkout"><h3>Where’s your next good meal?</h3><div class="form-grid"><label>Full name<input name="customer" value="${esc(user.name)}" autocomplete="name" required maxlength="150"></label><label>Mobile number<input name="phone" value="${esc(user.phone)}" type="tel" autocomplete="tel" placeholder="09XXXXXXXXX" required pattern="[+0-9 -]{10,16}"></label><label class="wide">Receive your order<select name="method" id="method" required><option value="" selected disabled>Choose delivery or pickup</option><option value="delivery">Local delivery + tracking · ${money(config.deliveryFee)} demo fee</option><option value="pickup">Store pickup · Free · No delivery map</option></select></label><div class="fulfillment-hint wide" id="fulfillment-hint">Choose <b>Local delivery</b> for a delivery map, or <b>Store pickup</b> to collect your sacks yourself.</div><label class="wide" id="address-label" hidden>Delivery address<textarea name="address" maxlength="500" autocomplete="street-address">${esc(user.address)}</textarea></label><label class="wide">Payment method<select name="payment_method" id="payment-method"><option value="cash">Cash on pickup / delivery</option><option value="card">Card · Simulation</option><option value="gcash">GCash · Simulation</option><option value="maya">Maya · Simulation</option></select></label></div><div id="payment-fields"></div><div class="total"><span>Total <small id="delivery-note"></small></span><b id="checkout-total">${money(sub)}</b></div><p class="form-note">Stock is reserved after a successful order. The ${money(config.deliveryFee)} flat delivery fee is a sample rate; delivery coverage and bulk freight pricing require store confirmation.</p><button class="primary checkout-button" type="submit">Place demo order →</button><p id="checkout-error" role="alert"></p></form>` : '<div class="empty"><h3>Keep your orders in one place.</h3><p>Sign in or create an account to check out.</p><button class="primary" id="checkout-signin">Sign in to order →</button></div>'}`
    : '<div class="empty"><h3>Your bag is waiting for something good.</h3><p>Add your favorite 25 kg sacks to get started.</p><button class="primary" id="continue-shopping">Explore the rice collection →</button></div>';
  if (!items.length) {
    $("#continue-shopping").onclick = () => $("#cart-dialog").close();
    return;
  }
  if (!user) {
    $("#checkout-signin").onclick = () => authView();
    return;
  }
  $("#method").onchange = () => {
    const d = $("#method").value === "delivery";
    $("#address-label").hidden = !d;
    $("#address-label textarea").required = d;
    $("#checkout-total").textContent = money(
      sub + (d ? config.deliveryFee : 0),
    );
    $("#delivery-note").textContent = d ? "(delivery included)" : "";
    $("#fulfillment-hint").textContent = d
      ? "Delivery selected: your map appears immediately; the demo truck moves after the admin dispatches your order."
      : "Pickup selected: collect your sacks from the store. There is no delivery journey to track.";
  };
  $("#payment-method").onchange = paymentFields;
  $("#checkout").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button[type=submit]");
    button.disabled = true;
    $("#checkout-error").textContent = "";
    try {
      const data = Object.fromEntries(new FormData(e.target));
      const method = data.payment_method;
      if (method === "card") {
        const number = $("#demo-card-number").value.replaceAll(" ", "");
        const expiry = $("#demo-card-expiry").value;
        const cvc = $("#demo-card-cvc").value;
        if (
          !["4242424242424242", "4000000000000002"].includes(number) ||
          !/^\d{2}\/\d{2}$/.test(expiry) ||
          expiry.slice(0, 2) < "01" ||
          expiry.slice(0, 2) > "12" ||
          !/^\d{3}$/.test(cvc)
        )
          throw Error(
            "Use the displayed test card, expiry MM/YY, and a 3-digit test CVC. Never enter real card details.",
          );
        const [month, year] = expiry.split("/").map(Number);
        if (new Date(2000 + year, month, 1) <= new Date())
          throw Error("Use a future test expiry, such as 12/30.");
        data.demo_result =
          number === "4242424242424242" ? "success" : "failure";
      }
      data.items = items.map((p) => ({ id: p.id, quantity: cart[p.id] }));
      const result = await post("/api/orders", data);
      cart = {};
      save();
      $("#cart-content").innerHTML =
        `<div class="success"><div style="font-size:50px">✓</div><h3>Your sacks are reserved.</h3><p>Order reference</p><strong>${esc(result.id)}</strong><p>${money(result.total)} · ${esc(paymentName(result.payment_method))}</p>${badge(result.payment_status)}<p class="form-note">${result.method === "delivery" ? "Delivery selected — open your map below. The truck moves after admin dispatch." : "Store pickup selected — no delivery map. Collect your order when it is ready."} Demo order only. No funds have moved.</p><div class="action-row"><button class="primary" id="success-receipt">View & print receipt</button><button class="secondary" id="success-track">${result.method === "delivery" ? "Open delivery map" : "View pickup order"}</button></div></div>`;
      $("#success-receipt").onclick = () => receiptView(result.id);
      $("#success-track").onclick = () => orderView(result.id);
      await refresh();
    } catch (err) {
      $("#checkout-error").textContent = err.message;
      button.disabled = false;
    }
  };
}
function paymentFields() {
  const method = $("#payment-method").value;
  if (method === "cash") {
    $("#payment-fields").innerHTML =
      '<p class="form-note">Pay the store when you receive your order. Your order receipt will show Unpaid until the admin records collection.</p>';
    return;
  }
  if (method === "card") {
    $("#payment-fields").innerHTML =
      `<div class="payment-demo"><div class="demo-notice">TEST CARDS ONLY · No real charges</div><p class="form-note">Success: <b>4242 4242 4242 4242</b><br>Decline: <b>4000 0000 0000 0002</b><br>Use a future expiry (12/30) and any 3-digit test CVC. These fields stay in your browser and are never submitted.</p><div class="form-grid"><label class="wide">Test card number<input id="demo-card-number" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242" maxlength="19" required></label><label>Expiry (MM/YY)<input id="demo-card-expiry" inputmode="numeric" autocomplete="off" placeholder="12/30" maxlength="5" required></label><label>Test CVC<input id="demo-card-cvc" inputmode="numeric" type="password" autocomplete="off" placeholder="123" maxlength="3" required></label></div></div>`;
    return;
  }
  $("#payment-fields").innerHTML =
    `<div class="payment-demo"><div class="demo-notice">${method === "gcash" ? "GCASH" : "MAYA"} WALLET SIMULATION</div><p>This demonstrates the outcome of a wallet checkout. No wallet login, QR payment, or transfer is requested.</p><label>Demo payment outcome<select name="demo_result"><option value="success">Successful payment</option><option value="failure">Declined / unsuccessful payment</option></select></label></div>`;
}
$("#cart-button").onclick = async () => {
  try {
    await refresh();
    cartView();
    show("#cart-dialog");
  } catch (e) {
    toast(e.message);
  }
};
$("#cart-content").onclick = (e) => {
  const c = e.target.closest("[data-change]"),
    r = e.target.closest("[data-remove]");
  if (c) {
    const id = c.dataset.change,
      p = products.find((p) => p.id === +id),
      next = cart[id] + Number(c.dataset.delta);
    if (next > p.stock) return toast("No more stock available.");
    if (next <= 0) delete cart[id];
    else cart[id] = next;
  } else if (r) delete cart[r.dataset.remove];
  else return;
  save();
  cartView();
};
$("#cart-content").addEventListener("change", (e) => {
  const id = e.target.dataset.quantity;
  if (!id) return;
  const p = products.find((p) => p.id === +id),
    q = Number(e.target.value);
  if (!Number.isInteger(q) || q < 1 || q > p.stock) {
    e.target.value = cart[id];
    return toast("Enter a whole number within available stock.");
  }
  cart[id] = q;
  save();
  cartView();
});
async function myOrders() {
  if (!user) {
    authView();
    return toast("Sign in to view your orders.");
  }
  show("#orders-dialog");
  $("#orders-content").innerHTML = "<p>Loading your orders…</p>";
  try {
    orders = await api("/api/orders");
    $("#orders-content").innerHTML = orders.length
      ? orders
          .map(
            (o) =>
              `<article class="order"><div class="section-line"><h3>${esc(o.id)}</h3>${badge(o.status)}</div><p>${date(o.created)} · ${o.items.reduce((n, i) => n + i.quantity, 0)} sacks · ${money(o.total)}</p><p>${esc(paymentName(o.payment_method))} · ${badge(o.payment_status)}</p><div class="action-row"><button class="secondary" data-order="${o.id}">Details & tracking</button><button class="secondary" data-receipt="${o.id}">Receipt / Print</button></div></article>`,
          )
          .join("")
      : '<div class="empty"><h3>No orders yet.</h3><p>Your 25 kg essentials are waiting in the shop.</p></div>';
  } catch (e) {
    $("#orders-content").textContent = e.message;
  }
}
$("#orders-link").onclick = myOrders;
$("#orders-content").onclick = (e) => {
  if (e.target.dataset.order) orderView(e.target.dataset.order);
  if (e.target.dataset.receipt) receiptView(e.target.dataset.receipt);
};
async function receiptView(id) {
  try {
    const o = await api("/api/orders/" + encodeURIComponent(id)),
      sub = o.items.reduce((n, i) => n + i.quantity * i.price, 0);
    $("#receipt-content").innerHTML =
      `<article class="receipt"><div class="receipt-brand">sako✳ <small>SUPPLY</small></div><div class="demo-notice">RESEARCH DEMO · NOT A TAX INVOICE / OFFICIAL RECEIPT</div><h2>${o.payment_status === "Unpaid" ? "Order acknowledgment" : "Demo order receipt"}</h2><p><b>${esc(o.id)}</b><br>${date(o.created)} (Philippine time)</p><div class="receipt-meta"><p><b>Customer</b><br>${esc(o.customer)}<br>${esc(o.phone)}</p><p><b>${o.method === "pickup" ? "Store pickup" : "Delivery"}</b><br>${o.method === "delivery" ? esc(o.address) : "Pickup details to be confirmed by store"}</p></div><table><thead><tr><th>Rice</th><th>Sacks</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${o.items.map((i) => `<tr><td>${esc(i.name)} · ${i.weight} kg</td><td>${i.quantity}</td><td>${money(i.price)}</td><td>${money(i.price * i.quantity)}</td></tr>`).join("")}</tbody></table><div class="receipt-totals"><p><span>Subtotal</span><b>${money(sub)}</b></p><p><span>Delivery fee</span><b>${money(o.delivery_fee)}</b></p><p class="grand"><span>Total</span><b>${money(o.total)}</b></p></div><p>Payment: ${esc(paymentName(o.payment_method))}<br>Status: <b>${esc(o.payment_status)}</b><br>Order: ${esc(o.status)}</p><p class="form-note">${o.payment_status === "Unpaid" ? "This acknowledges an order, not receipt of payment. " : ""}No actual electronic payment was processed. No VAT or tax computation is represented. Sample prices only. Thank you for supporting your local bigasan.</p></article>`;
    show("#receipt-dialog");
  } catch (e) {
    toast(e.message);
  }
}
$("#print-receipt").onclick = () => window.print();
let trackingGeneration = 0;
let mapResizeObserver = null;
function stopTracking() {
  trackingGeneration++;
  mapResizeObserver?.disconnect();
  mapResizeObserver = null;
  clearInterval(trackingTimer);
  trackingTimer = null;
  if (map) {
    map.remove();
    map = null;
  }
  marker = null;
}
$("#detail-dialog").addEventListener("close", stopTracking);
async function orderView(id) {
  stopTracking();
  show("#detail-dialog");
  $("#detail-content").innerHTML = "<p>Loading order…</p>";
  const generation = trackingGeneration;
  try {
    const o = await api("/api/orders/" + encodeURIComponent(id));
    if (generation !== trackingGeneration || !$("#detail-dialog").open) return;
    const delivery = o.method === "delivery";
    $("#detail-content").innerHTML = `
      <div class="order-summary"><div><span class="eyebrow">${delivery ? "YOUR DELIVERY" : "YOUR STORE PICKUP"}</span><h3>${esc(o.id)}</h3><p>${esc(o.customer)} · ${esc(o.phone)}</p></div><div><span id="live-order-status">${badge(o.status)}</span><p class="order-summary-total">${money(o.total)}</p></div></div>
      ${delivery ? `<section class="tracking-card"><div class="section-line"><div><h3>Your delivery map</h3><p class="form-note">Sample Koronadal route · Simulation, not driver GPS</p></div><span class="live-pill"><i></i> Updates every 5s</span></div><div class="demo-notice">SIMULATED TRACKING · NOT LIVE DRIVER GPS</div><div id="delivery-map" aria-label="Simulated delivery route map"></div><div class="map-legend"><span>● Demo store</span><span>● Demo destination</span><span id="map-background-label">Illustrated fallback if street tiles are unavailable</span></div><div class="delivery-progress"><div><i id="delivery-progress-bar"></i></div><b id="delivery-progress-number">0%</b></div><p id="tracking-label" role="status">Loading delivery position…</p><p id="map-tile-note" class="form-note" hidden>Street tiles are unavailable. Showing an illustrated demo area with the updating route.</p><p class="form-note">Destination below is your entered address; this fixed demonstration map does not route to it. Movement begins when the admin selects Out for delivery.</p></section>` : `<section class="pickup-card"><div class="pickup-icon">↗</div><div><h3>You chose store pickup</h3><p>You’ll collect your sacks from the store. Pickup orders do not have a delivery map.</p><p class="form-note">Status updates automatically. The store will contact you when your order is ready.</p></div></section>`}
      <div class="order-info-grid"><section><h3>${delivery ? "Delivery address" : "Collection"}</h3><p>${delivery ? esc(o.address) : "Store pickup · Collection details to be confirmed"}</p><h3>Payment</h3><p>${esc(paymentName(o.payment_method))} · <span id="live-payment-status">${badge(o.payment_status)}</span></p><h3>Your sacks</h3><ul class="order-items">${o.items.map((i) => `<li><span>${i.quantity} × ${esc(i.name)} · ${i.weight} kg</span><b>${money(i.price * i.quantity)}</b></li>`).join("")}</ul></section><section><h3>Order timeline</h3><ol id="live-timeline" class="timeline"></ol><p class="form-note" id="order-last-updated"></p></section></div><div class="action-row"><button class="primary" id="detail-receipt">Print receipt</button><button class="secondary" id="refresh-order">Refresh status</button></div>`;
    $("#detail-receipt").onclick = () => receiptView(o.id);
    $("#refresh-order").onclick = () => orderView(o.id);
    function updateOrder(latest) {
      $("#live-order-status").innerHTML = badge(latest.status);
      $("#live-payment-status").innerHTML = badge(latest.payment_status);
      $("#live-timeline").innerHTML =
        latest.events
          .map(
            (e) =>
              `<li><strong>${esc(e.status)}</strong><small>${date(e.created)}</small></li>`,
          )
          .join("") || "<li>Legacy order: no status history recorded.</li>";
      $("#order-last-updated").textContent =
        "Updated " + date(new Date().toISOString());
    }
    updateOrder(o);
    function updateMap(t) {
      marker?.setLatLng(t.position);
      const progress = Math.round(t.progress * 100);
      $("#delivery-progress-bar").style.width = progress + "%";
      $("#delivery-progress-number").textContent = progress + "%";
      const explanation =
        t.status === "Cancelled"
          ? "Order cancelled. Delivery simulation stopped."
          : t.status === "Completed"
            ? "Order completed. Demo destination reached."
            : t.status === "Out for delivery"
              ? "The demo truck is moving. This is not a real GPS feed."
              : "Your map is ready. Waiting for the admin to dispatch your order.";
      $("#tracking-label").textContent =
        `${t.status} · ${progress}% of demo route · ${explanation} Updated ${date(t.updated)}`;
    }
    if (delivery) {
      const tracking = await api(
        `/api/orders/${encodeURIComponent(id)}/tracking`,
      );
      if (generation !== trackingGeneration || !$("#detail-dialog").open)
        return;
      if (window.L) {
        map = L.map("delivery-map", { scrollWheelZoom: false }).setView(
          tracking.route[0],
          15,
        );
        map.createPane("offlineBasemap");
        map.getPane("offlineBasemap").style.zIndex = 199;
        L.imageOverlay(
          "/assets/demo-map.svg",
          [
            [6.498, 124.842],
            [6.51, 124.855],
          ],
          { pane: "offlineBasemap", interactive: false },
        ).addTo(map);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        })
          .on("tileerror", () => {
            if ($("#map-tile-note")) $("#map-tile-note").hidden = false;
          })
          .on("tileload", () => {
            if ($("#map-background-label"))
              $("#map-background-label").textContent =
                "OpenStreetMap street tiles";
          })
          .addTo(map);
        L.polyline(tracking.route, {
          color: "#246346",
          weight: 5,
          dashArray: "9 7",
        }).addTo(map);
        L.circleMarker(tracking.route[0], {
          color: "#246346",
          fillColor: "#fff",
          fillOpacity: 1,
          radius: 8,
        })
          .addTo(map)
          .bindTooltip("Demo store");
        L.circleMarker(tracking.route.at(-1), {
          color: "#ba8239",
          fillColor: "#fff",
          fillOpacity: 1,
          radius: 8,
        })
          .addTo(map)
          .bindTooltip("Demo destination");
        marker = L.marker(tracking.position, {
          icon: L.divIcon({
            className: "truck-marker",
            html: "🚚",
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
        }).addTo(map);
        map.fitBounds(tracking.route, { padding: [45, 45] });
        mapResizeObserver = new ResizeObserver(() => {
          if (map && generation === trackingGeneration) {
            map.invalidateSize({ animate: false });
            map.fitBounds(tracking.route, {
              padding: [30, 30],
              animate: false,
            });
          }
        });
        mapResizeObserver.observe($("#delivery-map"));
        setTimeout(() => map?.invalidateSize(), 100);
      } else {
        $("#delivery-map").innerHTML =
          '<div class="map-unavailable"><img src="/assets/demo-map.svg" alt="Illustrated demonstration area"><span>Interactive map could not load. Run npm install, restart the server, and refresh. Status and progress still update below.</span></div>';
      }
      updateMap(tracking);
    }
    trackingTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const [latest, t] = await Promise.all([
          api("/api/orders/" + encodeURIComponent(id)),
          delivery
            ? api(`/api/orders/${encodeURIComponent(id)}/tracking`)
            : Promise.resolve(null),
        ]);
        if (generation !== trackingGeneration || !$("#detail-dialog").open)
          return;
        updateOrder(latest);
        if (t) updateMap(t);
      } catch (e) {
        if (generation === trackingGeneration && $("#order-last-updated"))
          $("#order-last-updated").textContent =
            "Connection interrupted. Retrying automatically…";
      }
    }, 5000);
  } catch (e) {
    if (generation === trackingGeneration)
      $("#detail-content").textContent = e.message;
  }
}
async function adminView(tab = adminTab) {
  adminTab = tab;
  show("#admin-dialog");
  if (!isAdmin) {
    $("#admin-dialog").close();
    authView("login");
    return;
  }
  $("#admin-dialog").classList.add("dashboard-dialog");
  $("#admin-content").innerHTML = "<p>Loading dashboard…</p>";
  try {
    [adminOrders, adminData] = await Promise.all([
      api("/api/admin/orders"),
      api("/api/admin/products"),
    ]);
    await refresh();
    $("#admin-content").innerHTML =
      `<div class="dashboard-layout"><aside class="admin-sidebar"><div class="eyebrow">STORE MANAGEMENT</div>${[
        ["overview", "Overview"],
        ["orders", "Orders"],
        ["inventory", "Products & inventory"],
        ["customers", "Customers"],
        ["reports", "Reports"],
      ]
        .map(
          ([key, label]) =>
            `<button data-tab="${key}" class="${tab === key ? "current" : ""}">${label}</button>`,
        )
        .join(
          "",
        )}<button id="admin-logout">Log out</button><p class="form-note">25 kg wholesale<br>Research demo</p></aside><section id="admin-panel" class="admin-panel"></section></div>`;
    document
      .querySelectorAll("[data-tab]")
      .forEach((b) => (b.onclick = () => adminView(b.dataset.tab)));
    $("#admin-logout").onclick = async () => {
      try {
        await post("/api/logout", {});
        isAdmin = false;
        accountLabel();
        history.replaceState({}, "", "/");
        $("#admin-dialog").close();
        toast("Admin logged out");
      } catch (e) {
        toast(e.message);
      }
    };
    if (tab === "overview") overview();
    if (tab === "orders") ordersPanel();
    if (tab === "inventory") inventoryPanel();
    if (tab === "customers") await customersPanel();
    if (tab === "reports") await reportsPanel();
  } catch (e) {
    $("#admin-content").textContent = e.message;
  }
}
function stats() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayTotal = adminOrders
    .filter(
      (o) =>
        o.status === "Completed" &&
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(o.created)) === today,
    )
    .reduce((s, o) => s + o.total, 0);
  return `<div class="admin-stats"><div>Today’s completed orders*<b>${money(todayTotal)}</b></div><div>Pending orders<b>${adminOrders.filter((o) => o.status === "Pending").length}</b></div><div>Low stock (≤10 sacks)<b>${products.filter((p) => p.stock <= 10).length}</b></div><div>Available sacks<b>${products.reduce((s, p) => s + p.stock, 0)}</b></div></div><p class="form-note">*Orders placed today (Philippine time) and currently completed. Includes delivery fees and demo payments; not a collection or profit report.</p>`;
}
function overview() {
  $("#admin-panel").innerHTML =
    `<div class="section-line"><h2>A good day to do business.</h2><span class="badge">Demo store</span></div>${stats()}<h3>Orders needing attention</h3>${orderTable(adminOrders.filter((o) => !["Completed", "Cancelled"].includes(o.status)).slice(0, 5))}<h3>Low stock</h3>${
      products
        .filter((p) => p.stock <= 10)
        .map((p) => `<p>${esc(p.name)} — ${p.stock} sacks remaining</p>`)
        .join("") ||
      '<p class="form-note">All active rice products have more than 10 sacks available.</p>'
    }`;
  bindOrderActions();
}
function orderTable(list) {
  return list.length
    ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Order / customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map((o) => `<tr><td><b>${esc(o.id)}</b><small>${esc(o.customer)}<br>${date(o.created)}</small></td><td>${money(o.total)}<small>${o.method === "delivery" ? "Delivery" : "Pickup"}</small></td><td>${badge(o.payment_status)}<small>${esc(paymentName(o.payment_method))}</small>${o.payment_method === "cash" && o.payment_status === "Unpaid" && o.status !== "Cancelled" ? `<button class="small-button" data-paid="${o.id}">Record payment</button>` : ""}</td><td><select data-status="${o.id}" aria-label="Status for ${o.id}" ${o.nextStatuses.length ? "" : "disabled"}>${[o.status, ...o.nextStatuses].map((s) => `<option>${s}</option>`).join("")}</select></td><td><button class="small-button" data-order="${o.id}">View</button><button class="small-button" data-receipt="${o.id}">Receipt</button></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty">No matching orders.</div>';
}
function bindOrderActions() {
  document
    .querySelectorAll("#admin-panel [data-order]")
    .forEach((b) => (b.onclick = () => orderView(b.dataset.order)));
  document
    .querySelectorAll("#admin-panel [data-receipt]")
    .forEach((b) => (b.onclick = () => receiptView(b.dataset.receipt)));
  document.querySelectorAll("[data-paid]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("Confirm cash has been received for this order?")) return;
        try {
          await post("/api/admin/payment", { id: b.dataset.paid }, "PATCH");
          toast("Cash payment recorded");
          await adminView();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document.querySelectorAll("[data-status]").forEach(
    (s) =>
      (s.onchange = async () => {
        const o = adminOrders.find((o) => o.id === s.dataset.status);
        if (
          s.value === "Cancelled" &&
          !confirm("Cancel this order and restore its reserved stock?")
        ) {
          s.value = o.status;
          return;
        }
        try {
          await post(
            "/api/admin/status",
            { id: s.dataset.status, status: s.value },
            "PATCH",
          );
          toast("Order updated");
          await adminView();
        } catch (e) {
          toast(e.message);
          s.value = o.status;
        }
      }),
  );
}
function ordersPanel(customerId) {
  $("#admin-panel").innerHTML =
    `<h2>Orders</h2><div class="panel-tools"><input id="order-search" placeholder="Search order, name, or phone" aria-label="Search orders"><select id="order-filter" aria-label="Filter order status"><option value="all">All statuses</option>${["Pending", "Preparing", "Ready for pickup", "Out for delivery", "Completed", "Cancelled"].map((s) => `<option>${s}</option>`).join("")}</select></div>${customerId ? '<p class="form-note">Showing this customer’s orders. Choose Orders again to clear.</p>' : ""}<div id="order-table"></div>`;
  const draw = () => {
    const q = $("#order-search").value.toLowerCase(),
      status = $("#order-filter").value;
    $("#order-table").innerHTML = orderTable(
      adminOrders.filter(
        (o) =>
          (!customerId || o.user_id === customerId) &&
          (status === "all" || o.status === status) &&
          `${o.id} ${o.customer} ${o.phone}`.toLowerCase().includes(q),
      ),
    );
    bindOrderActions();
  };
  $("#order-search").oninput = draw;
  $("#order-filter").onchange = draw;
  draw();
}
function inventoryPanel() {
  $("#admin-panel").innerHTML =
    `<div class="section-line"><h2>Products & inventory</h2><button class="primary" id="new-product">+ Add product</button></div><p class="form-note">All new products are 25 kg sacks. Stock adjustments require a reason. Historical 5 kg products remain archived.</p><div class="table-scroll"><table class="admin-table"><thead><tr><th>Rice product</th><th>Price</th><th>Available</th><th>Actions</th></tr></thead><tbody>${adminData.products.map((p) => `<tr><td><div class="inventory-product">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">` : '<span class="inventory-placeholder">25<small>kg</small></span>'}<div><b>${esc(p.name)}</b><small>${p.weight} kg · ${p.active ? "Active" : "Archived"}</small></div></div></td><td>${money(p.price)}</td><td>${p.stock} sacks</td><td><button class="small-button" data-edit="${p.id}">Edit</button><button class="small-button" data-image="${p.id}">Change image</button><button class="small-button" data-adjust="${p.id}">Adjust stock</button></td></tr>`).join("")}</tbody></table></div><h3>Recent stock movements</h3><div class="table-scroll"><table class="admin-table"><thead><tr><th>Product</th><th>Change</th><th>Reason</th><th>Date</th></tr></thead><tbody>${adminData.movements.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.delta > 0 ? "+" : ""}${m.delta}</td><td>${esc(m.reason)}</td><td>${date(m.created)}</td></tr>`).join("") || '<tr><td colspan="4">No adjustments recorded yet.</td></tr>'}</tbody></table></div>`;
  $("#new-product").onclick = () => productEditor();
  document
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          productEditor(
            adminData.products.find((p) => p.id === +b.dataset.edit),
          )),
    );
  document.querySelectorAll("[data-image]").forEach(
    (b) =>
      (b.onclick = () => {
        productEditor(
          adminData.products.find((p) => p.id === +b.dataset.image),
        );
        $("#product-photo").focus();
      }),
  );
  document
    .querySelectorAll("[data-adjust]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          stockEditor(
            adminData.products.find((p) => p.id === +b.dataset.adjust),
          )),
    );
}
let photoPreviewUrl = null;
function clearPhotoPreview() {
  if (photoPreviewUrl) {
    URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
  }
}
$("#editor-dialog").addEventListener("close", clearPhotoPreview);
function productEditor(p) {
  clearPhotoPreview();
  const item = p || {
    name: "",
    variety: "",
    price: 1200,
    tag: "Everyday",
    description: "",
    texture: "",
    cooking: "",
    active: 1,
    image: "",
  };
  let removePhoto = false;
  $("#editor-content").innerHTML =
    `<form id="product-edit"><section class="photo-editor"><div id="product-photo-preview">${item.image ? `<img src="${esc(item.image)}" alt="Current product photo">` : '<span class="photo-placeholder">↥<small>Add your rice product photo</small></span>'}</div><div><h3>Product image</h3><p class="form-note">Upload or replace a supplier-authorized photo. PNG, JPG, or WebP, up to 2 MB.</p><label class="upload-label">Choose product image<input id="product-photo" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" id="remove-product-photo" class="small-button" ${item.image ? "" : "hidden"}>Remove image</button><p id="photo-selection-note" class="form-note">${item.image ? "Current photo is shown. Choose a file to replace it." : "No photo yet. A rice sack illustration will be used."}</p></div></section><div class="form-grid"><label>Rice name<input name="name" value="${esc(item.name)}" maxlength="80" required></label><label>Short description<input name="variety" value="${esc(item.variety)}" maxlength="150"></label><label>Price per 25 kg sack (PHP)<input name="price" type="number" min="1" max="100000" value="${item.price}" required></label><label>Category<select name="tag">${["Premium", "Everyday", "Value", "Whole grain"].map((t) => `<option ${t === item.tag ? "selected" : ""}>${t}</option>`).join("")}</select></label><label class="wide">Product description<textarea name="description" maxlength="2000" required>${esc(item.description)}</textarea></label><label class="wide">Texture<textarea name="texture" maxlength="500">${esc(item.texture)}</textarea></label><label class="wide">Cooking notes<textarea name="cooking" maxlength="500">${esc(item.cooking)}</textarea></label>${p ? `<label class="wide">Visibility<select name="active"><option value="true" ${item.active ? "selected" : ""}>Active</option><option value="false" ${!item.active ? "selected" : ""}>Archived</option></select></label>` : ""}</div><p class="form-note">All new products are 25 kg sacks and start with zero stock. Add a stock movement after saving.</p><button class="primary checkout-button" type="submit">Save product</button><p id="editor-error" role="alert"></p></form>`;
  $("#product-photo").onchange = () => {
    const file = $("#product-photo").files[0];
    if (!file) return;
    if (
      file.size > 2000000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      $("#editor-error").textContent = "Choose a PNG, JPG, or WebP under 2 MB.";
      $("#product-photo").value = "";
      return;
    }
    clearPhotoPreview();
    photoPreviewUrl = URL.createObjectURL(file);
    removePhoto = false;
    $("#product-photo-preview").innerHTML =
      `<img src="${esc(photoPreviewUrl)}" alt="Selected product photo preview">`;
    $("#photo-selection-note").textContent = file.name + " · Ready to save";
    $("#remove-product-photo").hidden = false;
    $("#editor-error").textContent = "";
  };
  $("#remove-product-photo").onclick = () => {
    clearPhotoPreview();
    removePhoto = true;
    $("#product-photo").value = "";
    $("#product-photo-preview").innerHTML =
      '<span class="photo-placeholder">↥<small>Rice sack illustration will be used</small></span>';
    $("#photo-selection-note").textContent =
      "Image will be removed when you save.";
    $("#remove-product-photo").hidden = true;
  };
  $("#product-edit").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("button[type=submit]");
    button.disabled = true;
    $("#editor-error").textContent = "";
    const data = Object.fromEntries(new FormData(e.target));
    data.price = Number(data.price);
    if (p) {
      data.id = p.id;
      data.active =
        data.active === undefined
          ? Boolean(p.active ?? true)
          : data.active === "true";
    }
    try {
      const file = $("#product-photo").files[0];
      if (
        file &&
        (file.size > 2000000 ||
          !["image/png", "image/jpeg", "image/webp"].includes(file.type))
      )
        throw Error("Choose a PNG, JPG, or WebP under 2 MB.");
      const photo = file
        ? await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () =>
              reject(Error("Could not read the image. Choose the file again."));
            reader.readAsDataURL(file);
          })
        : null;
      const saved = await post(
        "/api/admin/products",
        data,
        p ? "PATCH" : "POST",
      );
      const id = p?.id || saved.id;
      if (!p) p = { ...data, id, active: true };
      if (photo) await post("/api/admin/image", { id, data: photo });
      else if (p && removePhoto)
        await post("/api/admin/image", { id, remove: true });
      $("#editor-dialog").close();
      toast("Product and image saved");
      await adminView("inventory");
    } catch (e) {
      $("#editor-error").textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
  show("#editor-dialog");
}
function stockEditor(p) {
  $("#editor-content").innerHTML =
    `<h3>${esc(p.name)} · ${p.weight} kg</h3><p>Currently available: ${p.stock} sacks</p><form id="stock-edit"><label>Adjustment in sacks (use a negative number to subtract)<input name="delta" type="number" min="-10000" max="10000" required placeholder="20"></label><label>Reason<textarea name="reason" maxlength="300" required placeholder="Supplier delivery / damaged sacks / correction"></textarea></label><button class="primary checkout-button">Record adjustment</button><p id="editor-error" role="alert"></p></form>`;
  $("#stock-edit").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await post(
        "/api/admin/stock",
        { id: p.id, delta: Number(data.delta), reason: data.reason },
        "PATCH",
      );
      $("#editor-dialog").close();
      toast("Stock movement recorded");
      await adminView("inventory");
    } catch (e) {
      $("#editor-error").textContent = e.message;
    }
  };
  show("#editor-dialog");
}
async function customersPanel() {
  const customers = await api("/api/admin/customers");
  $("#admin-panel").innerHTML =
    `<h2>Customers</h2><p class="form-note">Only registered customers appear. Contact details are for order fulfillment.</p><input id="customer-search" class="full-search" placeholder="Search customer name or email" aria-label="Search customers"><div id="customer-table"></div>`;
  const draw = () => {
    const q = $("#customer-search").value.toLowerCase();
    $("#customer-table").innerHTML =
      `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Completed order total</th><th></th></tr></thead><tbody>${
        customers
          .filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q))
          .map(
            (c) =>
              `<tr><td>${esc(c.name)}<small>${esc(c.email)}</small></td><td>${esc(c.phone || "Not yet provided")}</td><td>${c.order_count}</td><td>${money(c.total_spent)}</td><td><button class="small-button" data-customer="${c.id}">Order history</button></td></tr>`,
          )
          .join("") || '<tr><td colspan="5">No matching customers.</td></tr>'
      }</tbody></table></div>`;
    document
      .querySelectorAll("[data-customer]")
      .forEach((b) => (b.onclick = () => ordersPanel(b.dataset.customer)));
  };
  $("#customer-search").oninput = draw;
  draw();
}
async function reportsPanel() {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
  });
  $("#admin-panel").innerHTML =
    `<h2>Sales reports</h2><p class="form-note">Completed orders by order-placement date (Philippine time). Includes demo electronic payments and unpaid completed cash orders. This is not a tax, collected-cash, or profit report.</p><form id="report-filter" class="panel-tools"><label>From<input name="from" type="date" value="${today.slice(0, 7)}-01" required></label><label>To<input name="to" type="date" value="${today}" required></label><button class="primary">Apply dates</button><a class="secondary" id="csv-export" href="#">Export CSV</a></form><div id="report-results"></div>`;
  const load = async () => {
    const params = new URLSearchParams(new FormData($("#report-filter")));
    try {
      const r = await api("/api/admin/reports?" + params);
      $("#csv-export").href = "/api/admin/reports?" + params + "&format=csv";
      $("#report-results").innerHTML =
        `<div class="admin-stats"><div>Completed order total<b>${money(r.total)}</b></div><div>Rice sales (excl. delivery)<b>${money(r.total - r.deliveryFees)}</b></div><div>Completed orders<b>${r.orders.length}</b></div></div><h3>Best-selling rice</h3>${r.bestSellers.map((p) => `<div class="bar-row"><span>${esc(p.name)}</span><div><i style="width:${Math.max(3, (p.sacks / Math.max(...r.bestSellers.map((x) => x.sacks))) * 100)}%"></i></div><b>${p.sacks} sacks</b></div>`).join("") || '<p class="empty">No completed orders in this date range.</p>'}<h3>Completed orders</h3>${orderTable(r.orders.map((o) => ({ ...o, nextStatuses: [] })))}`;
      bindOrderActions();
    } catch (e) {
      $("#report-results").textContent = e.message;
    }
  };
  $("#report-filter").onsubmit = (e) => {
    e.preventDefault();
    load();
  };
  await load();
}
$("#admin-link").onclick = async () => {
  try {
    const s = await api("/api/session");
    isAdmin = s.admin;
    accountLabel();
    await adminView("overview");
  } catch (e) {
    toast(e.message);
  }
};
async function init() {
  try {
    const [s, c] = await Promise.all([api("/api/session"), api("/api/config")]);
    user = s.user;
    isAdmin = s.admin;
    config = c;
    accountLabel();
    await refresh();
    if (location.pathname === "/admin") await adminView("overview");
  } catch (e) {
    $("#products").innerHTML =
      "<p>Could not load the store. Ensure the server is running, then refresh.</p>";
    toast(e.message);
  }
}
init();
