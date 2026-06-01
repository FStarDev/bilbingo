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
  salespersonName: string;
  cashierNumber: number;
  seasonYear: number;
  seasonWeek: number;
  items: SalesItem[];
  totalItems: number;
  totalPrice: number;
};

type SalesSession = {
  role: "cashier" | "admin";
  salespersonName: string;
  cashierNumber?: number;
  seasonYear: number;
  seasonWeek: number;
  startedAt: number;
};

const STORAGE_KEY = "bilbingo-sales-log";
const SESSION_KEY = "bilbingo-active-session";
const LOG_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

let activeSession: SalesSession | null = null;

function loadActiveSession(): SalesSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SalesSession>;
    const role = parsed.role === "admin" ? "admin" : "cashier";
    if (!parsed.salespersonName || !parsed.seasonYear || !parsed.seasonWeek) {
      return null;
    }

    if (role === "cashier") {
      if (!parsed.cashierNumber) {
        return null;
      }
      return {
        role,
        salespersonName: parsed.salespersonName,
        cashierNumber: parsed.cashierNumber,
        seasonYear: parsed.seasonYear,
        seasonWeek: parsed.seasonWeek,
        startedAt: parsed.startedAt ?? Date.now(),
      };
    }

    return {
      role,
      salespersonName: parsed.salespersonName,
      seasonYear: parsed.seasonYear,
      seasonWeek: parsed.seasonWeek,
      startedAt: parsed.startedAt ?? Date.now(),
    };
  } catch (e) {
    console.warn("Failed to load sales session", e);
    return null;
  }
}

function saveActiveSession(session: SalesSession | null) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    console.warn("Failed to save sales session", e);
  }
}

function matchesCurrentWeekAndCashier(entry: SalesLogEntry, session: SalesSession): boolean {
  if (session.role !== "cashier" || !session.cashierNumber) {
    return false;
  }

  return (
    entry.seasonYear === session.seasonYear &&
    entry.seasonWeek === session.seasonWeek &&
    entry.cashierNumber === session.cashierNumber
  );
}

function aggregateLogs(logs: SalesLogEntry[]): {
  totalCustomers: number;
  totalRevenue: number;
  products: Record<ItemId, { qty: number; amount: number }>;
} {
  const products: Record<ItemId, { qty: number; amount: number }> = {
    storbingo: { qty: 0, amount: 0 },
    rovaren: { qty: 0, amount: 0 },
    freeplay: { qty: 0, amount: 0 },
    fiftyfifty: { qty: 0, amount: 0 },
  };

  let totalRevenue = 0;
  logs.forEach((entry) => {
    totalRevenue += entry.totalPrice;
    entry.items.forEach((it) => {
      products[it.id].qty += it.quantity;
      products[it.id].amount += it.amount;
    });
  });

  return {
    totalCustomers: logs.length,
    totalRevenue,
    products,
  };
}

function loadSalesLog(): SalesLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const stored = JSON.parse(raw) as Array<Partial<SalesLogEntry>>;
    const normalizedLogs: SalesLogEntry[] = stored.map((entry) => ({
      id: entry.id ?? String(entry.timestamp ?? Date.now()),
      timestamp: entry.timestamp ?? Date.now(),
      salespersonName: entry.salespersonName ?? "Okänd säljare",
      cashierNumber: entry.cashierNumber ?? 0,
      seasonYear: entry.seasonYear ?? new Date(entry.timestamp ?? Date.now()).getFullYear(),
      seasonWeek: entry.seasonWeek ?? 0,
      items: entry.items ?? [],
      totalItems: entry.totalItems ?? 0,
      totalPrice: entry.totalPrice ?? 0,
    }));
    const cutoff = Date.now() - LOG_MAX_AGE_MS;
    const validLogs = normalizedLogs.filter((entry) => entry.timestamp >= cutoff);
    if (validLogs.length !== normalizedLogs.length) {
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
  if (!activeSession || activeSession.role !== "cashier" || !activeSession.cashierNumber) {
    return null;
  }

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
    salespersonName: activeSession.salespersonName,
    cashierNumber: activeSession.cashierNumber,
    seasonYear: activeSession.seasonYear,
    seasonWeek: activeSession.seasonWeek,
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
const viewAdminStatsBtn = document.getElementById("view-admin-stats-btn");
const viewLogsBtn = document.getElementById("view-logs-btn");
const cogBtn = document.getElementById("cog-btn");
const modeButtons = document.getElementById("mode-buttons");

const statsPage = document.getElementById("stats-page");
const adminStatsPage = document.getElementById("admin-stats-page");
const logsPage = document.getElementById("logs-page");
const statsContextEl = document.getElementById("stats-context");
const totalCustomersEl = document.getElementById("total-customers");
const productTotalsEl = document.getElementById("product-totals");
const totalRevenueEl = document.getElementById("total-revenue");
const adminScopeSelect = document.querySelector<HTMLSelectElement>("#admin-scope-select");
const adminCashierSelect = document.querySelector<HTMLSelectElement>("#admin-cashier-select");
const adminTotalCustomersEl = document.getElementById("admin-total-customers");
const adminProductTotalsEl = document.getElementById("admin-product-totals");
const adminTotalRevenueEl = document.getElementById("admin-total-revenue");
const adminCashierBreakdownEl = document.getElementById("admin-cashier-breakdown");
const logsListEl = document.getElementById("logs-list");
const clearLogBtn = document.getElementById("clear-log-btn");
const cancelSaleBtn = document.getElementById("cancel-sale-btn");
const startupScreen = document.getElementById("startup-screen");
const appContent = document.getElementById("app-content");
const startupForm = document.querySelector<HTMLFormElement>("#startup-form");
const startupAdminBtn = document.querySelector<HTMLButtonElement>("#startup-admin-btn");
const startupAdminPanel = document.getElementById("startup-admin-panel");
const startupAdminPinInput = document.querySelector<HTMLInputElement>("#startup-admin-pin");
const startupAdminLoginBtn = document.querySelector<HTMLButtonElement>("#startup-admin-login-btn");
const currentSeasonWeekEl = document.getElementById("current-season-week");
const activeSessionLabel = document.getElementById("active-session-label");
const changeSessionBtn = document.getElementById("change-session-btn");
const shopSection = document.getElementById("shop-section");
let activeLogDetailId: string | null = null;

function renderSessionLabel() {
  if (!activeSessionLabel || !activeSession) return;
  if (activeSession.role === "admin") {
    activeSessionLabel.textContent = `Admin: ${activeSession.salespersonName} • Säsong ${activeSession.seasonYear} vecka ${activeSession.seasonWeek}`;
    return;
  }

  activeSessionLabel.textContent = `Inloggad: ${activeSession.salespersonName} • Säsong ${activeSession.seasonYear} vecka ${activeSession.seasonWeek} • Kassa ${activeSession.cashierNumber}`;
}

function getISOWeekNumber(date: Date): number {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getCurrentSeasonWeek(): { seasonYear: number; seasonWeek: number } {
  const now = new Date();
  return {
    seasonYear: now.getFullYear(),
    seasonWeek: getISOWeekNumber(now),
  };
}

function renderStartupPeriod() {
  if (!currentSeasonWeekEl) return;
  const current = getCurrentSeasonWeek();
  currentSeasonWeekEl.textContent = `${current.seasonYear} + vecka ${current.seasonWeek}`;
}

function loginAsAdminWithPin(pinRaw: string) {
  const pin = pinRaw.trim();
  if (pin !== "909") {
    window.alert("Fel admin-PIN.");
    return;
  }

  const current = getCurrentSeasonWeek();

  activeSession = {
    role: "admin",
    salespersonName: "Admin",
    seasonYear: current.seasonYear,
    seasonWeek: current.seasonWeek,
    startedAt: Date.now(),
  };
  saveActiveSession(activeSession);
  resetCurrentSale();
  syncSessionUI();
  renderStats();
  renderAdminStats();
  showView("admin");
}

function syncRoleAccessUI() {
  const isAdmin = activeSession?.role === "admin";
  if (viewShopBtn) viewShopBtn.hidden = isAdmin;
  if (viewStatsBtn) viewStatsBtn.hidden = isAdmin;
  if (viewAdminStatsBtn) viewAdminStatsBtn.hidden = !isAdmin;
  if (shopSection) shopSection.hidden = isAdmin;
}

function syncSessionUI() {
  const hasSession = Boolean(activeSession);
  if (startupScreen) startupScreen.hidden = hasSession;
  if (appContent) appContent.hidden = !hasSession;
  syncRoleAccessUI();
  if (hasSession) {
    renderSessionLabel();
  }
}

function showView(view: "shop" | "stats" | "admin" | "logs") {
  if (statsPage) statsPage.hidden = view !== "stats";
  if (adminStatsPage) adminStatsPage.hidden = view !== "admin";
  if (logsPage) logsPage.hidden = view !== "logs";
  // keep shop visible when view is shop
}

function renderStats() {
  if (!activeSession || activeSession.role !== "cashier") {
    if (statsContextEl) statsContextEl.textContent = "Ingen aktiv session.";
    if (totalCustomersEl) totalCustomersEl.textContent = "0";
    if (productTotalsEl) productTotalsEl.innerHTML = "";
    if (totalRevenueEl) totalRevenueEl.textContent = "0 kr";
    return;
  }

  const logs = loadSalesLog();
  const currentSession = activeSession;
  const ownWeekLogs = logs.filter((entry) => matchesCurrentWeekAndCashier(entry, currentSession));
  const stats = aggregateLogs(ownWeekLogs);

  if (statsContextEl) {
    statsContextEl.textContent = `Din statistik för säsong ${currentSession.seasonYear} vecka ${currentSession.seasonWeek}, kassa ${currentSession.cashierNumber}.`;
  }
  if (totalCustomersEl) totalCustomersEl.textContent = String(stats.totalCustomers);

  if (productTotalsEl) {
    productTotalsEl.innerHTML = "";
    for (const id of Object.keys(stats.products) as ItemId[]) {
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = `<span>${findItem(id).name}</span><strong>${stats.products[id].qty} st — ${stats.products[id].amount} kr</strong>`;
      productTotalsEl.appendChild(row);
    }
  }

  if (totalRevenueEl) totalRevenueEl.textContent = `${stats.totalRevenue} kr`;
}

function renderAdminStats() {
  const logs = loadSalesLog();
  const scope = adminScopeSelect?.value ?? "week";
  const cashierRaw = adminCashierSelect?.value ?? "all";
  const selectedCashier = cashierRaw === "all" ? null : Number(cashierRaw);

  const currentYear = activeSession?.seasonYear ?? new Date().getFullYear();
  const currentWeek = activeSession?.seasonWeek ?? getISOWeekNumber(new Date());

  const scopedLogs = logs.filter((entry) => {
    if (scope === "week") {
      return entry.seasonYear === currentYear && entry.seasonWeek === currentWeek;
    }
    if (scope === "season") {
      return entry.seasonYear === currentYear;
    }
    return true;
  });

  const filteredLogs = scopedLogs.filter((entry) => {
    if (!selectedCashier) return true;
    return entry.cashierNumber === selectedCashier;
  });

  const stats = aggregateLogs(filteredLogs);
  if (adminTotalCustomersEl) adminTotalCustomersEl.textContent = String(stats.totalCustomers);
  if (adminTotalRevenueEl) adminTotalRevenueEl.textContent = `${stats.totalRevenue} kr`;

  if (adminProductTotalsEl) {
    adminProductTotalsEl.innerHTML = "";
    for (const id of Object.keys(stats.products) as ItemId[]) {
      const row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML = `<span>${findItem(id).name}</span><strong>${stats.products[id].qty} st — ${stats.products[id].amount} kr</strong>`;
      adminProductTotalsEl.appendChild(row);
    }
  }

  if (adminCashierBreakdownEl) {
    adminCashierBreakdownEl.innerHTML = "";
    const byCashier = new Map<number, { customers: number; revenue: number }>();
    filteredLogs.forEach((entry) => {
      const current = byCashier.get(entry.cashierNumber) ?? { customers: 0, revenue: 0 };
      current.customers += 1;
      current.revenue += entry.totalPrice;
      byCashier.set(entry.cashierNumber, current);
    });

    [1, 2, 3].forEach((cashierNumber) => {
      const entry = byCashier.get(cashierNumber) ?? { customers: 0, revenue: 0 };
      const row = document.createElement("div");
      row.className = "cashier-row";
      row.innerHTML = `<strong>Kassa ${cashierNumber}</strong><div>${entry.customers} kunder — ${entry.revenue} kr</div>`;
      adminCashierBreakdownEl.appendChild(row);
    });
  }
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
          <div>${entry.salespersonName} • Säsong ${entry.seasonYear} vecka ${entry.seasonWeek} • Kassa ${entry.cashierNumber}</div>
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
          <div>${entry.salespersonName} • Säsong ${entry.seasonYear} vecka ${entry.seasonWeek} • Kassa ${entry.cashierNumber}</div>
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
activeSession = loadActiveSession();
renderStartupPeriod();
syncSessionUI();
renderStats();
renderAdminStats();
renderLogs();

startupAdminBtn?.addEventListener("click", () => {
  if (startupAdminPanel) {
    startupAdminPanel.hidden = !startupAdminPanel.hidden;
  }
  startupAdminPinInput?.focus();
});

startupAdminLoginBtn?.addEventListener("click", () => {
  loginAsAdminWithPin(startupAdminPinInput?.value ?? "");
});

startupAdminPinInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  loginAsAdminWithPin(startupAdminPinInput.value);
});

startupForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(startupForm);
  const salespersonName = String(formData.get("salespersonName") ?? "").trim();
  const cashierNumber = Number(formData.get("cashierNumber") ?? "0");

  if (!salespersonName) {
    window.alert("Fyll i namn för att starta passet.");
    return;
  }

  if (!Number.isFinite(cashierNumber) || cashierNumber < 1 || cashierNumber > 3) {
    window.alert("Välj kassanummer för kassörspass.");
    return;
  }

  const current = getCurrentSeasonWeek();

  activeSession = {
    role: "cashier",
    salespersonName,
    cashierNumber,
    seasonYear: current.seasonYear,
    seasonWeek: current.seasonWeek,
    startedAt: Date.now(),
  };

  saveActiveSession(activeSession);
  resetCurrentSale();
  syncSessionUI();
  renderStats();
  renderAdminStats();
  showView("shop");
});

changeSessionBtn?.addEventListener("click", () => {
  const confirmed = window.confirm("Byta pass? Aktuell kundkorg nollställs.");
  if (!confirmed) {
    return;
  }

  activeSession = null;
  saveActiveSession(null);
  resetCurrentSale();
  syncSessionUI();
  renderStats();
  renderAdminStats();
  if (modeButtons) {
    modeButtons.hidden = true;
  }
  if (cogBtn) {
    cogBtn.setAttribute("aria-expanded", "false");
  }
});

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

viewAdminStatsBtn?.addEventListener("click", () => {
  if (activeSession?.role !== "admin") return;
  showView("admin");
  renderAdminStats();
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
  renderAdminStats();
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
    showView(activeSession?.role === "admin" ? "admin" : "shop");
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
  renderAdminStats();
  renderLogs();
});

adminScopeSelect?.addEventListener("change", () => {
  renderAdminStats();
});

adminCashierSelect?.addEventListener("change", () => {
  renderAdminStats();
});

addAllButtonEl?.addEventListener("click", () => {
  items.forEach((item) => {
    item.quantity += 1;
  });
  render();
});

render();
