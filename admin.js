// ──────────────────────────────────────────────────────────
// admin.js · Marchese Golosinas
// Panel de administración completo
// Colecciones Firestore: products, categories, brands, consultas
// Imágenes vía Cloudinary (upload directo desde el browser)
// ──────────────────────────────────────────────────────────

import { app, db } from "./firebase-config.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ──────────────────────────────────────────────────────────
// AUTH GUARD — redirigir a login si no hay sesión activa
// ──────────────────────────────────────────────────────────
const auth = getAuth(app);

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.replace("login.html");
  } else {
    // Mostrar email del usuario en el footer del sidebar
    const emailEl = document.getElementById("adminUserEmail");
    if (emailEl) emailEl.textContent = user.email;
  }
});

// ──────────────────────────────────────────────────────────
// CLOUDINARY — completar con tus credenciales
// ──────────────────────────────────────────────────────────
const CLOUDINARY_CLOUD_NAME = "dloroyhev";   // ← reemplazar
const CLOUDINARY_UPLOAD_PRESET = "marchese"; // ← reemplazar (unsigned preset)
// Cómo crear el upload preset:
//   Settings → Upload → Upload presets → Add upload preset
//   Signing mode: Unsigned · Folder: marchese (opcional)

// ──────────────────────────────────────────────────────────
// ESTADO GLOBAL
// ──────────────────────────────────────────────────────────
let allProducts   = [];
let allCategories = [];
let allBrands     = [];
let allConsultas  = [];

// Filtros activos
let prodSearch         = "";
let prodFilterCat      = "";
let prodFilterMarca    = "";
let prodFilterActive   = "";
let prodFilterTag      = "";
let catSearch          = "";
let marcaSearch        = "";
let consultaFilter     = "all";

// Id en edición (null = nuevo)
let editingProductId  = null;
let editingCatId      = null;
let editingMarcaId    = null;

// Imagen subida actual (URL Cloudinary o URL manual)
let currentImageUrl   = "";

// ──────────────────────────────────────────────────────────
// UTILIDADES
// ──────────────────────────────────────────────────────────

function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function debounce(fn, delay = 220) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function normalize(str = "") {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Toast
const toastContainer = document.getElementById("toastContainer");
function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : type === "warn" ? " warn" : "");
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// Confirm dialog
let _confirmResolve = null;
const confirmOverlay = document.getElementById("confirmOverlay");
const confirmTitle   = document.getElementById("confirmTitle");
const confirmDesc    = document.getElementById("confirmDesc");
const confirmOk      = document.getElementById("confirmOk");
const confirmCancel  = document.getElementById("confirmCancel");

function confirm(title, desc = "Esta acción no se puede deshacer.", okLabel = "Eliminar") {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    confirmTitle.textContent = title;
    confirmDesc.textContent  = desc;
    confirmOk.textContent    = okLabel;
    confirmOverlay.classList.add("open");
    lockBodyScroll();
  });
}
confirmOk.addEventListener("click", () => {
  confirmOverlay.classList.remove("open");
  unlockBodyScroll();
  _confirmResolve?.(true);
});
confirmCancel.addEventListener("click", () => {
  confirmOverlay.classList.remove("open");
  unlockBodyScroll();
  _confirmResolve?.(false);
});

// Bloquear scroll del fondo mientras hay un modal/overlay abierto
// (usa contador porque puede haber un modal + el confirm dialog abiertos a la vez)
let _openOverlayCount = 0;
function lockBodyScroll() {
  if (_openOverlayCount === 0) {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = scrollbarWidth + "px";
  }
  _openOverlayCount++;
}
function unlockBodyScroll() {
  _openOverlayCount = Math.max(0, _openOverlayCount - 1);
  if (_openOverlayCount === 0) {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }
}

// Modal helpers
function openModal(id) {
  document.getElementById(id).classList.add("open");
  lockBodyScroll();
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el.classList.contains("open")) {
    el.classList.remove("open");
    unlockBodyScroll();
  }
}
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
// Cerrar al hacer clic en overlay
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ──────────────────────────────────────────────────────────
// CERRAR SESIÓN
// ──────────────────────────────────────────────────────────
document.getElementById("btnLogout")?.addEventListener("click", async () => {
  const ok = await confirm("¿Cerrar sesión?", "Vas a salir del panel de administración.", "Salir");
  if (!ok) return;
  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch {
    toast("Error al cerrar sesión", "error");
  }
});

// ──────────────────────────────────────────────────────────
// NAVEGACIÓN ENTRE SECCIONES
// ──────────────────────────────────────────────────────────
const SECTION_TITLES = {
  productos:  "Productos",
  categorias: "Categorías",
  marcas:     "Marcas",
  banners:    "Banners publicitarios",
  consultas:  "Consultas",
};

function goTo(section) {
  document.querySelectorAll(".section-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("panel-" + section).classList.add("active");
  document.querySelector(`.nav-btn[data-section="${section}"]`).classList.add("active");
  document.getElementById("topbarTitle").textContent = SECTION_TITLES[section];
}

document.querySelectorAll(".nav-btn[data-section]").forEach(btn => {
  btn.addEventListener("click", () => {
    goTo(btn.dataset.section);
    // Cerrar sidebar en móvil
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarBackdrop").classList.remove("open");
  });
});

// Mobile sidebar toggle
document.getElementById("mobileMenuBtn").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebarBackdrop").classList.toggle("open");
});
document.getElementById("sidebarBackdrop").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarBackdrop").classList.remove("open");
});

// Sidebar colapsable (desktop) — se acuerda la preferencia entre visitas
const sidebarEl = document.getElementById("sidebar");
const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");

function setSidebarCollapsed(collapsed) {
  sidebarEl.classList.toggle("collapsed", collapsed);
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  sidebarToggleBtn.title = collapsed ? "Expandir sidebar" : "Contraer sidebar";
  localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
}

// Restaurar preferencia guardada al cargar
setSidebarCollapsed(localStorage.getItem("sidebarCollapsed") === "1");

sidebarToggleBtn.addEventListener("click", () => {
  setSidebarCollapsed(!sidebarEl.classList.contains("collapsed"));
});

// ──────────────────────────────────────────────────────────
// CLOUDINARY UPLOAD
// ──────────────────────────────────────────────────────────

async function uploadToCloudinary(file) {
  if (!CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME === "TU_CLOUD_NAME") {
    throw new Error("Configurá CLOUDINARY_CLOUD_NAME y CLOUDINARY_UPLOAD_PRESET en admin.js");
  }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: fd }
  );
  if (!res.ok) throw new Error("Error al subir imagen a Cloudinary");
  const data = await res.json();

  // URL optimizada: formato WebP forzado, calidad automática, ancho máximo 800px
  return data.secure_url.replace("/upload/", "/upload/f_webp,q_auto,w_800/");
}

// ──────────────────────────────────────────────────────────
// IMAGEN: lógica del área de upload en el modal de producto
// ──────────────────────────────────────────────────────────

const imgUploadArea    = document.getElementById("imgUploadArea");
const imgFileInput     = document.getElementById("imgFileInput");
const imgPreview       = document.getElementById("imgPreview");
const imgActions       = document.getElementById("imgActions");
const imgPlaceholder   = document.getElementById("imgUploadPlaceholder");
const imgUploadingState= document.getElementById("imgUploadingState");
const btnChangeImg     = document.getElementById("btnChangeImg");
const btnRemoveImg     = document.getElementById("btnRemoveImg");
const pImageUrl        = document.getElementById("p-image-url");

function setImagePreview(url) {
  currentImageUrl = url;
  imgUploadingState.style.display = "none";
  if (url) {
    imgPreview.src = url;
    imgPreview.style.display = "block";
    imgPlaceholder.style.display = "none";
    imgUploadArea.classList.add("has-image");
    imgActions.style.display = "flex";
    pImageUrl.value = url;
  } else {
    imgPreview.src = "";
    imgPreview.style.display = "none";
    imgPlaceholder.style.display = "block";
    imgUploadArea.classList.remove("has-image");
    imgActions.style.display = "none";
    pImageUrl.value = "";
  }
}

function resetImageArea() {
  setImagePreview("");
  imgUploadingState.style.display = "none";
  imgPlaceholder.style.display = "block";
}

imgUploadArea.addEventListener("click", (e) => {
  if (e.target.closest(".img-actions")) return;
  if (imgUploadArea.classList.contains("has-image")) return;
  imgFileInput.click();
});

// Drag & drop
imgUploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  imgUploadArea.style.borderColor = "var(--amber)";
});
imgUploadArea.addEventListener("dragleave", () => {
  imgUploadArea.style.borderColor = "";
});
imgUploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  imgUploadArea.style.borderColor = "";
  const file = e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});

imgFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleImageFile(file);
});

async function handleImageFile(file) {
  if (!file.type.startsWith("image/")) {
    toast("El archivo debe ser una imagen", "error");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast("La imagen no puede superar 5MB", "error");
    return;
  }

  // Mostrar estado de carga
  imgPlaceholder.style.display = "none";
  imgUploadingState.style.display = "flex";
  imgPreview.style.display = "none";
  imgActions.style.display = "none";
  imgUploadArea.classList.remove("has-image");

  try {
    const url = await uploadToCloudinary(file);
    setImagePreview(url);
    toast("Imagen subida correctamente");
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al subir la imagen", "error");
    imgUploadingState.style.display = "none";
    imgPlaceholder.style.display = "block";
  }
  imgFileInput.value = "";
}

btnChangeImg.addEventListener("click", () => {
  setImagePreview("");
  imgFileInput.click();
});
btnRemoveImg.addEventListener("click", () => setImagePreview(""));

// Sync URL manual → preview
pImageUrl.addEventListener("input", debounce(() => {
  const url = pImageUrl.value.trim();
  if (url) {
    currentImageUrl = url;
    imgPreview.src = url;
    imgPreview.style.display = "block";
    imgPlaceholder.style.display = "none";
    imgUploadArea.classList.add("has-image");
    imgActions.style.display = "flex";
  } else {
    resetImageArea();
  }
}, 400));

// Toggle label del estado activo/inactivo
document.getElementById("p-active").addEventListener("change", function () {
  document.getElementById("p-active-label").textContent = this.checked ? "Activo" : "Inactivo";
});
document.getElementById("c-active").addEventListener("change", function () {
  document.getElementById("c-active-label").textContent = this.checked ? "Activa" : "Inactiva";
});
document.getElementById("m-active").addEventListener("change", function () {
  document.getElementById("m-active-label").textContent = this.checked ? "Activa" : "Inactiva";
});

// ──────────────────────────────────────────────────────────
// FIRESTORE LISTENERS
// ──────────────────────────────────────────────────────────

function initListeners() {
  // Categorías
  onSnapshot(collection(db, "categories"), (snap) => {
    allCategories = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const oa = typeof a.order === "number" ? a.order : 9999;
        const ob = typeof b.order === "number" ? b.order : 9999;
        return oa - ob || (a.name || "").localeCompare(b.name || "", "es");
      });
    renderCategorias();
    refreshCategorySelects();
    renderProductosFilterSelects();
  });

  // Marcas
  onSnapshot(collection(db, "brands"), (snap) => {
    allBrands = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const oa = typeof a.order === "number" ? a.order : 9999;
        const ob = typeof b.order === "number" ? b.order : 9999;
        return oa - ob || (a.name || "").localeCompare(b.name || "", "es");
      });
    renderMarcas();
    refreshBrandSelects();
    renderProductosFilterSelects();
  });

  // Productos
  onSnapshot(collection(db, "products"), (snap) => {
    allProducts = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const oa = typeof a.order === "number" ? a.order : 9999;
        const ob = typeof b.order === "number" ? b.order : 9999;
        return oa - ob || (a.name || "").localeCompare(b.name || "", "es");
      });
    renderProductos();
  });

  // Consultas
  onSnapshot(collection(db, "consultas"), (snap) => {
    allConsultas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toDate?.() || new Date(0);
        const tb = b.createdAt?.toDate?.() || new Date(0);
        return tb - ta; // más recientes primero
      });
    renderConsultas();
    updateConsultasBadge();
  });

  // Banners
  onSnapshot(collection(db, "banners"), (snap) => {
    allBanners = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const oa = typeof a.order === "number" ? a.order : 9999;
        const ob = typeof b.order === "number" ? b.order : 9999;
        return oa - ob;
      });
    renderBanners();
  });
}

// ──────────────────────────────────────────────────────────
// RENDER: PRODUCTOS
// ──────────────────────────────────────────────────────────

function renderProductos() {
  const grid = document.getElementById("productosGrid");
  let list = [...allProducts];

  // Filtro categoría
  if (prodFilterCat) {
    list = list.filter(p => (p.category || "") === prodFilterCat);
  }
  // Filtro marca
  if (prodFilterMarca) {
    list = list.filter(p => (p.brand || "") === prodFilterMarca);
  }
  // Filtro activo/inactivo
  if (prodFilterActive === "active")   list = list.filter(p => p.active !== false);
  if (prodFilterActive === "inactive") list = list.filter(p => p.active === false);
  // Filtro tag
  if (prodFilterTag) {
    list = list.filter(p => (p.tag || "") === prodFilterTag);
  }
  // Búsqueda
  if (prodSearch) {
    const q = normalize(prodSearch);
    list = list.filter(p =>
      normalize(p.name || "").includes(q) ||
      normalize(p.category || "").includes(q) ||
      normalize(p.brand || "").includes(q) ||
      normalize(p.tag || "").includes(q) ||
      normalize(p.description || "").includes(q)
    );
  }

  // Contador
  document.getElementById("productosCount").textContent =
    `${allProducts.length} productos · ${allProducts.filter(p => p.active !== false).length} activos`;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14v14m0-14L4 7m0 0v10l8 4"/></svg>
      <p>No se encontraron productos</p>
    </div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const isActive = p.active !== false;

    const imgSection = p.image
      ? `<img class="prod-card-img" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
      : `<div class="prod-card-img-placeholder">
           <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
             <path stroke-linecap="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
           </svg>
         </div>`;

    const categoryBadge = p.category
      ? `<span class="badge badge-gray">${esc(p.category)}</span>`
      : "";

    const tagBadge = p.tag
      ? `<span class="badge badge-amber">${esc(p.tag)}</span>`
      : "";

    const statusBadge = `<span class="badge ${isActive ? "badge-green" : "badge-red"}">${isActive ? "Activo" : "Inactivo"}</span>`;

    const brandRow = p.brand
      ? `<div class="prod-card-info-row">
           <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M9 12l2 2 4-4"/></svg>
           <span>${esc(p.brand)}</span>
         </div>`
      : "";

    const toggleTitle = isActive ? "Desactivar" : "Activar";
    const toggleIcon = isActive
      ? `<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>`
      : `<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;

    return `<div class="prod-card${isActive ? "" : " inactive"}">
      ${imgSection}
      <div class="prod-card-body">
        <div class="prod-card-header">
          <div class="prod-card-name">${esc(p.name)}</div>
          ${statusBadge}
        </div>
        ${p.description ? `<div class="prod-card-desc">${esc(p.description)}</div>` : ""}
        <div class="prod-card-meta">
          ${categoryBadge}
          ${tagBadge}
        </div>
        ${brandRow}
      </div>
      <div class="prod-card-footer">
        <span class="prod-card-order">${typeof p.order === "number" ? `Orden: ${p.order}` : ""}</span>
        <div class="prod-card-actions">
          <button class="btn btn-ghost btn-icon" title="Editar" onclick="editProducto('${p.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon" title="${toggleTitle}" onclick="toggleProductoActive('${p.id}', ${isActive})">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              ${toggleIcon}
            </svg>
          </button>
          <button class="btn btn-danger btn-icon" title="Eliminar" onclick="deleteProducto('${p.id}', '${esc(p.name)}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join("");
}

// Selects de filtro "Marca" y "Categoría" del toolbar de productos
function renderProductosFilterSelects() {
  const catSel = document.getElementById("productosFilterCategoria");
  if (catSel) {
    catSel.innerHTML = `<option value="">Categoría</option>` +
      allCategories.filter(c => c.active !== false).map(c =>
        `<option value="${esc(c.name)}">${esc(c.name)}</option>`
      ).join("");
    catSel.value = prodFilterCat;
  }
  const marcaSel = document.getElementById("productosFilterMarca");
  if (marcaSel) {
    marcaSel.innerHTML = `<option value="">Marca</option>` +
      allBrands.filter(b => b.active !== false).map(b =>
        `<option value="${esc(b.name)}">${esc(b.name)}</option>`
      ).join("");
    marcaSel.value = prodFilterMarca;
  }
}

document.getElementById("productosFilterCategoria").addEventListener("change", e => {
  prodFilterCat = e.target.value;
  renderProductos();
});

document.getElementById("productosFilterMarca").addEventListener("change", e => {
  prodFilterMarca = e.target.value;
  renderProductos();
});

// Búsqueda y filtro activo
document.getElementById("productosSearch").addEventListener("input", debounce(e => {
  prodSearch = e.target.value.trim();
  renderProductos();
}));
document.getElementById("productosFilterActive").addEventListener("change", e => {
  prodFilterActive = e.target.value;
  renderProductos();
});
document.getElementById("productosFilterTag").addEventListener("change", e => {
  prodFilterTag = e.target.value;
  renderProductos();
});

// ──────────────────────────────────────────────────────────
// CRUD: PRODUCTOS
// ──────────────────────────────────────────────────────────

function refreshCategorySelects() {
  const sel = document.getElementById("p-category");
  const current = sel.value;
  sel.innerHTML = `<option value="">Seleccionar…</option>` +
    allCategories.filter(c => c.active !== false).map(c =>
      `<option value="${esc(c.name)}" ${c.name === current ? "selected" : ""}>${esc(c.name)}</option>`
    ).join("");
}

function refreshBrandSelects() {
  const sel = document.getElementById("p-brand");
  const current = sel.value;
  sel.innerHTML = `<option value="">Sin marca</option>` +
    allBrands.filter(b => b.active !== false).map(b =>
      `<option value="${esc(b.name)}" ${b.name === current ? "selected" : ""}>${esc(b.name)}</option>`
    ).join("");
}

function openModalNuevoProducto() {
  editingProductId = null;
  document.getElementById("modalProductoTitle").textContent = "Nuevo producto";
  document.getElementById("p-name").value = "";
  document.getElementById("p-category").value = "";
  document.getElementById("p-brand").value = "";
  document.getElementById("p-tag").value = "";
  document.getElementById("p-order").value = "";
  document.getElementById("p-description").value = "";
  document.getElementById("p-active").checked = true;
  document.getElementById("p-active-label").textContent = "Activo";
  resetImageArea();
  refreshCategorySelects();
  refreshBrandSelects();
  openModal("modalProducto");
  setTimeout(() => document.getElementById("p-name").focus(), 100);
}

window.editProducto = function(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  document.getElementById("modalProductoTitle").textContent = "Editar producto";
  document.getElementById("p-name").value = p.name || "";
  document.getElementById("p-tag").value = p.tag || "";
  document.getElementById("p-order").value = typeof p.order === "number" ? p.order : "";
  document.getElementById("p-description").value = p.description || "";
  document.getElementById("p-active").checked = p.active !== false;
  document.getElementById("p-active-label").textContent = p.active !== false ? "Activo" : "Inactivo";
  resetImageArea();
  refreshCategorySelects();
  refreshBrandSelects();
  document.getElementById("p-category").value = p.category || "";
  document.getElementById("p-brand").value = p.brand || "";
  if (p.image) setImagePreview(p.image);
  openModal("modalProducto");
};

window.toggleProductoActive = async function(id, isActive) {
  try {
    await updateDoc(doc(db, "products", id), { active: !isActive });
    toast(isActive ? "Producto desactivado" : "Producto activado");
  } catch (err) {
    console.error(err);
    toast("Error al actualizar", "error");
  }
};

window.deleteProducto = async function(id, name) {
  const ok = await confirm(`¿Eliminar "${name}"?`, "El producto se borrará permanentemente de Firestore.");
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "products", id));
    toast("Producto eliminado");
  } catch (err) {
    console.error(err);
    toast("Error al eliminar", "error");
  }
};

document.getElementById("btnNuevoProducto").addEventListener("click", openModalNuevoProducto);

document.getElementById("btnGuardarProducto").addEventListener("click", async () => {
  const name = document.getElementById("p-name").value.trim();
  const category = document.getElementById("p-category").value;
  const brand = document.getElementById("p-brand").value;
  const tag = document.getElementById("p-tag").value.trim();
  const orderVal = document.getElementById("p-order").value;
  const description = document.getElementById("p-description").value.trim();
  const active = document.getElementById("p-active").checked;

  // Sync imagen: si hay URL en el campo de texto, tomar esa
  const urlField = document.getElementById("p-image-url").value.trim();
  const image = urlField || currentImageUrl || "";

  if (!name) { toast("El nombre es obligatorio", "error"); document.getElementById("p-name").focus(); return; }
  if (!category) { toast("Seleccioná una categoría", "error"); document.getElementById("p-category").focus(); return; }

  const data = {
    name,
    category,
    brand,
    tag,
    description,
    active,
    image,
    ...(orderVal !== "" ? { order: parseInt(orderVal, 10) } : {}),
    updatedAt: serverTimestamp(),
  };

  const btn = document.getElementById("btnGuardarProducto");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    if (editingProductId) {
      await updateDoc(doc(db, "products", editingProductId), data);
      toast("Producto actualizado");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), data);
      toast("Producto creado");
    }
    closeModal("modalProducto");
  } catch (err) {
    console.error(err);
    toast("Error al guardar", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar producto`;
  }
});

// ──────────────────────────────────────────────────────────
// RENDER: CATEGORÍAS
// ──────────────────────────────────────────────────────────

function renderCategorias() {
  const tbody = document.getElementById("categoriasTableBody");
  const q = normalize(catSearch);
  let list = allCategories.filter(c => !q || normalize(c.name || "").includes(q));

  document.getElementById("categoriasCount").textContent =
    `${allCategories.length} categorías`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No hay categorías${q ? " que coincidan" : ""}</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const isActive = c.active !== false;
    const productsCount = allProducts.filter(p => p.category === c.name).length;
    return `<tr>
      <td style="font-weight:600">${esc(c.name)}</td>
      <td style="color:var(--text-muted); font-size:0.82rem">${typeof c.order === "number" ? c.order : "—"}</td>
      <td><span class="badge badge-gray">${productsCount} producto${productsCount !== 1 ? "s" : ""}</span></td>
      <td><span class="badge ${isActive ? "badge-green" : "badge-red"}">${isActive ? "Activa" : "Inactiva"}</span></td>
      <td>
        <div class="td-actions">
          <button class="btn btn-ghost btn-icon" title="Editar" onclick="editCategoria('${c.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon" title="${isActive ? "Desactivar" : "Activar"}" onclick="toggleCategoriaActive('${c.id}', ${isActive})">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              ${isActive
                ? '<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>'
                : '<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>'
              }
            </svg>
          </button>
          <button class="btn btn-danger btn-icon" title="Eliminar" onclick="deleteCategoria('${c.id}', '${esc(c.name)}', ${productsCount})">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

document.getElementById("categoriasSearch").addEventListener("input", debounce(e => {
  catSearch = e.target.value.trim();
  renderCategorias();
}));

// ──────────────────────────────────────────────────────────
// CRUD: CATEGORÍAS
// ──────────────────────────────────────────────────────────

document.getElementById("btnNuevaCategoria").addEventListener("click", () => {
  editingCatId = null;
  document.getElementById("modalCategoriaTitle").textContent = "Nueva categoría";
  document.getElementById("c-name").value = "";
  document.getElementById("c-order").value = "";
  document.getElementById("c-active").checked = true;
  document.getElementById("c-active-label").textContent = "Activa";
  openModal("modalCategoria");
  setTimeout(() => document.getElementById("c-name").focus(), 100);
});

window.editCategoria = function(id) {
  const c = allCategories.find(x => x.id === id);
  if (!c) return;
  editingCatId = id;
  document.getElementById("modalCategoriaTitle").textContent = "Editar categoría";
  document.getElementById("c-name").value = c.name || "";
  document.getElementById("c-order").value = typeof c.order === "number" ? c.order : "";
  document.getElementById("c-active").checked = c.active !== false;
  document.getElementById("c-active-label").textContent = c.active !== false ? "Activa" : "Inactiva";
  openModal("modalCategoria");
};

window.toggleCategoriaActive = async function(id, isActive) {
  try {
    await updateDoc(doc(db, "categories", id), { active: !isActive });
    toast(isActive ? "Categoría desactivada" : "Categoría activada");
  } catch (err) {
    toast("Error al actualizar", "error");
  }
};

window.deleteCategoria = async function(id, name, productsCount) {
  const desc = productsCount > 0
    ? `Tiene ${productsCount} producto${productsCount !== 1 ? "s" : ""} asignado${productsCount !== 1 ? "s" : ""}. Los productos no se eliminarán, pero quedarán sin categoría.`
    : "Esta acción no se puede deshacer.";
  const ok = await confirm(`¿Eliminar categoría "${name}"?`, desc);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "categories", id));
    toast("Categoría eliminada");
  } catch (err) {
    toast("Error al eliminar", "error");
  }
};

document.getElementById("btnGuardarCategoria").addEventListener("click", async () => {
  const name = document.getElementById("c-name").value.trim();
  const orderVal = document.getElementById("c-order").value;
  const active = document.getElementById("c-active").checked;

  if (!name) { toast("El nombre es obligatorio", "error"); document.getElementById("c-name").focus(); return; }

  // Evitar nombres duplicados
  const dup = allCategories.find(c => c.id !== editingCatId && normalize(c.name) === normalize(name));
  if (dup) { toast("Ya existe una categoría con ese nombre", "warn"); return; }

  const data = {
    name,
    active,
    ...(orderVal !== "" ? { order: parseInt(orderVal, 10) } : {}),
    updatedAt: serverTimestamp(),
  };

  const btn = document.getElementById("btnGuardarCategoria");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    if (editingCatId) {
      await updateDoc(doc(db, "categories", editingCatId), data);
      toast("Categoría actualizada");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "categories"), data);
      toast("Categoría creada");
    }
    closeModal("modalCategoria");
  } catch (err) {
    console.error(err);
    toast("Error al guardar", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar`;
  }
});

// ──────────────────────────────────────────────────────────
// RENDER: MARCAS
// ──────────────────────────────────────────────────────────

function renderMarcas() {
  const tbody = document.getElementById("marcasTableBody");
  const q = normalize(marcaSearch);
  let list = allBrands.filter(b => !q || normalize(b.name || "").includes(q));

  document.getElementById("marcasCount").textContent =
    `${allBrands.length} marcas`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No hay marcas${q ? " que coincidan" : ""}</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(b => {
    const isActive = b.active !== false;
    const productsCount = allProducts.filter(p => p.brand === b.name).length;
    return `<tr>
      <td style="font-weight:600">${esc(b.name)}</td>
      <td style="color:var(--text-muted); font-size:0.82rem">${typeof b.order === "number" ? b.order : "—"}</td>
      <td><span class="badge badge-gray">${productsCount} producto${productsCount !== 1 ? "s" : ""}</span></td>
      <td><span class="badge ${isActive ? "badge-green" : "badge-red"}">${isActive ? "Activa" : "Inactiva"}</span></td>
      <td>
        <div class="td-actions">
          <button class="btn btn-ghost btn-icon" title="Editar" onclick="editMarca('${b.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon" title="${isActive ? "Desactivar" : "Activar"}" onclick="toggleMarcaActive('${b.id}', ${isActive})">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              ${isActive
                ? '<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>'
                : '<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>'
              }
            </svg>
          </button>
          <button class="btn btn-danger btn-icon" title="Eliminar" onclick="deleteMarca('${b.id}', '${esc(b.name)}', ${productsCount})">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

document.getElementById("marcasSearch").addEventListener("input", debounce(e => {
  marcaSearch = e.target.value.trim();
  renderMarcas();
}));

// ──────────────────────────────────────────────────────────
// CRUD: MARCAS
// ──────────────────────────────────────────────────────────

document.getElementById("btnNuevaMarca").addEventListener("click", () => {
  editingMarcaId = null;
  document.getElementById("modalMarcaTitle").textContent = "Nueva marca";
  document.getElementById("m-name").value = "";
  document.getElementById("m-order").value = "";
  document.getElementById("m-active").checked = true;
  document.getElementById("m-active-label").textContent = "Activa";
  openModal("modalMarca");
  setTimeout(() => document.getElementById("m-name").focus(), 100);
});

window.editMarca = function(id) {
  const b = allBrands.find(x => x.id === id);
  if (!b) return;
  editingMarcaId = id;
  document.getElementById("modalMarcaTitle").textContent = "Editar marca";
  document.getElementById("m-name").value = b.name || "";
  document.getElementById("m-order").value = typeof b.order === "number" ? b.order : "";
  document.getElementById("m-active").checked = b.active !== false;
  document.getElementById("m-active-label").textContent = b.active !== false ? "Activa" : "Inactiva";
  openModal("modalMarca");
};

window.toggleMarcaActive = async function(id, isActive) {
  try {
    await updateDoc(doc(db, "brands", id), { active: !isActive });
    toast(isActive ? "Marca desactivada" : "Marca activada");
  } catch (err) {
    toast("Error al actualizar", "error");
  }
};

window.deleteMarca = async function(id, name, productsCount) {
  const desc = productsCount > 0
    ? `Tiene ${productsCount} producto${productsCount !== 1 ? "s" : ""} asignado${productsCount !== 1 ? "s" : ""}. Los productos no se eliminarán, pero quedarán sin marca.`
    : "Esta acción no se puede deshacer.";
  const ok = await confirm(`¿Eliminar marca "${name}"?`, desc);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "brands", id));
    toast("Marca eliminada");
  } catch (err) {
    toast("Error al eliminar", "error");
  }
};

document.getElementById("btnGuardarMarca").addEventListener("click", async () => {
  const name = document.getElementById("m-name").value.trim();
  const orderVal = document.getElementById("m-order").value;
  const active = document.getElementById("m-active").checked;

  if (!name) { toast("El nombre es obligatorio", "error"); document.getElementById("m-name").focus(); return; }

  const dup = allBrands.find(b => b.id !== editingMarcaId && normalize(b.name) === normalize(name));
  if (dup) { toast("Ya existe una marca con ese nombre", "warn"); return; }

  const data = {
    name,
    active,
    ...(orderVal !== "" ? { order: parseInt(orderVal, 10) } : {}),
    updatedAt: serverTimestamp(),
  };

  const btn = document.getElementById("btnGuardarMarca");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    if (editingMarcaId) {
      await updateDoc(doc(db, "brands", editingMarcaId), data);
      toast("Marca actualizada");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "brands"), data);
      toast("Marca creada");
    }
    closeModal("modalMarca");
  } catch (err) {
    console.error(err);
    toast("Error al guardar", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar`;
  }
});

// ──────────────────────────────────────────────────────────
// RENDER: CONSULTAS
// ──────────────────────────────────────────────────────────

function renderConsultas() {
  const container = document.getElementById("consultasList");
  let list = [...allConsultas];

  if (consultaFilter === "unread") list = list.filter(c => !c.read);
  if (consultaFilter === "read")   list = list.filter(c =>  c.read);

  const unreadCount = allConsultas.filter(c => !c.read).length;
  document.getElementById("consultasCount").textContent =
    `${allConsultas.length} consulta${allConsultas.length !== 1 ? "s" : ""} · ${unreadCount} sin leer`;

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
      <p>No hay consultas${consultaFilter !== "all" ? " en este filtro" : ""}</p>
    </div>`;
    return;
  }

  container.innerHTML = list.map(c => {
    const initials = (c.name || "?").trim().split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
    const isUnread = !c.read;
    return `<div class="consulta-card ${isUnread ? "unread" : ""}">
      <div class="consulta-avatar">${esc(initials)}</div>
      <div style="flex:1; min-width:0;">
        <div class="consulta-name">
          ${esc(c.name)}
          ${isUnread ? '<span class="badge badge-amber" style="margin-left:0.5rem; font-size:0.6rem;">Nuevo</span>' : ""}
        </div>
        <div class="consulta-msg">${esc(c.message)}</div>
        <div class="consulta-meta">${formatDate(c.createdAt)}</div>
      </div>
      <div class="consulta-actions">
        ${isUnread
          ? `<button class="btn btn-ghost btn-sm" onclick="marcarLeida('${c.id}')">Marcar leída</button>`
          : `<button class="btn btn-ghost btn-sm" style="opacity:0.5;" onclick="marcarNoLeida('${c.id}')">Marcar no leída</button>`
        }
        <button class="btn btn-danger btn-icon" title="Eliminar" onclick="deleteConsulta('${c.id}', '${esc(c.name)}')">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>
    </div>`;
  }).join("");
}

function updateConsultasBadge() {
  const count = allConsultas.filter(c => !c.read).length;
  const badge = document.getElementById("consultasBadge");
  if (count > 0) {
    badge.style.display = "flex";
    badge.textContent = count > 99 ? "99+" : count;
  } else {
    badge.style.display = "none";
  }
}

// Filtros de consultas
document.getElementById("consultasFilterTabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-tab");
  if (!btn) return;
  consultaFilter = btn.dataset.filter;
  document.querySelectorAll("#consultasFilterTabs .filter-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderConsultas();
});

window.marcarLeida = async function(id) {
  try {
    await updateDoc(doc(db, "consultas", id), { read: true });
  } catch (err) {
    toast("Error al actualizar", "error");
  }
};

window.marcarNoLeida = async function(id) {
  try {
    await updateDoc(doc(db, "consultas", id), { read: false });
  } catch (err) {
    toast("Error al actualizar", "error");
  }
};

window.deleteConsulta = async function(id, name) {
  const ok = await confirm(`¿Eliminar consulta de "${name}"?`);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "consultas", id));
    toast("Consulta eliminada");
  } catch (err) {
    toast("Error al eliminar", "error");
  }
};

document.getElementById("btnMarcarTodasLeidas").addEventListener("click", async () => {
  const unread = allConsultas.filter(c => !c.read);
  if (unread.length === 0) { toast("No hay consultas sin leer", "warn"); return; }

  try {
    const batch = writeBatch(db);
    unread.forEach(c => batch.update(doc(db, "consultas", c.id), { read: true }));
    await batch.commit();
    toast(`${unread.length} consulta${unread.length !== 1 ? "s" : ""} marcada${unread.length !== 1 ? "s" : ""} como leída${unread.length !== 1 ? "s" : ""}`);
  } catch (err) {
    console.error(err);
    toast("Error al actualizar", "error");
  }
});

// ──────────────────────────────────────────────────────────
// BANNERS — carrusel publicitario del hero
// Colección Firestore: banners
// Campos: title (str), imageUrl (str), order (int), active (bool),
//         createdAt, updatedAt (serverTimestamp)
// ──────────────────────────────────────────────────────────

let allBanners       = [];
let editingBannerId  = null;
let currentBannerImageUrl = "";

// ── Upload area del modal banner ─────────────────────────

const bannerImgUploadArea    = document.getElementById("bannerImgUploadArea");
const bannerImgFileInput     = document.getElementById("bannerImgFileInput");
const bannerImgPreview       = document.getElementById("bannerImgPreview");
const bannerImgPlaceholder   = document.getElementById("bannerImgUploadPlaceholder");
const bannerImgUploadingState = document.getElementById("bannerImgUploadingState");
const bannerImgActions       = document.getElementById("bannerImgActions");

function showBannerImagePreview(url) {
  currentBannerImageUrl = url;
  bannerImgPreview.src = url;
  bannerImgPreview.style.display = "block";
  bannerImgPlaceholder.style.display = "none";
  bannerImgUploadingState.style.display = "none";
  bannerImgActions.style.display = "flex";
}

function clearBannerImagePreview() {
  currentBannerImageUrl = "";
  bannerImgPreview.src = "";
  bannerImgPreview.style.display = "none";
  bannerImgPlaceholder.style.display = "block";
  bannerImgUploadingState.style.display = "none";
  bannerImgActions.style.display = "none";
  bannerImgFileInput.value = "";
  document.getElementById("bn-image-url").value = "";
}

bannerImgUploadArea.addEventListener("click", (e) => {
  if (e.target.closest(".img-actions")) return;
  bannerImgFileInput.click();
});

bannerImgFileInput.addEventListener("change", async () => {
  const file = bannerImgFileInput.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast("La imagen no debe superar 5 MB", "error"); return; }

  bannerImgPlaceholder.style.display = "none";
  bannerImgUploadingState.style.display = "flex";
  bannerImgPreview.style.display = "none";
  bannerImgActions.style.display = "none";

  try {
    const url = await uploadToCloudinary(file);
    document.getElementById("bn-image-url").value = url;
    showBannerImagePreview(url);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al subir la imagen", "error");
    clearBannerImagePreview();
  }
});

// Drag & drop
bannerImgUploadArea.addEventListener("dragover", (e) => { e.preventDefault(); bannerImgUploadArea.classList.add("drag-over"); });
bannerImgUploadArea.addEventListener("dragleave", () => bannerImgUploadArea.classList.remove("drag-over"));
bannerImgUploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  bannerImgUploadArea.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) return;
  bannerImgFileInput.files = e.dataTransfer.files;
  bannerImgFileInput.dispatchEvent(new Event("change"));
});

document.getElementById("btnChangeBannerImg").addEventListener("click", () => {
  clearBannerImagePreview();
  bannerImgFileInput.click();
});
document.getElementById("btnRemoveBannerImg").addEventListener("click", clearBannerImagePreview);

// Sync URL manual → preview
document.getElementById("bn-image-url").addEventListener("input", (e) => {
  const url = e.target.value.trim();
  if (url) showBannerImagePreview(url);
  else clearBannerImagePreview();
});

// Toggle estado
document.getElementById("bn-active").addEventListener("change", function () {
  document.getElementById("bn-active-label").textContent = this.checked ? "Activo" : "Inactivo";
});

// ── Render tabla banners ─────────────────────────────────

function renderBanners() {
  const tbody = document.getElementById("bannersTableBody");
  document.getElementById("bannersCount").textContent =
    `${allBanners.length} banner${allBanners.length !== 1 ? "s" : ""}`;

  if (allBanners.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path stroke-linecap="round" d="M3 10h18"/></svg>
      <p>No hay banners. Creá el primero.</p>
    </div></td></tr>`;
    return;
  }

  const sorted = [...allBanners].sort((a, b) => {
    const oA = typeof a.order === "number" ? a.order : Infinity;
    const oB = typeof b.order === "number" ? b.order : Infinity;
    return oA !== oB ? oA - oB : 0;
  });

  tbody.innerHTML = sorted.map(b => `
    <tr>
      <td>
        ${b.imageUrl
          ? `<img src="${esc(b.imageUrl)}" alt="${esc(b.title || '')}" style="width:90px; height:60px; object-fit:cover; border-radius:6px; border:1px solid var(--border);">`
          : `<span style="color:var(--text-muted); font-size:0.8rem;">Sin imagen</span>`
        }
      </td>
      <td style="font-size:0.85rem; color:var(--text-mid);">${esc(b.title || "—")}</td>
      <td style="font-size:0.85rem;">${typeof b.order === "number" ? b.order : "—"}</td>
      <td>
        <span class="badge ${b.active !== false ? 'badge-green' : 'badge-red'}">
          ${b.active !== false ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-icon" title="Editar" onclick="editBanner('${b.id}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          <button class="btn btn-danger btn-icon" title="Eliminar" onclick="deleteBanner('${b.id}', '${esc(b.title || "este banner")}')">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`
  ).join("");
}

// ── Abrir modal nuevo ────────────────────────────────────

document.getElementById("btnNuevoBanner").addEventListener("click", () => {
  editingBannerId = null;
  document.getElementById("modalBannerTitle").textContent = "Nuevo banner";
  document.getElementById("bn-title").value = "";
  document.getElementById("bn-order").value = "";
  document.getElementById("bn-active").checked = true;
  document.getElementById("bn-active-label").textContent = "Activo";
  clearBannerImagePreview();
  openModal("modalBanner");
});

// ── Editar banner ────────────────────────────────────────

window.editBanner = function(id) {
  const b = allBanners.find(x => x.id === id);
  if (!b) return;
  editingBannerId = id;
  document.getElementById("modalBannerTitle").textContent = "Editar banner";
  document.getElementById("bn-title").value  = b.title  || "";
  document.getElementById("bn-order").value  = typeof b.order === "number" ? b.order : "";
  document.getElementById("bn-active").checked = b.active !== false;
  document.getElementById("bn-active-label").textContent = b.active !== false ? "Activo" : "Inactivo";
  clearBannerImagePreview();
  if (b.imageUrl) {
    document.getElementById("bn-image-url").value = b.imageUrl;
    showBannerImagePreview(b.imageUrl);
  }
  openModal("modalBanner");
};

// ── Guardar banner ───────────────────────────────────────

document.getElementById("btnGuardarBanner").addEventListener("click", async () => {
  const imageUrl = currentBannerImageUrl || document.getElementById("bn-image-url").value.trim();
  if (!imageUrl) {
    toast("Subí o pegá una imagen antes de guardar", "error");
    return;
  }

  const orderVal = document.getElementById("bn-order").value;
  const data = {
    title:    document.getElementById("bn-title").value.trim(),
    imageUrl,
    active:   document.getElementById("bn-active").checked,
    updatedAt: serverTimestamp(),
    ...(orderVal !== "" ? { order: parseInt(orderVal, 10) } : {}),
  };

  const btn = document.getElementById("btnGuardarBanner");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    if (editingBannerId) {
      await updateDoc(doc(db, "banners", editingBannerId), data);
      toast("Banner actualizado");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "banners"), data);
      toast("Banner creado");
    }
    closeModal("modalBanner");
  } catch (err) {
    console.error(err);
    toast("Error al guardar", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Guardar banner`;
  }
});

// ── Eliminar banner ──────────────────────────────────────

window.deleteBanner = async function(id, name) {
  const ok = await confirm(`¿Eliminar "${name}"?`, "Esta acción no se puede deshacer.");
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "banners", id));
    toast("Banner eliminado");
  } catch (err) {
    toast("Error al eliminar", "error");
  }
};

// ──────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────

initListeners();
