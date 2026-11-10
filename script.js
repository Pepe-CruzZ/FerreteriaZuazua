"use strict";

// =====================================
// 1. CATÁLOGO DE LOS 12 PRODUCTOS
// =====================================

const BASE = [
  ["Cemento 50 kg", "Monterrey", "bulto", 245, 310],
  ["Cemento 25 kg", "Monterrey", "bulto", 124, 155],
  ["Varilla 1/2", "Monterrey", "pieza", 190, 250],
  ["Bloques", "Monterrey", "pieza", 18, 24],
  ['Tubo PVC 4"', "Monterrey", "pieza", 270, 360],
  ["Armex", "Monterrey", "pieza", 175, 220],
  ["Bulto de yeso", "Monterrey", "bulto", 190, 230],
  ["Alambre recocido", "Monterrey", "kg", 35, 45],
  ["Cress", "Monterrey", "bulto", 185, 230],
  ["Arena", "Lampazos", "m³", 750, 900],
  ["Mixto", "Lampazos", "m³", 650, 800],
  ["Piedra bola", "Lampazos", "m³", 1000, 1200]
];

const STORAGE = "fz_control_unico_v1";
const $ = id => document.getElementById(id);

function fresh() {
  return {
    products: BASE.map((p, id) => ({
      id,
      name: p[0],
      origin: p[1],
      unit: p[2],
      cost: p[3],
      price: p[4],
      estimate: 0
    })),
    config: {
      cycle: 30,
      safety: 2,
      Monterrey: 4,
      Lampazos: 2
    },
    events: []
  };
}

let state;

try {
  state = JSON.parse(localStorage.getItem(STORAGE)) || fresh();
  if (!Array.isArray(state.products) ||
      state.products.length !== 12 ||
      !Array.isArray(state.events)) {
    throw Error("Datos inválidos");
  }
} catch {
  state = fresh();
}

// =====================================
// 2. FUNCIONES GENERALES
// =====================================

function money(n) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(n);
}

function today() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function daysBetween(a, b) {
  return Math.round(
    (Date.parse(b + "T12:00:00Z") -
     Date.parse(a + "T12:00:00Z")) / 86400000
  );
}

function shiftDate(date, days) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(date) {
  if (!date) return "—";

  return new Date(date + "T12:00:00Z").toLocaleDateString(
    "es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }
  );
}

function quantity(n) {
  return Number(n.toFixed(2)).toLocaleString("es-MX", {
    maximumFractionDigits: 2
  });
}

let timer;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(timer);

  timer = setTimeout(() => {
    el.style.display = "none";
  }, 4200);
}

function save() {
  localStorage.setItem(STORAGE, JSON.stringify(state));
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date + "T12:00:00Z")) &&
    date <= today();
}

function positiveQty(q, product) {
  return Number.isFinite(q) &&
    q > 0 &&
    (product.unit === "kg" ||
     product.unit === "m³" ||
     Number.isInteger(q)) &&
    Math.abs(q * 100 - Math.round(q * 100)) < 0.00001;
}

// =====================================
// 3. CONTROL DE EXISTENCIAS
// =====================================

// Descuenta primero los productos
// de los lotes registrados más antiguos.

function consume(lots, id, qty) {
  let left = qty;
  let total = 0;

  for (const lot of lots[id]) {
    if (left <= 0.000001) break;

    const take = Math.min(lot.qty, left);
    total += take * lot.unitCost;
    lot.qty -= take;
    left -= take;
  }

  if (left > 0.000001) {
    throw Error(
      "Inventario insuficiente de " + state.products[id].name
    );
  }

  return total;
}

// =====================================
// 4. CÁLCULOS FINANCIEROS
// =====================================

function calculate(events = state.events) {
  const lots = state.products.map(() => []);
  const sold = state.products.map(() => 0);
  const salesDays = state.products.map(() => ({}));

  const supplier = {
    Monterrey: { goods: 0, fees: 0 },
    Lampazos: { goods: 0, fees: 0 }
  };

  let revenue = 0;
  let cogs = 0;
  let loss = 0;
  let purchases = 0;

  const history = [];

  for (const e of events) {
    let amount = 0;
    let detail = "";

    // ENTRADA DE MERCANCÍA
    if (e.type === "entrada") {
      const subtotal = e.items.reduce(
        (sum, item) => sum + item.qty * item.cost, 0
      );

      const fees = e.freight + e.handling;

      if (subtotal === 0 && fees > 0) {
        throw Error("No se pueden distribuir los gastos.");
      }

      for (const item of e.items) {
        const productCost = item.qty * item.cost;
        const allocated = subtotal > 0
          ? fees * productCost / subtotal
          : 0;

        lots[item.id].push({
          qty: item.qty,
          unitCost: item.cost + allocated / item.qty
        });
      }

      amount = subtotal + fees;

      detail = e.items.map(item =>
        `${state.products[item.id].name} (${quantity(item.qty)})`
      ).join(", ");

      if (e.kind === "compra") {
        supplier[e.origin].goods += subtotal;
        supplier[e.origin].fees += fees;
        purchases += amount;
      }
    }

    // VENTAS
    else if (e.type === "venta") {
      for (const item of e.items) {
        amount += item.qty * item.price;

        cogs += consume(lots, item.id, item.qty);
        sold[item.id] += item.qty;

        salesDays[item.id][e.date] =
          (salesDays[item.id][e.date] || 0) + item.qty;
      }

      revenue += amount;

      detail = e.items.map(item =>
        `${state.products[item.id].name} (${quantity(item.qty)})`
      ).join(", ");
    }

    // SALIDAS SIN VENTA
    else if (e.type === "salida") {
      amount = consume(lots, e.idProduct, e.qty);
      loss += amount;

      detail =
        `${state.products[e.idProduct].name} ` +
        `(${quantity(e.qty)}), ${e.reason}`;
    } else {
      throw Error("Tipo de movimiento desconocido.");
    }

    history.push({ ...e, amount, detail });
  }

  const stock = lots.map(list =>
    list.reduce((sum, lot) => sum + lot.qty, 0)
  );

  // Reserva estimada para reponer lo vendido.
  const reserve = state.products.reduce((sum, p) => {
    const s = supplier[p.origin];
    const feesRatio = s.goods ? s.fees / s.goods : 0;

    return sum +
      sold[p.id] * p.cost * (1 + feesRatio);
  }, 0);

  return {
    stock,
    sold,
    salesDays,
    supplier,
    revenue,
    cogs,
    loss,
    reserve,
    purchases,
    profit: revenue - cogs - loss,
    free: revenue - reserve - loss,
    history
  };
}

function record(event) {
  if (!validDate(event.date)) {
    throw Error("Ingresa una fecha válida, no posterior a hoy.");
  }

  calculate([...state.events, event]);

  state.events.push(event);
  save();
  render();
}

// =====================================
// 5. ESTIMACIÓN DE DEMANDA
// =====================================

// Calcula la cantidad promedio vendida al día
// utilizando hasta 30 días de historial.

function demand(product, results) {
  const days = results.salesDays[product.id];
  const dates = Object.keys(days).sort();
  const last30 = shiftDate(today(), -29);

  const recent = dates.filter(
    date => date >= last30 && date <= today()
  );

  if (!dates.length) {
    return {
      rate: product.estimate,
      manual: true
    };
  }

  const span = Math.max(
    1,
    Math.min(30, daysBetween(dates[0], today()) + 1)
  );

  const total = recent.reduce(
    (sum, date) => sum + days[date], 0
  );

  return {
    rate: total / span,
    manual: false
  };
}

// =====================================
// 6. PRONÓSTICO Y PRÓXIMO PEDIDO
// =====================================

function prediction(product, results) {
  const qty = results.stock[product.id];
  const d = demand(product, results);

  const lead = state.config[product.origin];
  const buffer = state.config.safety;
  const cycle = state.config.cycle;

  // Sin existencias
  if (qty < 0.00001) {
    return {
      ...d,
      qty,
      days: 0,
      end: today(),
      order: today(),
      need: Math.ceil(d.rate * (cycle + lead + buffer)),
      status: "Agotado",
      klass: "danger"
    };
  }

  // Sin ventas registradas
  if (!d.rate) {
    return {
      ...d,
      qty,
      days: null,
      end: null,
      order: null,
      need: null,
      status: "Sin ventas",
      klass: "quiet"
    };
  }

  // Días que durará la existencia
  const duration = qty / d.rate;

  // Fecha estimada de agotamiento
  const end = shiftDate(
    today(),
    Math.max(0, Math.floor(duration))
  );

  // Fecha recomendada para pedir
  const order = shiftDate(
    today(),
    Math.max(0, Math.floor(duration - lead - buffer))
  );

  // ¿Es urgente?
  const urgent = duration <= lead + buffer;

  // Cantidad recomendada
  const orderQty = Math.max(
    0,
    d.rate * (cycle + lead + buffer) - qty
  );

  const need = ["kg", "m³"].includes(product.unit)
    ? Math.ceil(orderQty * 100) / 100
    : Math.ceil(orderQty);

  let status = "Suficiente";
  let klass = "ok";

  if (urgent) {
    status = "Pedir ahora";
    klass = "danger";
  } else if (duration <= lead + buffer + 3) {
    status = "Próximo pedido";
    klass = "warn";
  }

  return {
    ...d,
    qty,
    days: duration,
    end,
    order,
    need,
    status,
    klass
  };
}

// =====================================
// 7. NAVEGACIÓN
// =====================================

function showPage(page) {
  document.querySelectorAll(".page").forEach(el => {
    el.classList.toggle("active", el.id === page);
  });

  document.querySelectorAll("nav button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("navigation").addEventListener("click", e => {
  const button = e.target.closest("button[data-page]");

  if (button) {
    showPage(button.dataset.page);
  }
});

// =====================================
// 8. ACTUALIZAR EL PANEL
// =====================================

function render() {
  let results;

  try {
    results = calculate();
  } catch (error) {
    toast(error.message);
    return;
  }

  $("k-sales").textContent = money(results.revenue);
  $("k-profit").textContent = money(results.profit);
  $("k-reserve").textContent = money(results.reserve);
  $("k-free").textContent = money(results.free);

  $("d-mty").textContent = state.config.Monterrey;
  $("d-lmp").textContent = state.config.Lampazos;

  const predictions = state.products.map(p => ({
    p,
    f: prediction(p, results)
  }));


//======================================
// 9. EDITAR PRODUCTOS CON VENTANA
// =====================================

const editModal = $("edit-modal");

// Abrir ventana de edición
$("inventory-body").addEventListener("click", e => {

  const button = e.target.closest("[data-edit]");

  if (!button) return;

  const id = Number(button.dataset.edit);
  const p = state.products[id];

  if (!p) return;

  // Guardar el ID del producto
  $("edit-product-id").value = id;

  // Mostrar información
  $("edit-product-name").textContent = p.name;
  $("edit-product-origin").textContent =
    "Proveedor: " + p.origin;

  // Cargar los valores actuales
  $("edit-cost").value = p.cost;
  $("edit-price").value = p.price;
  $("edit-estimate").value = p.estimate;

  // Abrir cuadro personalizado
  editModal.showModal();

});

// Cancelar edición
$("edit-cancel").addEventListener("click", () => {
  editModal.close();
});

// Guardar cambios del producto
$("edit-form").addEventListener("submit", e => {

  e.preventDefault();

  const id = Number($("edit-product-id").value);
  const p = state.products[id];

  if (!p) return;

  const cost = Number($("edit-cost").value);
  const price = Number($("edit-price").value);
  const estimate = Number($("edit-estimate").value);

  // Validar los datos
  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(price) ||
    !Number.isFinite(estimate) ||
    cost < 0 ||
    price < 0 ||
    estimate < 0
  ) {
    alert("Ingresa valores válidos.");
    return;
  }

  // Actualizar el producto
  p.cost = cost;
  p.price = price;
  p.estimate = estimate;

  // Guardar en almacenamiento
  save();

  // Actualizar inventario
  render();

  // Actualizar precios en formularios
  refreshLines();

  // Cerrar ventana
  editModal.close();

  // Mostrar confirmación
  toast("Producto actualizado correctamente.");

});

// =====================================
// 10. EDITAR PRODUCTOS
// =====================================

$("inventory-body").addEventListener("click", e => {
  const button = e.target.closest("[data-edit]");
  if (!button) return;

  const p = state.products[Number(button.dataset.edit)];

  const cost = prompt("Costo de compra de " + p.name, p.cost);
  if (cost === null) return;

  const price = prompt("Precio de venta", p.price);
  if (price === null) return;

  const estimate = prompt(
    "Venta diaria inicial estimada",
    p.estimate
  );
  if (estimate === null) return;

  const values = [cost, price, estimate].map(Number);

  if (values.some(n => !Number.isFinite(n) || n < 0)) {
    alert("Ingresa cantidades válidas.");
    return;
  }

  [p.cost, p.price, p.estimate] = values;

  save();
  render();
  refreshLines();
  toast("Producto actualizado.");
});

// =====================================
// 11. HISTORIAL Y ANULACIONES
// =====================================

$("history-filter").addEventListener("change", render);

$("history-body").addEventListener("click", e => {
  const button = e.target.closest("[data-remove]");
  if (!button) return;

  const index = Number(button.dataset.remove);

  if (!confirm("¿Anular este movimiento?")) return;

  try {
    const remaining = state.events.filter(
      (_, i) => i !== index
    );

    calculate(remaining);
    state.events = remaining;

    save();
    render();
    toast("Movimiento anulado.");
  } catch (error) {
    alert("No se puede anular: " + error.message);
  }
});

// =====================================
// 12. AGREGAR PRODUCTOS A FORMULARIOS
// =====================================

function createLine(kind) {
  const isSale = kind === "venta";

  const container = $(isSale ? "sale-lines" : "buy-lines");
  const origin = $("buy-origin").value;

  const products = isSale
    ? state.products
    : state.products.filter(p => p.origin === origin);

  const line = document.createElement("div");
  line.className = "line";

  line.innerHTML = `
    <label>
      Producto
      <select class="line-product">
        ${products.map(p => `
          <option value="${p.id}">${esc(p.name)}</option>
        `).join("")}
      </select>
    </label>

    <label>
      Cantidad
      <input class="line-qty" type="number"
             min="0.01" step="any" required>
    </label>

    <label>
      ${isSale ? "Precio" : "Costo"} unitario ($)
      <input class="line-price" type="number"
             min="0" step="0.01" required>
    </label>

    <button type="button"
            class="btn danger-button small line-delete">
      ✕
    </button>
  `;

  container.appendChild(line);

  const select = line.querySelector(".line-product");
  const priceInput = line.querySelector(".line-price");

  function changePrice() {
    const p = state.products[Number(select.value)];
    priceInput.value = isSale ? p.price : p.cost;
  }

  select.addEventListener("change", () => {
    changePrice();
    updateTotal(kind);
  });

  line.addEventListener("input", () => updateTotal(kind));

  line.querySelector(".line-delete").onclick = () => {
    line.remove();
    updateTotal(kind);
  };

  changePrice();
  updateTotal(kind);
}

function updateTotal(kind) {
  const isSale = kind === "venta";
  const container = $(isSale ? "sale-lines" : "buy-lines");

  let total = 0;

  container.querySelectorAll(".line").forEach(line => {
    const qty = Number(
      line.querySelector(".line-qty").value
    ) || 0;

    const price = Number(
      line.querySelector(".line-price").value
    ) || 0;

    total += qty * price;
  });

  if (!isSale) {
    total += Number($("freight").value) || 0;
    total += Number($("handling").value) || 0;
  }

  $(isSale ? "sale-total" : "buy-total").textContent =
    money(total);
}

function refreshLines() {
  document.querySelectorAll(
    "#sale-lines .line, #buy-lines .line"
  ).forEach(line => {
    const select = line.querySelector("select");
    const p = state.products[Number(select.value)];
    const isSale = Boolean(line.closest("#sale-lines"));

    line.querySelector(".line-price").value =
      isSale ? p.price : p.cost;
  });

  updateTotal("venta");
  updateTotal("entrada");
}

$("add-sale").onclick = () => createLine("venta");
$("add-buy").onclick = () => createLine("entrada");

$("buy-origin").addEventListener("change", () => {
  $("buy-lines").innerHTML = "";
  createLine("entrada");
});

$("freight").addEventListener("input", () => {
  updateTotal("entrada");
});

$("handling").addEventListener("input", () => {
  updateTotal("entrada");
});

// Obtener y validar los artículos.
function getLines(containerId, kind) {
  const rows = [
    ...$(containerId).querySelectorAll(".line")
  ];

  if (!rows.length) {
    throw Error("Agrega al menos un producto.");
  }

  const ids = new Set();

  return rows.map(row => {
    const id = Number(
      row.querySelector(".line-product").value
    );

    const qty = Number(
      row.querySelector(".line-qty").value
    );

    const value = Number(
      row.querySelector(".line-price").value
    );

    const p = state.products[id];

    if (!p || !positiveQty(qty, p)) {
      throw Error("Cantidad inválida.");
    }

    if (!Number.isFinite(value) || value < 0) {
      throw Error("Precio o costo inválido.");
    }

    if (ids.has(id)) {
      throw Error("Producto repetido: " + p.name);
    }

    ids.add(id);

    return kind === "venta"
      ? { id, qty, price: value }
      : { id, qty, cost: value };
  });
}

// =====================================
// 13. GUARDAR VENTAS
// =====================================

$("sale-form").addEventListener("submit", e => {
  e.preventDefault();

  try {
    record({
      type: "venta",
      date: $("sale-date").value,
      note: $("sale-note").value.trim(),
      items: getLines("sale-lines", "venta")
    });

    $("sale-form").reset();
    $("sale-lines").innerHTML = "";
    $("sale-date").value = today();

    createLine("venta");
    toast("Venta guardada correctamente.");
  } catch (error) {
    alert(error.message);
  }
});

// =====================================
// 14. GUARDAR ENTRADAS
// =====================================

$("buy-form").addEventListener("submit", e => {
  e.preventDefault();

  try {
    const freight = Number($("freight").value);
    const handling = Number($("handling").value);

    if (!Number.isFinite(freight) ||
        !Number.isFinite(handling) ||
        freight < 0 || handling < 0) {
      throw Error("Gastos inválidos.");
    }

    const origin = $("buy-origin").value;
    const items = getLines("buy-lines", "entrada");

    if (items.some(item =>
      state.products[item.id].origin !== origin
    )) {
      throw Error("Producto del proveedor incorrecto.");
    }

    record({
      type: "entrada",
      kind: $("buy-kind").value,
      date: $("buy-date").value,
      origin,
      note: $("buy-note").value.trim(),
      items,
      freight,
      handling
    });

    $("buy-form").reset();
    $("buy-lines").innerHTML = "";
    $("buy-date").value = today();

    createLine("entrada");
    toast("Entrada guardada correctamente.");
  } catch (error) {
    alert(error.message);
  }
});

// =====================================
// 15. GUARDAR SALIDAS
// =====================================

$("out-form").addEventListener("submit", e => {
  e.preventDefault();

  try {
    const idProduct = Number($("out-product").value);
    const qty = Number($("out-qty").value);

    if (!positiveQty(qty, state.products[idProduct])) {
      throw Error("Cantidad inválida.");
    }

    record({
      type: "salida",
      date: $("out-date").value,
      idProduct,
      qty,
      reason: $("out-reason").value,
      note: ""
    });

    $("out-qty").value = "";
    toast("Salida registrada.");
  } catch (error) {
    alert(error.message);
  }
});

// =====================================
// 16. CONFIGURACIÓN DE PROVEEDORES
// =====================================

$("config-form").addEventListener("submit", e => {
  e.preventDefault();

  const cycle = Number($("cycle").value);
  const safety = Number($("safety").value);
  const Monterrey = Number($("days-mty").value);
  const Lampazos = Number($("days-lmp").value);

  if (
    ![cycle, safety, Monterrey, Lampazos].every(Number.isInteger) ||
    cycle < 7 || cycle > 120 ||
    safety < 0 || safety > 30 ||
    Monterrey < 1 || Monterrey > 30 ||
    Lampazos < 1 || Lampazos > 30
  ) {
    alert("Revisa los días ingresados.");
    return;
  }

  state.config = {
    cycle,
    safety,
    Monterrey,
    Lampazos
  };

  save();
  render();
  toast("Configuración guardada.");
});

// =====================================
// 17. EXPORTAR RESPALDO
// =====================================

$("export").onclick = () => {
  const blob = new Blob(
    [JSON.stringify(state, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "ferreteria-respaldo-" + ".json";
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// =====================================
// 18. IMPORTAR RESPALDO
// =====================================

$("import").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());

    if (
      !data ||
      !Array.isArray(data.products) ||
      data.products.length !== 12 ||
      !Array.isArray(data.events) ||
      !data.config ||
      data.events.length > 20000 ||
      data.products.some((p, i) =>
        p.name !== BASE[i][0] ||
        p.origin !== BASE[i][1] ||
        p.id !== i ||
        ![p.cost, p.price, p.estimate].every(
          n => Number.isFinite(n) && n >= 0
        )
      )
    ) {
      throw Error("Archivo incompatible.");
    }

    const backup = state;
    state = data;

    try {
      calculate();

      if (
        !Number.isInteger(state.config.cycle) ||
        !Number.isInteger(state.config.safety) ||
        ![
          state.config.Monterrey,
          state.config.Lampazos
        ].every(Number.isInteger)
      ) {
        throw Error("Configuración inválida.");
      }
    } catch (error) {
      state = backup;
      throw error;
    }

    if (!confirm("¿Reemplazar los datos actuales?")) {
      state = backup;
      return;
    }

    save();
    location.reload();

  } catch (error) {
    alert("Error al importar: " + error.message);
  } finally {
    e.target.value = "";
  }
});

// =====================================
// 19. REINICIAR SISTEMA
// =====================================

$("reset").onclick = () => {
  if (!confirm(
    "¿Borrar todo el inventario, ventas e historial?"
  )) {
    return;
  }

  state = fresh();
  save();
  location.reload();
};

// =====================================
// 20. INICIAR EL SISTEMA
// =====================================

function start() {
  $("sale-date").value = today();
  $("buy-date").value = today();
  $("out-date").value = today();

  $("cycle").value = state.config.cycle;
  $("safety").value = state.config.safety;
  $("days-mty").value = state.config.Monterrey;
  $("days-lmp").value = state.config.Lampazos;

  createLine("venta");
  createLine("entrada");

  render();
}

start();