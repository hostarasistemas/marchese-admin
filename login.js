import { app } from "./firebase-config.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const auth = getAuth(app);

// ──────────────────────────────────────────────────────────
// SISTEMA DE TOASTS
// ──────────────────────────────────────────────────────────
const toastContainer = document.getElementById("toastContainer");
function toast(msg, type = "error") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ──────────────────────────────────────────────────────────
// REDIRECCIÓN SI YA ESTÁ LOGUEADO
// ──────────────────────────────────────────────────────────
// Si el usuario ya tiene la sesión activa, lo mandamos directo al admin
onAuthStateChanged(auth, (user) => {
    if (user) {
        window.location.href = "admin.html";
    }
});

// ──────────────────────────────────────────────────────────
// LÓGICA DE LOGIN
// ──────────────────────────────────────────────────────────
const loginForm = document.getElementById("loginForm");
const btnLogin = document.getElementById("btnLogin");

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
        toast("Por favor completá todos los campos", "error");
        return;
    }

    // Estado de carga en el botón
    const originalBtnText = btnLogin.innerHTML;
    btnLogin.disabled = true;
    btnLogin.textContent = "Ingresando...";

    try {
        await signInWithEmailAndPassword(auth, email, password);
        // El onAuthStateChanged arriba se encargará de redirigir a admin.html
    } catch (error) {
        console.error("Error en login:", error);
        btnLogin.disabled = false;
        btnLogin.innerHTML = originalBtnText;

        // Manejo de errores comunes de Firebase en español
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
            toast("Correo o contraseña incorrectos", "error");
        } else if (error.code === 'auth/too-many-requests') {
            toast("Demasiados intentos. Esperá un momento.", "error");
        } else {
            toast("Ocurrió un error al intentar ingresar", "error");
        }
    }
});