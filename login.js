import { app } from "./firebase-config.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const auth = getAuth(app);

// ──────────────────────────────────────────────────────────
// ERROR INLINE
// ──────────────────────────────────────────────────────────
const formError     = document.getElementById("formError");
const formErrorText = document.getElementById("formErrorText");
const emailInput    = document.getElementById("email");
const passwordInput = document.getElementById("password");

function showError(msg) {
    formErrorText.textContent = msg;
    formError.classList.add("visible");
    // Sacamos el estado de error de los campos al mostrar el mensaje
    emailInput.classList.add("field-error");
    passwordInput.classList.add("field-error");
}

function clearError() {
    formError.classList.remove("visible");
    emailInput.classList.remove("field-error");
    passwordInput.classList.remove("field-error");
}

// Limpia el error al empezar a tipear
emailInput.addEventListener("input", clearError);
passwordInput.addEventListener("input", clearError);

// ──────────────────────────────────────────────────────────
// OJO — MOSTRAR/OCULTAR CONTRASEÑA
// ──────────────────────────────────────────────────────────
const togglePw  = document.getElementById("togglePw");
const iconEyeOff = document.getElementById("iconEyeOff");
const iconEyeOn  = document.getElementById("iconEyeOn");

togglePw.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type   = isHidden ? "text" : "password";
    iconEyeOff.style.display = isHidden ? "none"  : "block";
    iconEyeOn.style.display  = isHidden ? "block" : "none";
    togglePw.setAttribute("aria-label", isHidden ? "Ocultar contraseña" : "Mostrar contraseña");
});

// ──────────────────────────────────────────────────────────
// REDIRECCIÓN SI YA ESTÁ LOGUEADO
// ──────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    if (user) window.location.href = "admin.html";
});

// ──────────────────────────────────────────────────────────
// LÓGICA DE LOGIN
// ──────────────────────────────────────────────────────────
const loginForm = document.getElementById("loginForm");
const btnLogin  = document.getElementById("btnLogin");

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const email    = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        showError("Por favor completá todos los campos.");
        return;
    }

    const originalBtnHTML = btnLogin.innerHTML;
    btnLogin.disabled = true;
    btnLogin.textContent = "Ingresando...";

    try {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged redirige automáticamente
    } catch (error) {
        console.error("Error en login:", error);
        btnLogin.disabled = false;
        btnLogin.innerHTML = originalBtnHTML;

        if (
            error.code === "auth/invalid-credential" ||
            error.code === "auth/wrong-password" ||
            error.code === "auth/user-not-found"
        ) {
            showError("Correo o contraseña incorrectos.");
        } else if (error.code === "auth/too-many-requests") {
            showError("Demasiados intentos. Esperá unos minutos.");
        } else {
            showError("Ocurrió un error al intentar ingresar.");
        }
    }
});
