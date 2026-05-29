import "./style.css";

(window as any).__THIN_CLIENT_BOOTED = true;
document.getElementById("startup-error")?.setAttribute("hidden", "");

type ItemId = "storbingo" | "rovaren" | "freeplay" | "fiftyfifty";

type ShopItem = {
  id: ItemId;
  name: string;
  price: number;
  quantity: number;
};

const items: ShopItem[] = [
  { id: "storbingo", name: "Storbingo", price: 50, quantity: 0 },
  { id: "rovaren", name: "Rövaren", price: 20, quantity: 0 },
  { id: "freeplay", name: "Freeplay", price: 20, quantity: 0 },
  { id: "fiftyfifty", name: "FiftyFifty", price: 20, quantity: 0 }
];

const shopList = document.querySelector<HTMLElement>("#shop-list");
const totalItemsEl = document.querySelector<HTMLElement>("#total-items");
const totalPriceEl = document.querySelector<HTMLElement>("#total-price");
const resetButton = document.querySelector<HTMLButtonElement>("#reset-btn");
const addAllButton = document.querySelector<HTMLButtonElement>(".addall-btn");

// --- Sales log types and storage ---
type SalesItem = {
  id: ItemId;
  name: string;
  price: number;
  quantity: number;
  amount: number;
};

type SalesLogEntry = {
  id: string;
  timestamp: number;
  items: SalesItem[];
  totalItems: number;
  totalPrice: number;
};

const STORAGE_KEY = "bilbingo-sales-log";
const LOG_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

function loadSalesLog(): SalesLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw) as SalesLogEntry[];
    const cutoff = Date.now() - LOG_MAX_AGE_MS;
    const validLogs = stored.filter((entry) => entry.timestamp >= cutoff);
    if (validLogs.length !== stored.length) {
      saveSalesLog(validLogs);
    }
    return validLogs;
  } catch (e) {
    console.warn("Failed to load sales log", e);
    return [];
  }
}

function saveSalesLog(logs: SalesLogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.warn("Failed to save sales log", e);
  }
}

function addSaleEntryFromCurrent(): SalesLogEntry | null {
  const itemsSnapshot: SalesItem[] = items.map((it) => ({
    id: it.id,
    name: it.name,
    price: it.price,
    quantity: it.quantity,
    amount: it.quantity * it.price,
  }));
  const totalItems = itemsSnapshot.reduce((s, it) => s + it.quantity, 0);
  const totalPrice = itemsSnapshot.reduce((s, it) => s + it.amount, 0);
  if (totalItems === 0) return null;

  const entry: SalesLogEntry = {
    id: String(Date.now()),
    timestamp: Date.now(),
    items: itemsSnapshot,
    totalItems,
    totalPrice,
  };

  const logs = loadSalesLog();
  logs.push(entry);
  saveSalesLog(logs);
  return entry;
}

// --- Stats / Logs UI ---
const viewShopBtn = document.getElementById("view-shop-btn");
const viewStatsBtn = document.getElementById("view-stats-btn");
const viewLogsBtn = document.getElementById("view-logs-btn");
const cogBtn = document.getElementById("cog-btn");
const modeButtons = document.getElementById("mode-buttons");

const statsPage = document.getElementById("stats-page");
const logsPage = document.getElementById("logs-page");
const totalCustomersEl = document.getElementById("total-customers");
const productTotalsEl = document.getElementById("product-totals");
const totalRevenueEl = document.getElementById("total-revenue");
const logsListEl = document.getElementById("logs-list");
const clearLogBtn = document.getElementById("clear-log-btn");
const cancelSaleBtn = document.getElementById("cancel-sale-btn");
let activeLogDetailId: string | null = null;

function showView(view: "shop" | "stats" | "logs") {
  if (statsPage) statsPage.hidden = view !== "stats";
  if (logsPage) logsPage.hidden = view !== "logs";
  // keep shop visible when view is shop
}

function renderStats() {
  const logs = loadSalesLog();
  if (totalCustomersEl) totalCustomersEl.textContent = String(logs.length);

  // aggregate per product
  const agg: Record<ItemId, { qty: number; amount: number }> = {
    storbingo: { qty: 0, amount: 0 },
    rovaren: { qty: 0, amount: 0 },
    freeplay: { qty: 0, amount: 0 },
    fiftyfifty: { qty: 0, amount: 0 },
  };

  let totalRevenue = 0;
  logs.forEach((entry) => {
    totalRevenue += entry.totalPrice;
    entry.items.forEach((it) => {
      agg[it.id].qty += it.quantity;
      agg[it.id].amount += it.amount;
    });
  });

  if (productTotalsEl) {
    productTotalsEl.innerHTML = "";
    for (const id of Object.keys(agg) as ItemId[]) {
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = `<span>${findItem(id).name}</span><strong>${agg[id].qty} st — ${agg[id].amount} kr</strong>`;
      productTotalsEl.appendChild(row);
    }
  }

  if (totalRevenueEl) totalRevenueEl.textContent = `${totalRevenue} kr`;
}

function renderLogs() {
  const logs = loadSalesLog();
  if (!logsListEl) return;
  logsListEl.innerHTML = "";
  logs.slice().reverse().forEach((entry) => {
    const div = document.createElement("div");
    div.className = "log-entry";
    const date = new Date(entry.timestamp).toLocaleString();
    div.innerHTML = `
      <div class="log-summary">
        <div>
          <strong>${date}</strong>
          <div>${entry.totalItems} varor — ${entry.totalPrice} kr</div>
        </div>
        <button class="details-toggle-btn" data-entry-id="${entry.id}" type="button">Visa</button>
      </div>
    `;

    if (entry.id === activeLogDetailId) {
      const details = document.createElement("div");
      details.className = "log-detail";
      details.innerHTML = `
        <div>
          <strong>${date}</strong>
          <div>${entry.totalItems} varor — ${entry.totalPrice} kr</div>
          <ul>
            ${entry.items
              .map((it) => `<li>${it.name}: ${it.quantity} st — ${it.amount} kr</li>`)
              .join("")}
          </ul>
        </div>
      `;
      div.appendChild(details);
    }

    const btn = div.querySelector("button");
    btn?.addEventListener("click", () => showLogDetails(entry.id));
    logsListEl.appendChild(div);
  });
}

function showLogDetails(id: string) {
  activeLogDetailId = activeLogDetailId === id ? null : id;
  renderLogs();
}

// initialize stats/logs view
renderStats();
renderLogs();

viewShopBtn?.addEventListener("click", () => {
  showView("shop");
  if (modeButtons) { modeButtons.hidden = true; }
  if (cogBtn) { cogBtn.setAttribute("aria-expanded", "false"); }
});

viewStatsBtn?.addEventListener("click", () => {
  showView("stats");
  renderStats();
  if (modeButtons) { modeButtons.hidden = true; }
  if (cogBtn) { cogBtn.setAttribute("aria-expanded", "false"); }
});

viewLogsBtn?.addEventListener("click", () => {
  showView("logs");
  renderLogs();
  if (modeButtons) { modeButtons.hidden = true; }
  if (cogBtn) { cogBtn.setAttribute("aria-expanded", "false"); }
});

clearLogBtn?.addEventListener("click", () => {
  const confirmed = window.confirm("Är du säker på att du vill tömma loggen? Detta tar bort alla sparade försäljningar.");
  if (!confirmed) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
  activeLogDetailId = null;
  resetCurrentSale();
  renderStats();
  renderLogs();
  showView("logs");
});

cancelSaleBtn?.addEventListener("click", () => {
  resetCurrentSale();
});

cogBtn?.addEventListener("click", () => {
  if (!modeButtons) return;
  const isVisible = !modeButtons.hidden;
  if (isVisible) {
    modeButtons.hidden = true;
    cogBtn?.setAttribute("aria-expanded", "false");
    showView("shop");
  } else {
    modeButtons.hidden = false;
    cogBtn?.setAttribute("aria-expanded", "true");
  }
});

if (!shopList || !totalItemsEl || !totalPriceEl || !resetButton) {
  throw new Error("Expected shop elements are missing from the page.");
}

const shopListEl = shopList;
const totalItemsValueEl = totalItemsEl;
const totalPriceValueEl = totalPriceEl;
const resetButtonEl = resetButton;
const addAllButtonEl = addAllButton;

function findItem(id: ItemId): ShopItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`Unknown item id: ${id}`);
  }
  return item;
}

function resetCurrentSale() {
  items.forEach((item) => {
    item.quantity = 0;
  });
  render();
}

function render(): void {
  items.forEach((item) => {
    const qtyEl = document.querySelector<HTMLElement>(`#qty-${item.id}`);
    if (qtyEl) {
      qtyEl.textContent = String(item.quantity);
    }
  });

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

  totalItemsValueEl.textContent = String(totalItems);
  totalPriceValueEl.textContent = `${totalPrice} kr`;
}

shopListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button[data-action][data-item-id]");
  if (!button) {
    return;
  }

  const itemId = button.dataset.itemId as string | undefined;
  const action = button.dataset.action as string | undefined;
  if (!itemId || !action) {
    return;
  }

  // Only handle simple increment/decrement actions here; ignore other actions like "incrementAll".
  if (action !== "increment" && action !== "decrement") {
    return;
  }

  const item = findItem(itemId as ItemId);
  if (action === "increment") {
    item.quantity += 1;
  } else {
    item.quantity = Math.max(0, item.quantity - 1);
  }

  render();
});

resetButtonEl.addEventListener("click", () => {
  // Record sale for current customer if any items selected
  addSaleEntryFromCurrent();
  // reset quantities
  resetCurrentSale();
  // update stats/log UI
  renderStats();
  renderLogs();
});

addAllButtonEl?.addEventListener("click", () => {
  items.forEach((item) => {
    item.quantity += 1;
  });
  render();
});

render();
