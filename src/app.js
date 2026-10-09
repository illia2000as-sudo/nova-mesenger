
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  set,
  get
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";

// 1. Вставь сюда конфигурацию из Firebase Console
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAxNsanO0zYvp_XsmX0GzxEPXHvbW8qYiE",
  authDomain: "nova-729f3.firebaseapp.com",
  databaseURL: "https://nova-729f3-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "nova-729f3",
  storageBucket: "nova-729f3.firebasestorage.app",
  messagingSenderId: "506210477687",
  appId: "1:506210477687:web:4153028a41b7f047214872",
  measurementId: "G-FGNGYRQ86X"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);

const chatsTab = document.getElementById("chatsTab");
const friendsTab = document.getElementById("friendsTab");
const pageTitle = document.getElementById("pageTitle");
const content = document.getElementById("content");

let currentUser = null;

function showMessage(message, error = false) {
  const element = document.getElementById("authMessage");
  if (!element) return;

  element.textContent = message;
  element.style.color = error ? "#ff8295" : "#8ce8b8";
}

function showAuth() {
  document.querySelector(".sidebar").style.display = "none";

  pageTitle.textContent = "Вход в NOVA";
  document.querySelector("header").style.display = "none";

  content.style.height = "100vh";
  content.innerHTML = `
    <div class="auth-card">
      <div class="welcome-icon">✦</div>
      <h2 id="authTitle">Добро пожаловать в NOVA</h2>
      <p class="auth-subtitle">Твой личный мессенджер</p>

      <form id="authForm">
        <div id="nameField" hidden>
          <label for="displayName">Имя пользователя</label>
          <input id="displayName" maxlength="40"
            autocomplete="nickname" placeholder="Как тебя называть?">
        </div>

        <label for="email">Электронная почта</label>
        <input id="email" type="email"
          autocomplete="email" required placeholder="you@example.com">

        <label for="password">Пароль</label>
        <input id="password" type="password"
          autocomplete="current-password" minlength="6"
          required placeholder="Минимум 6 символов">

        <button class="auth-submit" type="submit" id="submitAuth">
          Войти
        </button>
      </form>

      <p id="authMessage" role="status"></p>

      <button class="auth-switch" id="switchAuth" type="button">
        Нет аккаунта? Зарегистрироваться
      </button>
    </div>
  `;

  let isRegister = false;

  const form = document.getElementById("authForm");
  const nameField = document.getElementById("nameField");
  const nameInput = document.getElementById("displayName");
  const passwordInput = document.getElementById("password");
  const title = document.getElementById("authTitle");
  const submit = document.getElementById("submitAuth");
  const switchButton = document.getElementById("switchAuth");

  switchButton.addEventListener("click", () => {
    isRegister = !isRegister;
    nameField.hidden = !isRegister;
    nameInput.required = isRegister;

    title.textContent = isRegister
      ? "Создать аккаунт"
      : "Добро пожаловать в NOVA";

    submit.textContent = isRegister ? "Зарегистрироваться" : "Войти";

    switchButton.textContent = isRegister
      ? "Уже есть аккаунт? Войти"
      : "Нет аккаунта? Зарегистрироваться";

    passwordInput.autocomplete = isRegister
      ? "new-password"
      : "current-password";

    showMessage("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    showMessage("Подключаемся...");

    const email = document.getElementById("email").value.trim();
    const password = passwordInput.value;
    const displayName = nameInput.value.trim();

    try {
      if (isRegister) {
        if (!displayName) {
          throw new Error("Введи имя пользователя.");
        }

        const credential = await createUserWithEmailAndPassword(
          auth, email, password
        );

        await updateProfile(credential.user, { displayName });

        await set(ref(database, `users/${credential.user.uid}`), {
          uid: credential.user.uid,
          displayName,
          email,
          createdAt: Date.now()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      const messages = {
        "auth/email-already-in-use": "Этот email уже зарегистрирован.",
        "auth/invalid-email": "Проверь адрес электронной почты.",
        "auth/invalid-credential": "Неверный email или пароль.",
        "auth/weak-password": "Пароль слишком простой.",
        "auth/network-request-failed": "Проверь подключение к интернету.",
        "PERMISSION_DENIED": "Проверь правила доступа к базе Firebase."
      };

      showMessage(
        messages[error.code] ||
        messages[error.message] ||
        "Ошибка: " + error.message,
        true
      );
    } finally {
      submit.disabled = false;
    }
  });
}

function showApp(user) {
  document.querySelector(".sidebar").style.display = "flex";
  document.querySelector("header").style.display = "flex";
  content.style.height = "calc(100vh - 82px)";

  document.getElementById("username").textContent =
    user.displayName || user.email;

  document.getElementById("status").textContent = user.email;

  content.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">✦</div>
      <h2>Привет, ${escapeHtml(user.displayName || "друг")}!</h2>
      <p>Ты вошёл в NOVA Messenger.</p>
      <p>Твой аккаунт подключён к Firebase.</p>
      <button class="auth-submit" id="logoutButton">Выйти из аккаунта</button>
    </div>
  `;

  document.getElementById("logoutButton").addEventListener("click", async () => {
    await signOut(auth);
  });

  showPage("chats");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showPage(page) {
  const isFriends = page === "friends";

  chatsTab.classList.toggle("active", !isFriends);
  friendsTab.classList.toggle("active", isFriends);
  pageTitle.textContent = isFriends ? "Друзья" : "Сообщения";

  content.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">${isFriends ? "👥" : "✦"}</div>
      <h2>${isFriends ? "Твои друзья" : "Твои сообщения"}</h2>
      <p>${
        isFriends
          ? "Здесь появится поиск пользователей и добавление друзей."
          : "Регистрация работает! Следующим шагом подключим личные чаты."
      }</p>
    </div>
  `;
}

chatsTab.addEventListener("click", () => showPage("chats"));
friendsTab.addEventListener("click", () => showPage("friends"));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    showAuth();
    return;
  }

  try {
    const profileRef = ref(database, `users/${user.uid}`);
    const snapshot = await get(profileRef);

    if (!snapshot.exists()) {
      await set(profileRef, {
        uid: user.uid,
        displayName: user.displayName || "",
        email: user.email || "",
        createdAt: Date.now()
      });
    }

    showApp(user);
  } catch (error) {
    showAuth();
    showMessage(
      "Не удалось загрузить профиль. Проверь настройки базы данных.",
      true
    );
    console.error(error);
  }
});
