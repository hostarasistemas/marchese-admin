// ──────────────────────────────────────────────────────────
// Configuración de Firebase - Marchese Golosinas
// ──────────────────────────────────────────────────────────
// Usamos los SDK modulares de Firebase vía CDN (no requieren npm/bundler).
// Si en el futuro migran a un proyecto con build (Vite/Webpack), pueden
// reemplazar estas dos líneas de import por:
//   import { initializeApp } from "firebase/app";
//   import { getFirestore } from "firebase/firestore";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAjp7fII7DMkZ0NQr5ikHb1ssM-vbGT_vg",
  authDomain: "marchese-742a3.firebaseapp.com",
  projectId: "marchese-742a3",
  storageBucket: "marchese-742a3.firebasestorage.app",
  messagingSenderId: "203279355042",
  appId: "1:203279355042:web:aa85de36e4dbb3c5fa9bfb"
};

// Inicializar Firebase
export const app = initializeApp(firebaseConfig);

// Instancia de Firestore, usada en toda la web
export const db = getFirestore(app);