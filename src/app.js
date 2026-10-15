import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInAnonymously, EmailAuthProvider, linkWithCredential, sendEmailVerification, sendPasswordResetEmail, onAuthStateChanged, signOut, updateProfile, deleteUser } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getDatabase, ref, set, get, onValue, push, update, remove, runTransaction } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";
import { createCallSystem } from "./calls.js";

const firebaseConfig = {
  apiKey: "AIzaSyAxNsanO0zYvp_XsmX0GzxEPXHvbW8qYiE",
  authDomain: "nova-729f3.firebaseapp.com",
  databaseURL: "https://nova-729f3-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "nova-729f3",
  storageBucket: "nova-729f3.firebasestorage.app",
  messagingSenderId: "506210477687",
  appId: "1:506210477687:web:4153028a41b7f047214872"
};
const firebaseApp = initializeApp(firebaseConfig);
// Explicit persistent auth for Android WebView/Capacitor and desktop browsers.
// Prefer IndexedDB, fall back to localStorage, then in-memory only if the device blocks both.
const auth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence]
});
const db = getDatabase(firebaseApp);
const storage = getStorage(firebaseApp);
const $ = (s) => document.querySelector(s);
let currentUser = null, currentProfile = null, currentPage = "chats", activeChatId = null, activeChatUser = null;
let stopUserChats = null, stopMessages = null, stopReadReceipt = null, stopRequests = null, stopCoins = null, stopOwnProfile = null;
let callSystem = null;
let stopChatSoundWatchers = {};
let creatingGuestSession = false;
let cachedChats = {}, cachedFriends = {}, cachedRequests = {};

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function initial(v) { return esc((String(v || "?").trim().split(/\s+/)[0][0] || "?").toUpperCase()); }
function avatarMarkup(profile, extraClass = "") {
  const cls = "avatar " + extraClass;
  if (profile && profile.avatarUrl) {
    if (profile.avatarType === "video") return '<div class="'+cls+' avatar-media"><video src="'+esc(profile.avatarUrl)+'" autoplay muted loop playsinline></video></div>';
    return '<div class="'+cls+' avatar-media"><img src="'+esc(profile.avatarUrl)+'" alt="Аватар"></div>';
  }
  return '<div class="'+cls+'">'+initial(profile && (profile.displayName || profile.username))+'</div>';
}
function mediaDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), media = document.createElement("video");
    media.preload = "metadata";
    media.onloadedmetadata = () => { const duration = media.duration; URL.revokeObjectURL(url); resolve(duration); };
    media.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось прочитать видео. Выбери MP4 или WebM.")); };
    media.src = url;
  });
}
function safeFileName(name) {
  return String(name || "file").normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
}
async function uploadMedia(file, path) {
  const target = storageRef(storage, path + "/" + Date.now() + "_" + safeFileName(file.name));
  const result = await uploadBytes(target, file, {contentType:file.type || "application/octet-stream"});
  return {url:await getDownloadURL(result.ref), path:result.ref.fullPath};
}
function renderMediaMessage(message) {
  const mine = message.senderUid === currentUser.uid;
  const media = message.mediaType === "video"
    ? '<video class="chat-media-video" src="'+esc(message.url)+'" controls preload="metadata"></video>'
    : '<a href="'+esc(message.url)+'" target="_blank" rel="noreferrer"><img class="chat-media-image" src="'+esc(message.url)+'" alt="'+esc(message.fileName || "Фото")+'"></a>';
  return '<div class="message-row '+(mine?"mine":"")+'"><div class="message-bubble media-message">'+media+(message.fileName?'<div class="media-caption">'+esc(message.fileName)+'</div>':'')+'<small>'+timeLabel(message.createdAt||Date.now())+(mine?" · Вы":"")+'</small></div></div>';
}
function uname(v) { return String(v || "").trim().replace(/^@/, "").toLowerCase(); }
function errorText(e) {
  const map = {"auth/email-already-in-use":"Этот email уже зарегистрирован.","auth/invalid-email":"Проверь адрес электронной почты.","auth/invalid-credential":"Неверная почта или пароль.","auth/weak-password":"Пароль должен содержать минимум 6 символов.","auth/network-request-failed":"Нет соединения с интернетом. Проверь мобильную сеть/Wi-Fi и попробуй ещё раз.","auth/too-many-requests":"Слишком много попыток. Попробуй позже.","auth/operation-not-allowed":"Этот способ входа выключен в Firebase Console → Authentication → Sign-in method. Включи Email/Password для регистрации или Anonymous для гостевого входа.","auth/unauthorized-domain":"Firebase не разрешает домен приложения. Проверь Firebase Console → Authentication → Settings → Authorized domains; для Capacitor добавь localhost, если его нет.","auth/web-storage-unsupported":"На устройстве недоступно хранилище входа. Обнови Android System WebView/Chrome и повтори попытку.","storage/unauthorized":"Firebase Storage запретил загрузку. Проверь, опубликованы ли правила из docs/firebase-storage-rules.txt в Firebase Console → Storage → Rules.","storage/bucket-not-found":"Firebase Storage не настроен: проверь хранилище в Firebase Console и значение storageBucket в конфигурации.","storage/project-not-found":"Firebase не нашёл проект Storage. Проверь конфигурацию проекта.","storage/quota-exceeded":"В хранилище Firebase закончилась доступная квота.","storage/retry-limit-exceeded":"Загрузка не удалась из-за сети. Проверь интернет и повтори попытку.","storage/canceled":"Загрузка отменена.","PERMISSION_DENIED":"Firebase отклонил действие. Проверь, опубликованы ли актуальные правила из docs/firebase-database-rules.json в Realtime Database → Rules.","permission_denied":"Firebase отклонил действие. Проверь, опубликованы ли актуальные правила из docs/firebase-database-rules.json в Realtime Database → Rules."};
  return map[e && e.code] || (e && e.message) || "Неизвестная ошибка.";
}
function toast(message, error) {
  let n = $("#toast");
  if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "toast"; document.body.appendChild(n); }
  n.textContent = message; n.className = "toast show" + (error ? " error" : "");
  clearTimeout(n._timer); n._timer = setTimeout(() => n.classList.remove("show"), 3500);
}
let notificationAudioContext = null;
function playIncomingMessageSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!notificationAudioContext || notificationAudioContext.state === "closed") {
      notificationAudioContext = new AudioContextClass();
    }
    const ctx = notificationAudioContext;
    const play = () => {
      if (ctx.state === "closed") return;
      const now = ctx.currentTime;
      [880, 660].forEach((frequency, index) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, now + index * 0.11);
        gain.gain.setValueAtTime(0.0001, now + index * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.075, now + index * 0.11 + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.11 + 0.16);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now + index * 0.11);
        oscillator.stop(now + index * 0.11 + 0.18);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(play).catch(() => {});
    else play();
  } catch (error) { console.warn("NOVA notification sound:", error); }
}
function stopListeners() {
  if (stopUserChats) stopUserChats();
  if (stopMessages) stopMessages();
  if (stopReadReceipt) stopReadReceipt();
  if (stopRequests) stopRequests();
  if (stopCoins) stopCoins();
  if (stopOwnProfile) stopOwnProfile();
  stopUserChats = stopMessages = stopReadReceipt = stopRequests = stopCoins = stopOwnProfile = null;
  Object.values(stopChatSoundWatchers).forEach(stop => { try { stop(); } catch (_) {} });
  stopChatSoundWatchers = {};
}
async function startGuestSession() {
  creatingGuestSession = true;
  let user = null, claimedUsername = null;
  try {
    const credential = await signInAnonymously(auth); user = credential.user;
    for (let n = 1; n <= 100000; n++) {
      const candidate = "nova" + n;
      const claim = await runTransaction(ref(db, "usernameIndex/" + candidate), value => value === null ? user.uid : undefined);
      if (claim.committed) { claimedUsername = candidate; break; }
    }
    if (!claimedUsername) throw new Error("Не удалось подобрать свободный гостевой ник. Попробуй ещё раз.");
    await updateProfile(user, {displayName: claimedUsername});
    await set(ref(db, "users/" + user.uid), {uid:user.uid, username:claimedUsername, usernameLower:claimedUsername, displayName:claimedUsername, bio:"Я в NOVA как гость.", coins:0, guest:true, createdAt:Date.now()});
    creatingGuestSession = false; toast("Добро пожаловать! Твой гостевой ник — @" + claimedUsername); await bootUser(user);
  } catch (error) {
    if (user && claimedUsername) { try { await remove(ref(db, "usernameIndex/" + claimedUsername)); } catch (_) {} }
    creatingGuestSession = false; try { if (auth.currentUser) await signOut(auth); } catch (_) {}
    const msg = error && error.code === "auth/operation-not-allowed" ? "Гостевой вход ещё не включён. В Firebase Console открой Authentication → Sign-in method → Anonymous и включи его." : errorText(error);
    const message = $("#authMessage"); if (message) { message.textContent = msg; message.className = "error-text"; } else toast(msg, true);
  }
}
function openGuestRegistration() {
  if (!currentUser?.isAnonymous) return;
  document.querySelector("#guestRegisterLayer")?.remove(); const layer = document.createElement("div");
  layer.id = "guestRegisterLayer"; layer.className = "gift-picker-layer";
  layer.innerHTML = '<section class="gift-picker-card guest-register-card"><button class="gift-picker-close" id="guestRegisterClose" type="button" aria-label="Закрыть">×</button><span class="eyebrow">СОХРАНИ СВОЙ ПРОФИЛЬ</span><h3>Создать аккаунт NOVA</h3><p>Привяжи почту и пароль к гостевому профилю <strong>@'+esc(currentProfile?.username||"nova")+'</strong>. Твои чаты и ник останутся с тобой.</p><form id="guestRegisterForm"><label for="guestEmailInput">Электронная почта</label><input id="guestEmailInput" type="email" required autocomplete="email" placeholder="you@example.com"><label for="guestPasswordInput">Пароль</label><input id="guestPasswordInput" type="password" required minlength="6" autocomplete="new-password" placeholder="Минимум 6 символов"><p id="guestRegisterMessage" role="status"></p><button class="primary-button full-button" id="guestRegisterSubmit" type="submit">Создать аккаунт <span>→</span></button></form></section>';
  document.body.appendChild(layer); const close=()=>layer.remove(); $("#guestRegisterClose").addEventListener("click",close);
  layer.addEventListener("click",e=>{if(e.target===layer)close();});
  $("#guestRegisterForm").addEventListener("submit",async e=>{
    e.preventDefault(); const button=$("#guestRegisterSubmit"), message=$("#guestRegisterMessage"); button.disabled=true; message.textContent="Сохраняем аккаунт…"; message.className="";
    try {
      const email=$("#guestEmailInput").value.trim(), password=$("#guestPasswordInput").value;
      const linked=await linkWithCredential(currentUser,EmailAuthProvider.credential(email,password)); currentUser=linked.user;
      try { await sendEmailVerification(currentUser); } catch(mailError) { console.warn("NOVA verification email:",mailError); }
      await update(ref(db,"users/"+currentUser.uid),{guest:false,registeredAt:Date.now()});
      currentProfile.guest=false; close(); toast("Аккаунт создан! Твой ник и переписки сохранены. Проверь почту для подтверждения.");
      shell(); updateSidebar(); listenData(); showPage("chats");
    } catch(error) { message.textContent=errorText(error); message.className="error-text"; }
    finally { button.disabled=false; }
  });
}
function showAuth() {
  stopListeners();
  document.body.innerHTML = '<main class="auth-screen"><div class="auth-glow"></div><section class="auth-card"><div class="brand auth-brand"><div class="brand-mark">✦</div><div><h1>NOVA</h1><small>MESSENGER</small></div></div><div class="auth-heading"><span class="eyebrow">ТВОЯ СВЯЗЬ. ТВОИ ЛЮДИ.</span><h2 id="authTitle">С возвращением</h2><p id="authSub">Войди, чтобы продолжить общение.</p></div><form id="authForm"><div id="usernameWrap" hidden><label for="usernameInput">Имя пользователя</label><input id="usernameInput" maxlength="24" autocomplete="username" placeholder="например, nova_player"><small class="field-hint">3–24 символа: латиница, цифры и _</small></div><label for="emailInput">Электронная почта</label><input id="emailInput" type="email" autocomplete="email" required placeholder="you@example.com"><label for="passwordInput">Пароль</label><input id="passwordInput" type="password" minlength="6" autocomplete="current-password" required placeholder="Минимум 6 символов"><p id="authMessage" role="status"></p><button class="primary-button full-button" id="authSubmit" type="submit">Войти в NOVA <span>→</span></button></form><button class="guest-mode-button" id="guestModeBtn" type="button"><span>◉</span><span><strong>Продолжить как гость</strong><small>Чаты и звонки без регистрации</small></span><span class="guest-arrow">→</span></button><button class="auth-switch" id="authSwitch" type="button">Нет аккаунта? <strong>Создать</strong></button><button class="auth-switch" id="forgotPasswordBtn" type="button">Забыли пароль?</button><p class="auth-foot">Сообщения синхронизируются через Firebase.</p></section></main>';
  let registering = false;
  $("#guestModeBtn").addEventListener("click", async () => { const b=$("#guestModeBtn"); b.disabled=true; $("#authMessage").textContent="Создаём гостевой профиль…"; $("#authMessage").className=""; await startGuestSession(); if(b.isConnected)b.disabled=false; });
  $("#forgotPasswordBtn").addEventListener("click", async () => {
    const email = $("#emailInput").value.trim();
    if (!email) {
      $("#authMessage").textContent = "Сначала введи email — на него отправим ссылку для сброса пароля.";
      $("#authMessage").className = "error-text";
      $("#emailInput").focus();
      return;
    }
    const resetButton = $("#forgotPasswordBtn");
    resetButton.disabled = true;
    $("#authMessage").textContent = "Отправляем письмо для восстановления…";
    $("#authMessage").className = "";
    try {
      await sendPasswordResetEmail(auth, email);
      $("#authMessage").textContent = "Если аккаунт с таким email существует, письмо для сброса пароля отправлено. Проверь «Спам» тоже.";
      $("#authMessage").className = "";
    } catch (error) {
      $("#authMessage").textContent = errorText(error);
      $("#authMessage").className = "error-text";
    } finally {
      resetButton.disabled = false;
    }
  });
  $("#authSwitch").addEventListener("click", () => {
    registering = !registering;
    $("#usernameWrap").hidden = !registering;
    $("#usernameInput").required = registering;
    $("#authTitle").textContent = registering ? "Создай аккаунт" : "С возвращением";
    $("#authSub").textContent = registering ? "Выбери уникальный ник и присоединяйся." : "Войди, чтобы продолжить общение.";
    $("#authSubmit").innerHTML = registering ? "Создать аккаунт <span>→</span>" : "Войти в NOVA <span>→</span>";
    $("#authSwitch").innerHTML = registering ? "Уже есть аккаунт? <strong>Войти</strong>" : "Нет аккаунта? <strong>Создать</strong>";
    $("#passwordInput").autocomplete = registering ? "new-password" : "current-password";
    $("#authMessage").textContent = "";
  });
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("#authSubmit"); button.disabled = true;
    $("#authMessage").textContent = "Подключаемся…"; $("#authMessage").className = "";
    const email = $("#emailInput").value.trim(), password = $("#passwordInput").value;
    const username = uname($("#usernameInput") ? $("#usernameInput").value : "");
    try {
      if (registering) {
        if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Ник: 3–24 символа, только латиница, цифры и _.");
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        try {
          const claim = await runTransaction(ref(db, "usernameIndex/" + username), value => value === null ? credential.user.uid : undefined);
          if (!claim.committed) throw new Error("Этот ник уже занят. Выбери другой.");
          await updateProfile(credential.user, {displayName: username});
          await set(ref(db, "users/" + credential.user.uid), {uid:credential.user.uid, username, usernameLower:username, displayName:username, bio:"Привет! Я в NOVA.", coins:50, createdAt:Date.now()});
          // Firebase sends the verification email; customize its sender and wording in Authentication → Templates.
          try {
            await sendEmailVerification(credential.user);
          } catch (mailError) {
            console.warn("NOVA verification email could not be sent:", mailError);
          }
        } catch (profileError) {
          try { await deleteUser(credential.user); } catch (_) {}
          throw profileError;
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      $("#authMessage").textContent = errorText(error);
      $("#authMessage").className = "error-text";
    } finally { button.disabled = false; }
  });
}
function shell() {
  document.body.innerHTML = '<aside class="sidebar"><div class="brand"><div class="brand-mark">✦</div><div><h1>NOVA</h1><small>MESSENGER</small></div></div><button class="nav active" data-page="chats"><span>▤</span> Сообщения <b id="chatBadge" class="badge" hidden>0</b></button><button class="nav" data-page="friends"><span>♧</span> Друзья</button><button class="nav" data-page="requests"><span>♡</span> Заявки <b id="requestBadge" class="badge" hidden>0</b></button><button class="nav premium-nav" data-page="premium"><span>✧</span> NOVA Premium <em>SOON</em></button><button class="nav" data-page="profile"><span>⚙</span> Мой профиль</button><div class="sidebar-bottom"><div class="profile-mini"><div class="avatar" id="sideAvatar">N</div><div class="profile-text"><strong id="sideName">Загрузка…</strong><small id="sideHandle">@nova</small></div><button class="icon-button" id="logoutBtn" title="Выйти">↪</button></div><div class="connection"><i></i> Подключено к NOVA</div></div></aside><main class="main-shell"><header class="topbar"><div><div class="eyebrow">ТВОЁ ПРОСТРАНСТВО</div><h2 id="pageTitle">Сообщения</h2></div><div class="topbar-right"><span class="currency-pill">✦ <strong id="currencyBalance">50</strong> NOVA</span><button id="topGuestRegisterBtn" class="guest-register-topbar" type="button">Создать аккаунт</button><span class="online-dot"></span><span>В сети</span></div></header><section id="content" class="content"></section></main><nav class="mobile-bottom-nav" aria-label="Основная навигация"><button class="mobile-nav-item active" data-page="chats" type="button"><span>▤</span><small>Чаты</small><b id="mobileChatBadge" class="badge" hidden>0</b></button><button class="mobile-nav-item" data-page="friends" type="button"><span>♧</span><small>Друзья</small></button><button class="mobile-nav-item" data-page="requests" type="button"><span>♡</span><small>Заявки</small></button><button class="mobile-nav-item" data-page="profile" type="button"><span>⚙</span><small>Профиль</small></button><button class="mobile-nav-item guest-mobile-register" id="mobileGuestRegisterBtn" type="button"><span>✦</span><small>Аккаунт</small></button></nav><div id="toast" class="toast"></div>';
  document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
  $("#topGuestRegisterBtn")?.addEventListener("click", openGuestRegistration); $("#mobileGuestRegisterBtn")?.addEventListener("click", openGuestRegistration);
  if (currentUser?.isAnonymous) { document.querySelectorAll('[data-page="premium"],[data-page="profile"]').forEach(b=>b.remove()); } else { $("#topGuestRegisterBtn")?.remove(); $("#mobileGuestRegisterBtn")?.remove(); }
  document.body.classList.remove("mobile-chat-open");
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (currentPage !== "chats") showPage("chats");
      setTimeout(() => { const input = $("#chatFilter"); if (input) { input.focus(); input.select(); } }, 30);
    }
  });
  $("#logoutBtn").addEventListener("click", async () => { try { await signOut(auth); } catch(e) { toast(errorText(e), true); } });
}
function accountBadges(profile) {
  const username = String(profile?.username || "").toLowerCase();
  return (username === "nova_infinity" ? '<span class="nova-badge developer-badge">✦ DEVELOPER</span>' : '') + (profile?.premium ? '<span class="nova-badge premium-badge">✧ PREMIUM</span>' : '') + (profile?.sponsor ? '<span class="nova-badge sponsor-badge">♡ SPONSOR</span>' : '');
}
function openPublicProfile(uid) {
  const layer=document.createElement("div");layer.className="public-profile-layer";layer.id="publicProfileLayer";
  layer.innerHTML='<section class="public-profile-card"><button class="public-profile-close" type="button">×</button><div class="loading-note">Загружаем профиль…</div></section>';
  document.querySelector("#publicProfileLayer")?.remove();document.body.appendChild(layer);
  const close=()=>layer.remove();layer.querySelector(".public-profile-close").addEventListener("click",close);layer.addEventListener("click",e=>{if(e.target===layer)close();});
  (async()=>{try{
    const [ps,gs]=await Promise.all([get(ref(db,"users/"+uid)),get(ref(db,"profileGifts/"+uid))]);if(!layer.isConnected)return;
    if(!ps.exists()){layer.querySelector(".public-profile-card").innerHTML='<button class="public-profile-close" type="button">×</button><p>Профиль не найден.</p>';layer.querySelector(".public-profile-close").addEventListener("click",close);return;}
    const p=ps.val(),gifts=Object.values(gs.val()||{}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,24);
    const tiles=gifts.length?gifts.map(g=>'<article class="profile-gift-tile"><span>'+esc(g.emoji||"🎁")+'</span><strong>'+esc(g.name||"Подарок")+'</strong><small>'+esc(g.senderName||"Пользователь NOVA")+'</small></article>').join(""):'<p class="profile-gifts-empty">Пока нет подарков. Будь первым, кто порадует этого пользователя 🎁</p>';
    layer.querySelector(".public-profile-card").innerHTML='<button class="public-profile-close" type="button" aria-label="Закрыть">×</button><div class="public-profile-hero">'+avatarMarkup(p,"public-profile-avatar")+'<div class="public-profile-name"><h3>'+esc(p.displayName||p.username||"Пользователь")+'</h3><p>@'+esc(p.username||"user")+'</p><div class="public-profile-badges">'+accountBadges(p)+'</div></div></div><div class="public-profile-bio"><span class="eyebrow">ОБО МНЕ</span><p>'+esc(p.bio||"Пользователь пока ничего не рассказал о себе.")+'</p></div><div class="public-profile-gifts"><div class="section-title"><h3>🎁 Подарки профиля</h3><span>'+gifts.length+'</span></div><div class="profile-gifts-grid">'+tiles+'</div></div><div class="public-profile-foot">Профиль NOVA · '+(String(p.username||"").toLowerCase()==="nova_infinity"?"Создатель проекта":"Участник сообщества")+'</div>';
    layer.querySelector(".public-profile-close").addEventListener("click",close);
  }catch(error){if(layer.isConnected)layer.querySelector(".public-profile-card").innerHTML='<button class="public-profile-close" type="button">×</button><p class="error-text">Не удалось загрузить профиль: '+esc(errorText(error))+'</p>';layer.querySelector(".public-profile-close")?.addEventListener("click",close);}})();
}
function updateSidebar() {
  $("#sideName").innerHTML = esc(currentProfile.displayName || currentProfile.username || "Пользователь") + accountBadges(currentProfile);
  $("#sideHandle").textContent = "@" + (currentProfile.username || "user");
  const sideAvatar = $("#sideAvatar");
  if (sideAvatar) { const markup = avatarMarkup(currentProfile); sideAvatar.outerHTML = markup.replace('<div class="avatar ', '<div id="sideAvatar" class="avatar ').replace('<div class="avatar">', '<div id="sideAvatar" class="avatar">'); }
}
function listenData() {
  stopListeners();
  stopOwnProfile = onValue(ref(db, "users/" + currentUser.uid), snap => {
    if (!snap.exists()) return;
    const previousPremium = !!currentProfile?.premium;
    currentProfile = {...currentProfile, ...snap.val()};
    updateSidebar();
    if (!previousPremium && currentProfile.premium) toast(currentProfile.premiumGiftedBy ? "Тебе подарили NOVA Premium! ✦" : "NOVA Premium активирован! ✦");
    if (currentPage === "premium") renderPremiumPage();
  }, e => console.warn("NOVA profile sync:", e));
  stopUserChats = onValue(ref(db, "userChats/" + currentUser.uid), snap => {
    cachedChats = snap.val() || {};
    const chatIds = new Set(Object.keys(cachedChats));
    for (const [chatId, stop] of Object.entries(stopChatSoundWatchers)) {
      if (!chatIds.has(chatId)) { try { stop(); } catch (_) {} delete stopChatSoundWatchers[chatId]; }
    }
    for (const chatId of chatIds) {
      if (stopChatSoundWatchers[chatId]) continue;
      let firstSnapshot = true;
      let knownMessageIds = new Set();
      stopChatSoundWatchers[chatId] = onValue(ref(db, "messages/" + chatId), messageSnap => {
        const entries = Object.entries(messageSnap.val() || {});
        if (firstSnapshot) {
          knownMessageIds = new Set(entries.map(([messageId]) => messageId));
          firstSnapshot = false;
          return;
        }
        let receivedNewMessage = false;
        for (const [messageId, message] of entries) {
          if (!knownMessageIds.has(messageId) && message.senderUid !== currentUser.uid) receivedNewMessage = true;
        }
        knownMessageIds = new Set(entries.map(([messageId]) => messageId));
        if (receivedNewMessage) playIncomingMessageSound();
      }, error => console.warn("NOVA message sound watcher:", error));
    }
    const unreadCount = Object.entries(cachedChats).filter(([id, chat]) => id !== activeChatId && Number(chat.lastMessageAt || 0) > Number(chat.lastReadAt || 0) && chat.lastMessageAt).length;
    const badge = $("#chatBadge"), mobileBadge = $("#mobileChatBadge");
    if (badge) { badge.hidden = unreadCount === 0; badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount); badge.title = unreadCount + " непрочитанных чатов"; }
    if (mobileBadge) { mobileBadge.hidden = unreadCount === 0; mobileBadge.textContent = unreadCount > 9 ? "9+" : String(unreadCount); }
    if (currentPage === "chats") { if (activeChatId) renderChatListOnly(); else renderChatsPage(); }
  }, e => toast(errorText(e), true));
  stopCoins = onValue(ref(db, "users/" + currentUser.uid + "/coins"), snap => { currentProfile.coins = Number(snap.val() ?? 50); updateCurrencyDisplay(); }, e => toast(errorText(e), true));
  stopRequests = onValue(ref(db, "friendRequests/" + currentUser.uid), snap => {
    cachedRequests = snap.val() || {};
    const badge = $("#requestBadge");
    if (badge) { const count = Object.keys(cachedRequests).length; badge.hidden = !count; badge.textContent = count > 9 ? "9+" : count; }
    if (currentPage === "requests") renderRequestsPage();
  }, e => toast(errorText(e), true));
}
function showPage(page) {
  document.body.classList.remove("mobile-chat-open");
  currentPage = page; activeChatId = null; activeChatUser = null;
  if (stopMessages) { stopMessages(); stopMessages = null; }
  document.querySelectorAll("[data-page]").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  const titles = {chats:"Сообщения",friends:"Друзья",requests:"Заявки в друзья",profile:"Мой профиль",premium:"NOVA Premium"};
  $("#pageTitle").textContent = titles[page] || "NOVA";
  if (page === "chats") renderChatsPage();
  else if (page === "friends") renderFriendsPage();
  else if (page === "requests") renderRequestsPage();
  else if (page === "profile") renderProfilePage();
  else renderPremiumPage();
}
function timeLabel(t) { try { return new Date(t).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); } catch (_) { return ""; } }
function renderChatsPage() {
  $("#content").innerHTML = '<div class="chat-layout"><aside class="chat-list-panel"><div class="panel-heading"><div><h3>Твои диалоги</h3><p>Личные чаты и группы</p></div><div class="chat-panel-actions"><button class="icon-button accent-icon" id="newGroupBtn" title="Создать группу">▦</button><button class="icon-button accent-icon" id="newChatBtn" title="Найти друзей">＋</button></div></div><div class="chat-search"><span>⌕</span><input id="chatFilter" placeholder="Поиск диалога…"></div><div id="chatList" class="chat-list"></div></aside><div id="chatStage" class="chat-stage"><div class="empty-state"><div class="empty-orbit">✦</div><h3>Твоя связь начинается здесь</h3><p>Выбери диалог слева или найди друзей, чтобы начать общаться.</p><button class="primary-button" id="findPeopleBtn">Найти людей <span>→</span></button></div></div></div>';
  $("#newChatBtn").addEventListener("click", () => showPage("friends"));
  if (currentUser?.isAnonymous) $("#newGroupBtn")?.remove(); else $("#newGroupBtn")?.addEventListener("click", openCreateGroup);
  $("#findPeopleBtn").addEventListener("click", () => showPage("friends"));
  $("#chatFilter").addEventListener("input", renderChatListOnly);
  renderChatListOnly();
}
function renderChatListOnly() {
  const list = $("#chatList"); if (!list) return;
  const filter = ($("#chatFilter") ? $("#chatFilter").value : "").toLowerCase();
  const entries = Object.entries(cachedChats).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0)).filter(x => (x[1].username || x[1].displayName || "").toLowerCase().includes(filter));
  if (!entries.length) { list.innerHTML = '<div class="list-empty"><div>✧</div><strong>Пока тихо</strong><p>Найди друга и отправь первое сообщение.</p></div>'; return; }
  list.innerHTML = entries.map(([id,c]) => {
    const unread = id !== activeChatId && Number(c.lastMessageAt || 0) > Number(c.lastReadAt || 0) && !!c.lastMessageAt;
    const preview = c.lastMessage || "Начните общение";
    return '<button class="chat-item '+(activeChatId===id?"selected":"")+(unread?" chat-item-unread":"")+'" data-chat-id="'+esc(id)+'">'+avatarMarkup(c)+'<div class="chat-item-copy"><strong>'+esc(c.groupName||c.displayName||c.username||"Пользователь")+'</strong><small>'+esc(preview)+'</small></div><div class="chat-item-meta"><small class="chat-time">'+(c.lastMessageAt?timeLabel(c.lastMessageAt):"")+'</small>'+(unread?'<span class="unread-pill" aria-label="Непрочитанные сообщения">NEW</span>':'')+'</div></button>';
  }).join("");
  list.querySelectorAll("[data-chat-id]").forEach(b => b.addEventListener("click", () => openChat(b.dataset.chatId, cachedChats[b.dataset.chatId])));
}
async function openChat(chatId, info) {
  activeChatId = chatId; activeChatUser = info || {}; document.body.classList.add("mobile-chat-open"); renderChatListOnly();
  if (stopReadReceipt) { stopReadReceipt(); stopReadReceipt = null; }
  const stage = $("#chatStage"); if (!stage) return;
  const isGroup = activeChatUser.isGroup === true;
  let peerReadAt = 0;
  let latestChatMessages = [];
  let replyToMessage = null;
  let lastMarkedReadAt = 0;
  const markChatRead = async (readAt) => {
    if (!currentUser || !chatId || document.hidden) return;
    const stamp = Number(readAt || Date.now());
    if (stamp <= lastMarkedReadAt) return;
    lastMarkedReadAt = stamp;
    const updates = {};
    updates["userChats/" + currentUser.uid + "/" + chatId + "/lastReadAt"] = stamp;
    updates["chats/" + chatId + "/readAt/" + currentUser.uid] = stamp;
    try { await update(ref(db), updates); } catch (error) { console.warn("NOVA read receipt:", error); }
  };
  const chatTitle = activeChatUser.groupName || activeChatUser.displayName || activeChatUser.username || "Диалог";
  const chatSubtitle = isGroup ? ("Группа · " + Number(activeChatUser.memberCount || (activeChatUser.memberUids || []).length || 0) + " участников") : ("@" + (activeChatUser.username || "user"));
  stage.innerHTML = '<div class="conversation-head"><button id="mobileChatBack" class="mobile-chat-back" type="button" title="Назад к диалогам" aria-label="Назад к диалогам">←</button>'+avatarMarkup(activeChatUser)+'<div class="conversation-title"><strong>'+esc(chatTitle)+'</strong><small>'+esc(chatSubtitle)+'</small></div><button id="desktopNotificationsToggle" class="icon-button conversation-notification-toggle" type="button" title="Включить уведомления" aria-label="Включить уведомления">🔔</button><button id="messageSearchToggle" class="icon-button conversation-search-toggle" type="button" title="Найти сообщение" aria-label="Найти сообщение">⌕</button>'+(isGroup?'<button id="groupManageBtn" class="group-manage-button" type="button" title="Управление группой">⚙ <span>Группа</span></button>':'<button id="giftOpenBtn" class="gift-open-button" type="button" title="Отправить подарок">🎁 <span>Подарок</span></button><button id="audioCallBtn" class="call-start-button" type="button" title="Начать аудиозвонок">☎ <span>Звонок</span></button><button id="videoCallBtn" class="call-start-button video-call-start-button" type="button" title="Начать видеозвонок">📹 <span>Видео</span></button>')+'<span class="conversation-status"><i></i> NOVA</span></div><div id="messageSearchBar" class="message-search-bar" hidden><span>⌕</span><input id="messageSearchInput" type="search" placeholder="Найти в переписке…" autocomplete="off"><span id="messageSearchCount" class="message-search-count"></span><button id="messageSearchClose" type="button" title="Закрыть поиск">×</button></div><div id="messageList" class="message-list"><div class="loading-note">Загружаем сообщения…</div></div><div id="replyPreview" class="reply-preview" hidden><div class="reply-preview-copy"><strong>Ответ на сообщение</strong><span id="replyPreviewText"></span></div><button id="replyCancelBtn" type="button" aria-label="Отменить ответ" title="Отменить ответ">×</button></div><button id="jumpToLatest" class="jump-to-latest" type="button" title="К последним сообщениям" aria-label="К последним сообщениям">↓<span>Новые сообщения</span></button><form id="messageForm" class="message-composer"><label class="media-attach-button" title="Отправить фото или видео">＋<input id="mediaInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden></label><button id="cameraCaptureBtn" class="media-attach-button camera-capture-button" type="button" title="Сделать фото с камеры" aria-label="Сделать фото с камеры">📷</button><textarea id="messageInput" maxlength="4000" rows="1" autocomplete="off" placeholder="Напиши сообщение…" aria-label="Текст сообщения"></textarea><button class="send-button" type="submit" aria-label="Отправить">➤</button></form>';
  if (currentUser?.isAnonymous) { $("#giftOpenBtn")?.remove(); $("#mediaInput")?.parentElement?.remove(); $("#cameraCaptureBtn")?.remove(); }
  const chatLayout = $(".chat-layout");
  if (chatLayout) chatLayout.classList.add("has-open-chat");
  const mobileBack = $("#mobileChatBack");
  if (mobileBack) mobileBack.addEventListener("click", () => { activeChatId = null; activeChatUser = null; document.body.classList.remove("mobile-chat-open"); if (stopReadReceipt) { stopReadReceipt(); stopReadReceipt = null; } renderChatsPage(); });
  markChatRead(Date.now());
  stopReadReceipt = onValue(ref(db, "chats/" + chatId + "/readAt"), snap => {
    const readAt = snap.val() || {};
    const members = activeChatUser.memberUids || [];
    const peerUids = isGroup ? members.filter(uid => uid !== currentUser.uid) : (activeChatUser.withUid ? [activeChatUser.withUid] : []);
    peerReadAt = peerUids.length ? Math.max(...peerUids.map(uid => Number(readAt[uid] || 0))) : 0;
    const list = $("#messageList");
    if (list) list.querySelectorAll("[data-message-created]").forEach(node => {
      const stamp = Number(node.dataset.messageCreated || 0);
      const state = node.querySelector(".message-read-state");
      if (state) { const read = peerReadAt >= stamp && stamp > 0; state.textContent = read ? "✓✓ Прочитано" : "✓ Отправлено"; state.classList.toggle("is-read", read); }
    });
  }, error => console.warn("NOVA receipt sync:", error));
  let conversationSearchQuery = "";
  let firstMessageLoad = true;
  let previousMessageIds = new Set();
  const draftKey = "nova-draft-" + currentUser.uid + "-" + chatId;
  const composerDraft = $("#messageInput");
  try { if (composerDraft) composerDraft.value = localStorage.getItem(draftKey) || ""; } catch (_) {}
  const saveComposerDraft = () => { try { if (composerDraft) localStorage.setItem(draftKey, composerDraft.value); } catch (_) {} };
  if (composerDraft) composerDraft.addEventListener("input", saveComposerDraft);
  const notificationButton = $("#desktopNotificationsToggle");
  const notificationsEnabled = () => { try { return localStorage.getItem("nova-desktop-notifications") === "on"; } catch (_) { return false; } };
  const updateNotificationButton = () => { if (!notificationButton) return; const enabled = notificationsEnabled(); notificationButton.classList.toggle("notifications-enabled", enabled); notificationButton.title = enabled ? "Выключить уведомления" : "Включить уведомления"; notificationButton.setAttribute("aria-label", notificationButton.title); };
  updateNotificationButton();
  if (notificationButton) notificationButton.addEventListener("click", async () => {
    if (notificationsEnabled()) { try { localStorage.setItem("nova-desktop-notifications", "off"); } catch (_) {} updateNotificationButton(); toast("Уведомления выключены."); return; }
    if (!("Notification" in window)) return toast("Этот браузер не поддерживает системные уведомления.", true);
    try { const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission(); if (permission !== "granted") return toast("Разреши уведомления в настройках браузера.", true); localStorage.setItem("nova-desktop-notifications", "on"); updateNotificationButton(); toast("Уведомления включены для открытого чата."); } catch (_) { toast("Не удалось включить уведомления.", true); }
  });
  const searchBar = $("#messageSearchBar"), searchInput = $("#messageSearchInput"), searchCount = $("#messageSearchCount");
  const applyConversationSearch = () => {
    const box = $("#messageList"); if (!box) return;
    const rows = [...box.querySelectorAll(".message-row")];
    let matches = 0;
    rows.forEach(row => {
      const found = !conversationSearchQuery || row.textContent.toLocaleLowerCase().includes(conversationSearchQuery);
      row.classList.toggle("search-match", !!conversationSearchQuery && found);
      row.classList.toggle("search-dimmed", !!conversationSearchQuery && !found);
      if (found) matches++;
    });
    if (searchCount) searchCount.textContent = conversationSearchQuery ? (matches + " найдено") : "";
    if (conversationSearchQuery && matches) {
      const first = rows.find(row => row.classList.contains("search-match"));
      if (first) first.scrollIntoView({block:"center",behavior:"smooth"});
    }
  };
  const searchToggle = $("#messageSearchToggle");
  if (searchToggle) searchToggle.addEventListener("click", () => {
    if (!searchBar) return;
    searchBar.hidden = !searchBar.hidden;
    if (!searchBar.hidden) { searchInput.focus(); searchInput.select(); }
    else { conversationSearchQuery = ""; searchInput.value = ""; applyConversationSearch(); }
  });
  if (searchInput) searchInput.addEventListener("input", () => { conversationSearchQuery = searchInput.value.trim().toLocaleLowerCase(); applyConversationSearch(); });
  const searchClose = $("#messageSearchClose");
  const closeConversationSearch = () => { if (searchBar) searchBar.hidden = true; conversationSearchQuery = ""; if (searchInput) searchInput.value = ""; applyConversationSearch(); };
  if (searchClose) searchClose.addEventListener("click", closeConversationSearch);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && searchBar && !searchBar.hidden) closeConversationSearch(); });
  const replyPreview = $("#replyPreview");
  const clearReply = () => { replyToMessage = null; if (replyPreview) replyPreview.hidden = true; };
  $("#replyCancelBtn")?.addEventListener("click", clearReply);
  const messageBoxForReply = $("#messageList");
  if (messageBoxForReply) messageBoxForReply.addEventListener("click", event => {
    const button = event.target.closest("[data-reply-message]");
    if (!button) return;
    const found = latestChatMessages.find(([id]) => id === button.dataset.replyMessage);
    if (!found) return;
    const [messageId, message] = found;
    replyToMessage = {messageId, senderUid:message.senderUid || "", senderName:message.senderName || (message.senderUid === currentUser.uid ? (currentProfile.displayName || currentProfile.username || "Ты") : (activeChatUser?.displayName || activeChatUser?.groupName || activeChatUser?.username || "Участник")), text:String(message.text || (message.type === "media" ? "Фото или видео" : message.type === "gift" ? "Подарок 🎁" : "Сообщение")).slice(0,180)};
    const previewText = $("#replyPreviewText");
    if (previewText) previewText.textContent = replyToMessage.senderName + ": " + replyToMessage.text;
    if (replyPreview) replyPreview.hidden = false;
    $("#messageInput")?.focus();
  });
  const jumpButton = $("#jumpToLatest"), messageBox = $("#messageList");
  if (jumpButton && messageBox) {
    let previousScrollTop = messageBox.scrollTop;
    jumpButton.addEventListener("click", () => messageBox.scrollTo({top:messageBox.scrollHeight,behavior:"smooth"}));
    messageBox.addEventListener("scroll", () => {
      const away = messageBox.scrollHeight - messageBox.scrollTop - messageBox.clientHeight > 180;
      jumpButton.classList.toggle("visible", away);
      if (!away) jumpButton.classList.remove("has-new");
      const head = stage.querySelector(".conversation-head");
      const delta = messageBox.scrollTop - previousScrollTop;
      if (head && messageBox.scrollTop > 90 && delta > 3) head.classList.add("conversation-head-hidden");
      else if (head && (delta < -3 || messageBox.scrollTop < 40)) head.classList.remove("conversation-head-hidden");
      previousScrollTop = messageBox.scrollTop;
    }, {passive:true});
  }
  const giftButton = $("#giftOpenBtn"); if (giftButton) giftButton.addEventListener("click", openGiftPicker);
  const groupManageButton = $("#groupManageBtn"); if (groupManageButton) groupManageButton.addEventListener("click", () => openManageGroup(chatId, activeChatUser));
  $("#mediaInput").addEventListener("change", async e => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (file) await sendMedia(file); });
  const cameraCaptureButton = $("#cameraCaptureBtn");
  if (cameraCaptureButton) cameraCaptureButton.addEventListener("click", openCameraCapture);
  const callButton = $("#audioCallBtn");
  if (callButton) callButton.addEventListener("click", () => {
    if (!callSystem) return toast("Система звонков ещё запускается.", true);
    callSystem.startAudioCall({...activeChatUser, chatId});
  });
  const videoCallButton = $("#videoCallBtn");
  if (videoCallButton) videoCallButton.addEventListener("click", () => {
    if (!callSystem) return toast("Система звонков ещё запускается.", true);
    callSystem.startVideoCall({...activeChatUser, chatId});
  });
  if (stopMessages) stopMessages();
  stopMessages = onValue(ref(db, "messages/" + chatId), snap => {
    const messages = Object.entries(snap.val() || {}).sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0));
    latestChatMessages = messages;
    if (firstMessageLoad) { previousMessageIds = new Set(messages.map(x => x[0])); }
    else {
      for (const [messageId, message] of messages) {
        if (previousMessageIds.has(messageId) || message.senderUid === currentUser.uid) continue;
        if (!notificationsEnabled() || !document.hidden || !("Notification" in window) || Notification.permission !== "granted") continue;
        const sender = message.senderName || activeChatUser?.displayName || activeChatUser?.groupName || "Новое сообщение";
        const body = message.type === "gift" ? "Тебе отправили подарок 🎁" : message.type === "media" ? "Отправлено фото или видео" : String(message.text || "Новое сообщение").slice(0, 120);
        try { const notice = new Notification("NOVA · " + sender, {body, tag:"nova-" + chatId}); notice.onclick = () => { window.focus(); notice.close(); }; } catch (_) {}
      }
      previousMessageIds = new Set(messages.map(x => x[0]));
    }
    const box = $("#messageList"); if (!box) return;
    const latestIncoming = messages.reduce((max, entry) => entry[1].senderUid !== currentUser.uid ? Math.max(max, Number(entry[1].createdAt || 0)) : max, 0);
    if (!document.hidden) markChatRead(latestIncoming || Date.now());
    const oldTop = box.scrollTop;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    box.innerHTML = messages.length ? messages.map(x => {
      const message = x[1], mine = message.senderUid === currentUser.uid, stamp = Number(message.createdAt || Date.now());
      if (message.type === "gift") return renderGiftMessage(message);
      if (message.type === "media") return renderMediaMessage(message);
      const read = mine && peerReadAt >= stamp;
      const replyMarkup = message.replyTo ? '<div class="message-reply-quote"><strong>'+esc(message.replyTo.senderName || "Участник")+'</strong><span>'+esc(message.replyTo.text || "Сообщение")+'</span></div>' : "";
      return '<div class="message-row '+(mine?"mine":"")+'"><div class="message-bubble">'+replyMarkup+'<div>'+esc(message.text || "").replace(/\n/g,"<br>")+'</div><small data-message-created="'+(mine?stamp:"")+'">'+timeLabel(stamp)+(mine?' · Вы <span class="message-read-state '+(read?"is-read":"")+'">'+(read?"✓✓ Прочитано":"✓ Отправлено")+'</span>':'')+'</small><button class="message-reply-button" type="button" data-reply-message="'+esc(x[0])+'" title="Ответить">↩ Ответить</button></div></div>';
    }).join("") : '<div class="empty-messages"><span>✦</span><p>Это начало вашей истории. Напиши первым!</p></div>';
    if (firstMessageLoad || nearBottom) box.scrollTop = box.scrollHeight;
    else { box.scrollTop = oldTop; if (jumpButton) jumpButton.classList.add("visible","has-new"); }
    firstMessageLoad = false;
    applyConversationSearch();
  }, e => toast(errorText(e), true));
  $("#messageForm").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#messageInput"), text = input.value.trim(); if (!text || !activeChatId) return;
    $(".send-button").disabled = true;
    try {
      const now = Date.now(), id = activeChatId, message = push(ref(db, "messages/" + id));
      await set(message, {senderUid:currentUser.uid,text,createdAt:now,...(replyToMessage ? {replyTo:replyToMessage} : {})});
      const chat = cachedChats[id] || activeChatUser || {}, updates = {};
      updates["chats/"+id+"/lastMessage"] = text.slice(0,120);
      updates["chats/"+id+"/updatedAt"] = now;
      updates["userChats/"+currentUser.uid+"/"+id+"/lastMessage"] = text.slice(0,120);
      updates["userChats/"+currentUser.uid+"/"+id+"/lastMessageAt"] = now;
      updates["userChats/"+currentUser.uid+"/"+id+"/lastReadAt"] = now;
      updates["chats/"+id+"/readAt/"+currentUser.uid] = now;
      const recipients = chat.isGroup && Array.isArray(chat.memberUids) ? chat.memberUids : (chat.withUid ? [chat.withUid] : []);
      for (const memberUid of recipients) {
        if (memberUid === currentUser.uid) continue;
        updates["userChats/"+memberUid+"/"+id+"/lastMessage"] = text.slice(0,120);
        updates["userChats/"+memberUid+"/"+id+"/lastMessageAt"] = now;
      }
      await update(ref(db), updates); input.value = ""; input.style.height = ""; clearReply(); try { localStorage.removeItem(draftKey); } catch (_) {} input.focus();
    } catch(e) { toast(errorText(e), true); }
    finally { if ($(".send-button")) $(".send-button").disabled = false; }
  });
  const composerInput = $("#messageInput");
  if (composerInput) {
    const resizeComposer = () => { composerInput.style.height = "auto"; composerInput.style.height = Math.min(composerInput.scrollHeight, 140) + "px"; };
    composerInput.addEventListener("input", resizeComposer);
    composerInput.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        const form = $("#messageForm");
        if (form && composerInput.value.trim() && !$(".send-button")?.disabled) form.requestSubmit();
      }
    });
  }
}
async function openCreateGroup() {
  if (currentUser?.isAnonymous) return toast("Создание групп доступно после регистрации. Ты всё ещё можешь писать и созваниваться с друзьями.", true);
  let createdChatId = null;
  try {
    const snap = await get(ref(db, "friends/" + currentUser.uid));
    const friends = Object.values(snap.val() || {}).filter(f => f && f.uid && f.uid !== currentUser.uid);
    if (!friends.length) return toast("Сначала добавь хотя бы одного друга, чтобы создать группу.", true);
    let layer = $("#groupCreateLayer"); if (layer) layer.remove();
    layer = document.createElement("div"); layer.id = "groupCreateLayer"; layer.className = "gift-picker-layer";
    layer.innerHTML = '<section class="gift-picker-card group-create-card"><button class="gift-picker-close" id="groupCloseBtn" type="button">×</button><span class="eyebrow">NOVA GROUPS</span><h3>Создать группу</h3><p>Придумай название и выбери друзей, которых пригласишь в чат.</p><form id="groupCreateForm"><label class="group-name-label" for="groupNameInput">Название группы</label><input id="groupNameInput" maxlength="40" required placeholder="Например, Своя команда"><div class="group-members-heading">Участники <span>'+friends.length+' друзей</span></div><div class="group-member-list">'+friends.map(f=>'<label class="group-member-option">'+avatarMarkup(f)+'<span><strong>'+esc(f.displayName||f.username||"Пользователь")+'</strong><small>@'+esc(f.username||"user")+'</small></span><input type="checkbox" name="groupMember" value="'+esc(f.uid)+'"></label>').join("")+'</div><button class="primary-button full-button" type="submit">Создать группу <span>→</span></button><p id="groupCreateError" class="group-create-error"></p></form></section>';
    document.body.appendChild(layer);
    $("#groupCloseBtn").addEventListener("click",()=>layer.remove());
    layer.addEventListener("click",e=>{if(e.target===layer)layer.remove();});
    $("#groupCreateForm").addEventListener("submit",async e=>{
      e.preventDefault();
      const button=layer.querySelector('button[type="submit"]'), error=$("#groupCreateError");
      const groupName=$("#groupNameInput").value.trim();
      const selected=[...layer.querySelectorAll('input[name="groupMember"]:checked')].map(x=>x.value);
      if(groupName.length<2){error.textContent="Название должно содержать минимум 2 символа.";return;}
      if(!selected.length){error.textContent="Выбери хотя бы одного друга.";return;}
      button.disabled=true; error.textContent="Создаём группу…";
      try {
        const members={[currentUser.uid]:true}; selected.forEach(uid=>members[uid]=true);
        const memberUids=Object.keys(members), now=Date.now(), chatRef=push(ref(db,"chats")), chatId=chatRef.key;
        await set(chatRef,{isGroup:true,groupName,members,memberCount:memberUids.length,createdBy:currentUser.uid,createdAt:now,updatedAt:now,lastMessage:"Группа создана"});
        createdChatId = chatId;
        const updates={};
        for(const memberUid of memberUids){
          let profile=memberUid===currentUser.uid?currentProfile:friends.find(f=>f.uid===memberUid);
          if(!profile){const p=await get(ref(db,"users/"+memberUid));profile=p.val()||{};}
          updates["userChats/"+memberUid+"/"+chatId]={isGroup:true,groupName,displayName:groupName,username:"group",memberUids,memberCount:memberUids.length,lastMessage:"Группа создана",lastMessageAt:now,updatedAt:now,createdBy:currentUser.uid};
        }
        await update(ref(db),updates);
        createdChatId = null;
        layer.remove(); toast("Группа «"+groupName+"» создана!"); showPage("chats");
        setTimeout(()=>openChat(chatId,{isGroup:true,groupName,displayName:groupName,username:"group",memberUids,memberCount:memberUids.length}),250);
      } catch(err) {
        if (createdChatId) {
          try { await remove(ref(db, "chats/" + createdChatId)); }
          catch (cleanupError) { console.warn("NOVA group rollback failed:", cleanupError); }
        }
        error.textContent=errorText(err);
        button.disabled=false;
      }
    });
  } catch(e) { toast(errorText(e),true); }
}

async function openManageGroup(chatId, info) {
  try {
    const snap = await get(ref(db, "chats/" + chatId));
    const group = snap.val();
    if (!group || group.isGroup !== true) return toast("Эта группа больше недоступна.", true);
    if (!group.members || group.members[currentUser.uid] !== true) return toast("Ты больше не участник этой группы.", true);
    const memberUids = Object.keys(group.members).filter(uid => group.members[uid] === true);
    const friendSnap = await get(ref(db, "friends/" + currentUser.uid));
    const friends = Object.values(friendSnap.val() || {}).filter(f => f && f.uid && f.uid !== currentUser.uid && !memberUids.includes(f.uid));
    let layer = $("#groupManageLayer"); if (layer) layer.remove();
    layer = document.createElement("div"); layer.id = "groupManageLayer"; layer.className = "gift-picker-layer";
    const isCreator = group.createdBy === currentUser.uid;
    layer.innerHTML = '<section class="gift-picker-card group-create-card group-manage-card"><button class="gift-picker-close" id="groupManageClose" type="button">×</button><span class="eyebrow">NOVA GROUPS</span><h3>Управление группой</h3><p>Меняй название, добавляй друзей или выходи из группы.</p><form id="groupRenameForm"><label class="group-name-label" for="groupRenameInput">Название группы</label><input id="groupRenameInput" maxlength="40" required value="'+esc(group.groupName || info.groupName || "Новая группа")+'"><button class="primary-button full-button" type="submit">Сохранить название</button></form><div class="group-members-heading">Участники <span>'+memberUids.length+'</span></div><div class="group-current-members">'+memberUids.map(uid => {
      const known = uid === currentUser.uid ? currentProfile : null;
      const isMe = uid === currentUser.uid;
      return '<div class="group-current-member"><span class="group-member-dot">'+(isMe?"Я":"✦")+'</span><span><strong>'+(isMe?esc(currentProfile.displayName||currentProfile.username||"Ты"):"Участник группы")+'</strong><small>'+(group.createdBy===uid?"Создатель группы":(isMe?"Ты в этой группе":"Участник"))+'</small></span></div>';
    }).join("")+'</div><form id="groupAddMembersForm"><div class="group-members-heading">Добавить друзей <span>'+friends.length+' доступны</span></div>'+(friends.length?'<div class="group-member-list">'+friends.map(f=>'<label class="group-member-option">'+avatarMarkup(f)+'<span><strong>'+esc(f.displayName||f.username||"Пользователь")+'</strong><small>@'+esc(f.username||"user")+'</small></span><input type="checkbox" name="newGroupMember" value="'+esc(f.uid)+'"></label>').join("")+'</div>':'<p class="group-empty-note">Все твои друзья уже в группе.</p>')+(friends.length?'<button class="primary-button full-button" type="submit">Добавить выбранных</button>':'')+'<p id="groupManageError" class="group-create-error"></p></form><button id="groupLeaveBtn" class="group-leave-button" type="button">Выйти из группы</button></section>';
    document.body.appendChild(layer);
    $("#groupManageClose").addEventListener("click",()=>layer.remove());
    layer.addEventListener("click",e=>{if(e.target===layer)layer.remove();});
    $("#groupRenameForm").addEventListener("submit",async e=>{
      e.preventDefault();
      const name=$("#groupRenameInput").value.trim(), error=$("#groupManageError");
      if(name.length<2){error.textContent="Название должно содержать минимум 2 символа.";return;}
      const button=layer.querySelector('#groupRenameForm button[type="submit"]');button.disabled=true;error.textContent="Сохраняем…";
      try {
        const updates={}, now=Date.now(), uids=Object.keys(group.members||{}).filter(uid=>group.members[uid]===true);
        updates["chats/"+chatId+"/groupName"]=name;
        updates["chats/"+chatId+"/updatedAt"]=now;
        for(const uid of uids){updates["userChats/"+uid+"/"+chatId+"/groupName"]=name;updates["userChats/"+uid+"/"+chatId+"/displayName"]=name;updates["userChats/"+uid+"/"+chatId+"/updatedAt"]=now;}
        await update(ref(db),updates);
        if(activeChatId===chatId){activeChatUser.groupName=name;activeChatUser.displayName=name;const head=$("#chatStage .conversation-head strong");if(head)head.textContent=name;const sub=$("#chatStage .conversation-head small");if(sub)sub.textContent="Группа · "+uids.length+" участников";}
        toast("Название группы изменено.");layer.remove();
      } catch(err){error.textContent=errorText(err);button.disabled=false;}
    });
    const addForm=$("#groupAddMembersForm");
    if(addForm)addForm.addEventListener("submit",async e=>{
      e.preventDefault();
      const selected=[...layer.querySelectorAll('input[name="newGroupMember"]:checked')].map(x=>x.value);
      const error=$("#groupManageError"), button=addForm.querySelector('button[type="submit"]');
      if(!selected.length){error.textContent="Выбери хотя бы одного друга.";return;}
      button.disabled=true;error.textContent="Добавляем участников…";
      try {
        const fresh=await get(ref(db,"chats/"+chatId)), current=fresh.val();
        if(!current||!current.members||current.members[currentUser.uid]!==true)throw new Error("Ты больше не участник этой группы.");
        const members={...(current.members||{})}, now=Date.now();
        for(const uid of selected)members[uid]=true;
        const uids=Object.keys(members).filter(uid=>members[uid]===true), updates={};
        updates["chats/"+chatId+"/members"]=members;
        updates["chats/"+chatId+"/memberCount"]=uids.length;
        updates["chats/"+chatId+"/memberUids"]=uids;
        updates["chats/"+chatId+"/updatedAt"]=now;
        for(const uid of uids){
          updates["userChats/"+uid+"/"+chatId+"/isGroup"]=true;
          updates["userChats/"+uid+"/"+chatId+"/groupName"]=current.groupName||"Новая группа";
          updates["userChats/"+uid+"/"+chatId+"/displayName"]=current.groupName||"Новая группа";
          updates["userChats/"+uid+"/"+chatId+"/memberUids"]=uids;
          updates["userChats/"+uid+"/"+chatId+"/memberCount"]=uids.length;
          updates["userChats/"+uid+"/"+chatId+"/updatedAt"]=now;
          if(!current.members||current.members[uid]!==true){
            updates["userChats/"+uid+"/"+chatId+"/lastMessage"]="Тебя добавили в группу";
            updates["userChats/"+uid+"/"+chatId+"/lastMessageAt"]=now;
          }
        }
        await update(ref(db),updates);
        toast("Участники добавлены в группу.");layer.remove();
        if(activeChatId===chatId)openChat(chatId,{...activeChatUser,memberUids:uids,memberCount:uids.length});
      }catch(err){error.textContent=errorText(err);button.disabled=false;}
    });
    $("#groupLeaveBtn").addEventListener("click",async()=>{
      if(!confirm("Точно выйти из группы «"+(group.groupName||"Новая группа")+"»?"))return;
      const button=$("#groupLeaveBtn");button.disabled=true;button.textContent="Выходим…";
      try {
        const fresh=await get(ref(db,"chats/"+chatId)), current=fresh.val();
        if(!current||!current.members||current.members[currentUser.uid]!==true)throw new Error("Ты уже не участник этой группы.");
        const remaining=Object.keys(current.members).filter(uid=>uid!==currentUser.uid&&current.members[uid]===true), updates={};
        updates["userChats/"+currentUser.uid+"/"+chatId]=null;
        if(!remaining.length)updates["chats/"+chatId]=null;
        else {
          updates["chats/"+chatId+"/members/"+currentUser.uid]=null;
          updates["chats/"+chatId+"/memberCount"]=remaining.length;
          updates["chats/"+chatId+"/memberUids"]=remaining;
          updates["chats/"+chatId+"/updatedAt"]=Date.now();
          for(const uid of remaining){
            updates["userChats/"+uid+"/"+chatId+"/memberUids"]=remaining;
            updates["userChats/"+uid+"/"+chatId+"/memberCount"]=remaining.length;
          }
        }
        await update(ref(db),updates);
        layer.remove();if(stopMessages){stopMessages();stopMessages=null;}activeChatId=null;activeChatUser=null;showPage("chats");
        toast("Ты вышел из группы.");
      }catch(err){toast(errorText(err),true);button.disabled=false;button.textContent="Выйти из группы";}
    });
  } catch(e) { toast(errorText(e), true); }
}

function renderFriendsPage() {
  $("#content").innerHTML = '<div class="page-wrap"><div class="page-intro"><div><span class="eyebrow">ТВОЁ СООБЩЕСТВО</span><h3>Найди своих людей</h3><p>Ищи по уникальному нику и отправляй заявку в друзья.</p></div></div><div class="search-people"><span>⌕</span><input id="peopleSearch" placeholder="Введи ник пользователя, например nova_player"><button id="searchPeopleBtn" class="primary-button">Найти</button></div><div id="peopleResults" class="people-grid"><div class="helper-card"><span>✦</span><p>Введи ник, чтобы найти пользователей NOVA.</p></div></div><div class="section-title"><h3>Твои друзья</h3><span>'+Object.keys(cachedFriends).length+'</span></div><div id="friendsGrid" class="people-grid"></div></div>';
  $("#searchPeopleBtn").addEventListener("click", searchPeople);
  $("#peopleSearch").addEventListener("keydown", e => { if (e.key==="Enter") searchPeople(); });
  loadFriends();
}
async function searchPeople() {
  const result = $("#peopleResults"); if (!result) return;
  const q = uname($("#peopleSearch").value);
  if (q.length < 2) { result.innerHTML = '<div class="helper-card"><span>⌕</span><p>Введи хотя бы 2 символа ника.</p></div>'; return; }
  result.innerHTML = '<div class="helper-card"><span>…</span><p>Ищем пользователей…</p></div>';
  try {
    const snap = await get(ref(db,"users")), users = snap.val() || {};
    const matches = Object.values(users).filter(u => u.uid!==currentUser.uid && (u.usernameLower||u.username||"").includes(q)).slice(0,20);
    if (!matches.length) { result.innerHTML = '<div class="helper-card"><span>⌕</span><p>Никого не нашли. Проверь написание.</p></div>'; return; }
    result.innerHTML = matches.map(u => {const isFriend=!!cachedFriends[u.uid],pending=!!cachedRequests[u.uid];return '<article class="person-card">'+avatarMarkup(u)+'<div class="person-copy"><strong>'+esc(u.displayName||u.username)+'</strong><div class="person-badges">'+accountBadges(u)+'</div><small>@'+esc(u.username)+'</small><p>'+esc(u.bio||"Пользователь NOVA")+'</p></div><div class="person-actions"><button class="small-button" data-view-profile="'+esc(u.uid)+'">Профиль</button><button class="small-button" data-add-uid="'+esc(u.uid)+'" '+(isFriend||pending?"disabled":"")+'>'+(isFriend?"Уже друг":pending?"Заявка отправлена":"＋ Добавить")+'</button></div></article>';}).join("");
    result.querySelectorAll("[data-view-profile]").forEach(b=>b.addEventListener("click",()=>openPublicProfile(b.dataset.viewProfile)));
    result.querySelectorAll("[data-add-uid]").forEach(b=>b.addEventListener("click",()=>sendFriendRequest(b.dataset.addUid,b)));
  } catch(e) { result.innerHTML = '<div class="helper-card error-text"><p>'+esc(errorText(e))+'</p></div>'; }
}
async function sendFriendRequest(uid, button) {
  try {
    if (uid===currentUser.uid) return;
    await set(ref(db,"friendRequests/"+uid+"/"+currentUser.uid), {uid:currentUser.uid,username:currentProfile.username,displayName:currentProfile.displayName,createdAt:Date.now()});
    button.disabled = true; button.textContent = "Заявка отправлена"; toast("Заявка в друзья отправлена.");
  } catch(e) { toast(errorText(e),true); }
}
async function loadFriends() {
  try {
    const snap = await get(ref(db,"friends/"+currentUser.uid)); cachedFriends = snap.val() || {};
    const grid = $("#friendsGrid"); if (!grid) return;
    const friends = Object.values(cachedFriends);
    grid.innerHTML = friends.length ? friends.map(f=>'<article class="person-card">'+avatarMarkup(f)+'<div class="person-copy"><strong>'+esc(f.displayName||f.username)+'</strong><div class="person-badges">'+accountBadges(f)+'</div><small>@'+esc(f.username)+'</small><p>Уже в твоём списке друзей</p></div><div class="person-actions"><button class="small-button" data-view-profile="'+esc(f.uid)+'">Профиль</button><button class="small-button" data-chat-friend="'+esc(f.uid)+'">Написать ↗</button></div></article>').join("") : '<div class="helper-card"><span>♧</span><p>Пока нет друзей. Найди пользователя выше и отправь заявку.</p></div>';
    grid.querySelectorAll("[data-view-profile]").forEach(b=>b.addEventListener("click",()=>openPublicProfile(b.dataset.viewProfile)));
    grid.querySelectorAll("[data-chat-friend]").forEach(b=>b.addEventListener("click",()=>startChat(b.dataset.chatFriend)));
  } catch(e) { toast(errorText(e),true); }
}
function renderRequestsPage() {
  const entries = Object.entries(cachedRequests);
  $("#content").innerHTML = '<div class="page-wrap"><div class="page-intro"><div><span class="eyebrow">НОВЫЕ ЗНАКОМСТВА</span><h3>Заявки в друзья</h3><p>Принимай заявки, чтобы начать общаться.</p></div></div><div class="people-grid">'+(entries.length?entries.map(([uid,r])=>'<article class="person-card">'+avatarMarkup(r)+'<div class="person-copy"><strong>'+esc(r.displayName||r.username)+'</strong><small>@'+esc(r.username)+'</small><p>Хочет добавить тебя в друзья</p></div><button class="small-button accept-button" data-accept="'+esc(uid)+'">Принять</button><button class="small-button muted-button" data-reject="'+esc(uid)+'">✕</button></article>').join(""):'<div class="helper-card"><span>♡</span><p>Новых заявок пока нет.</p></div>')+'</div></div>';
  $("#content").querySelectorAll("[data-accept]").forEach(b => b.addEventListener("click",()=>acceptRequest(b.dataset.accept)));
  $("#content").querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click",async()=>{try{await remove(ref(db,"friendRequests/"+currentUser.uid+"/"+b.dataset.reject));toast("Заявка отклонена.");}catch(e){toast(errorText(e),true);}}));
}
async function acceptRequest(friendUid) {
  try {
    const snap = await get(ref(db,"friendRequests/"+currentUser.uid+"/"+friendUid));
    if (!snap.exists()) return toast("Заявка уже удалена.",true);
    const incoming = snap.val(), now = Date.now(), updates = {};
    updates["friends/"+currentUser.uid+"/"+friendUid] = {uid:friendUid,username:incoming.username,displayName:incoming.displayName,avatarUrl:incoming.avatarUrl||null,avatarType:incoming.avatarType||null,since:now};
    updates["friends/"+friendUid+"/"+currentUser.uid] = {uid:currentUser.uid,username:currentProfile.username,displayName:currentProfile.displayName,avatarUrl:currentProfile.avatarUrl||null,avatarType:currentProfile.avatarType||null,since:now};
    updates["friendRequests/"+currentUser.uid+"/"+friendUid] = null;
    await update(ref(db),updates);
    await startChat(friendUid,incoming); toast("Вы теперь друзья!");
  } catch(e) { toast(errorText(e),true); }
}
async function startChat(friendUid, known) {
  try {
    let friend = known;
    if (!friend) { const s = await get(ref(db,"users/"+friendUid)); friend = s.val(); }
    if (!friend) throw new Error("Профиль пользователя не найден.");
    const ids = [currentUser.uid,friendUid].sort(), id = ids[0]+"_"+ids[1], now = Date.now();
    const chatSnap = await get(ref(db,"chats/"+id));
    if (!chatSnap.exists()) await set(ref(db,"chats/"+id),{members:{[currentUser.uid]:true,[friendUid]:true},createdAt:now,updatedAt:now,lastMessage:""});
    const mine = {withUid:friendUid,username:friend.username,displayName:friend.displayName||friend.username,avatarUrl:friend.avatarUrl||null,avatarType:friend.avatarType||null,lastMessage:"",updatedAt:now};
    const theirs = {withUid:currentUser.uid,username:currentProfile.username,displayName:currentProfile.displayName||currentProfile.username,avatarUrl:currentProfile.avatarUrl||null,avatarType:currentProfile.avatarType||null,lastMessage:"",updatedAt:now};
    const updates = {};
    updates["userChats/"+currentUser.uid+"/"+id] = mine;
    updates["userChats/"+friendUid+"/"+id] = theirs;
    await update(ref(db),updates);
    showPage("chats"); setTimeout(()=>openChat(id,cachedChats[id]||mine),150);
  } catch(e) { toast(errorText(e),true); }
}

const NOVA_GIFTS=[{id:"rose",name:"Роза",emoji:"🌹",price:5,desc:"Маленький знак внимания",motion:"rose"},{id:"heart",name:"Сердце",emoji:"💝",price:10,desc:"Для особенного человека",motion:"heart"},{id:"coffee",name:"Кофе",emoji:"☕",price:15,desc:"Чтобы день стал лучше",motion:"coffee"},{id:"teddy",name:"Мишка",emoji:"🧸",price:20,desc:"Мягкий и уютный подарок",motion:"teddy"},{id:"cake",name:"Торт",emoji:"🎂",price:25,desc:"Для праздника",motion:"cake"},{id:"bouquet",name:"Букет",emoji:"💐",price:35,desc:"Красивый большой букет",motion:"bouquet"},{id:"rocket",name:"Ракета",emoji:"🚀",price:50,desc:"На максимальной скорости",motion:"rocket"},{id:"star",name:"Звезда NOVA",emoji:"🌟",price:30,desc:"Пусть твой день сияет",motion:"star"},{id:"gem",name:"Кристалл",emoji:"💎",price:45,desc:"Редкий блестящий подарок",motion:"gem"},{id:"fox",name:"Лисёнок",emoji:"🦊",price:25,desc:"Маленький рыжий друг",motion:"teddy"},{id:"planet",name:"Планета",emoji:"🪐",price:60,desc:"Подарок из другой галактики",motion:"planet"},{id:"fireworks",name:"Фейерверк",emoji:"🎆",price:75,desc:"Праздник в одном подарке",motion:"fireworks"},{id:"crown",name:"Корона",emoji:"👑",price:100,desc:"Королевский знак уважения",motion:"crown"},{id:"portal",name:"Галактика",emoji:"🌌",price:150,desc:"Подарок с другого края вселенной",motion:"portal"},{id:"unicorn",name:"Единорог",emoji:"🦄",price:40,desc:"Немного волшебства в чат",motion:"unicorn"},{id:"cookie",name:"Печенька",emoji:"🍪",price:8,desc:"Сладкий привет другу",motion:"cookie"},{id:"cherry",name:"Вишенки",emoji:"🍒",price:12,desc:"Маленький яркий сюрприз",motion:"cherry"},{id:"lightning",name:"Молния",emoji:"⚡",price:55,desc:"Заряд энергии для друга",motion:"lightning"},{id:"trophy",name:"Кубок",emoji:"🏆",price:90,desc:"За победу и крутые моменты",motion:"trophy"},{id:"dragon",name:"Дракон",emoji:"🐉",price:120,desc:"Редкий подарок легенде",motion:"dragon"},{id:"moon",name:"Лунный кот",emoji:"🐈‍⬛",price:65,desc:"Тайный привет из ночи",motion:"moon"},{id:"diamond_ring",name:"Алмазное кольцо",emoji:"💍",price:180,desc:"Особенный коллекционный подарок",motion:"gem"},{id:"sakura",name:"Сакура",emoji:"🌸",price:22,desc:"Цветущий знак дружбы",motion:"sakura"},{id:"music",name:"Музыка",emoji:"🎧",price:32,desc:"Для любимого плейлиста",motion:"music"},{id:"aurora",name:"Северное сияние",emoji:"🌈",price:110,desc:"Красота далёкого неба",motion:"portal"}];
function updateCurrencyDisplay(){const n=$("#currencyBalance");if(n)n.textContent=String(Math.max(0,Number(currentProfile?.coins??50)));}
function renderGiftMessage(g){const mine=g.senderUid===currentUser.uid, item=NOVA_GIFTS.find(x=>x.id===g.giftId)||{emoji:g.giftEmoji||"🎁",name:g.giftName||"Подарок",price:g.price||0};return '<div class="message-row '+(mine?"mine":"")+'"><div class="gift-message-card gift-reveal gift-motion-'+(item.motion||"star")+'"><div class="gift-message-glow"></div><div class="gift-message-emoji gift-bounce">'+item.emoji+'</div><strong>'+esc(item.name)+'</strong><p>'+(mine?"Ты отправил(а) подарок":"Тебе отправили подарок")+'</p><small>'+timeLabel(g.createdAt||Date.now())+' · ✦ '+item.price+' NOVA</small></div></div>';}
function renderGiftShopPage(){const balance=Math.max(0,Number(currentProfile?.coins??50));$("#content").innerHTML='<div class="page-wrap gift-shop-page"><section class="gift-shop-hero"><div><span class="eyebrow">NOVA GIFT STORE</span><h3>Дарить — приятно ✨</h3><p>Отправляй друзьям подарки прямо в личном чате. Подарок появится красивой карточкой в переписке.</p></div><div class="gift-wallet"><span>ТВОЙ БАЛАНС</span><strong>✦ '+balance+'</strong><small>NOVA-монет</small></div></section><div class="gift-shop-heading"><div><h3>Витрина подарков</h3><p>Чтобы отправить, открой чат с другом.</p></div><span>'+NOVA_GIFTS.length+' подарков</span></div><div class="gift-catalog">'+NOVA_GIFTS.map(g=>'<article class="gift-product"><div class="gift-product-emoji">'+g.emoji+'</div><h4>'+g.name+'</h4><p>'+g.desc+'</p><div class="gift-product-bottom"><strong>✦ '+g.price+'</strong><span class="gift-price-label">Отправить в чате</span></div></article>').join("")+'</div><div class="gift-info-note">🎁 Каждый аккаунт получает стартовые 50 NOVA-монет. Это внутренняя валюта приложения, не реальные деньги.</div></div>';/* Подарок отправляется из личного чата через кнопку 🎁. */}
function openGiftPicker(){if(currentUser?.isAnonymous)return toast("Подарки доступны после регистрации.",true);const gifts=NOVA_GIFTS.map(g=>'<button class="gift-choice" data-gift-choice="'+g.id+'"><span>'+g.emoji+'</span><strong>'+g.name+'</strong><small>✦ '+g.price+'</small></button>').join("");let layer=$("#giftPickerLayer");if(layer)layer.remove();layer=document.createElement("div");layer.id="giftPickerLayer";layer.className="gift-picker-layer";layer.innerHTML='<section class="gift-picker-card"><button class="gift-picker-close" id="giftPickerClose">×</button><span class="eyebrow">NOVA GIFT STORE</span><h3>Выбери подарок</h3><p>Баланс: <strong>✦ '+Number(currentProfile?.coins??50)+' NOVA</strong></p><div class="gift-choice-grid">'+gifts+'</div></section>';document.body.appendChild(layer);$("#giftPickerClose").addEventListener("click",()=>layer.remove());layer.addEventListener("click",e=>{if(e.target===layer)layer.remove();});layer.querySelectorAll("[data-gift-choice]").forEach(b=>b.addEventListener("click",()=>{const g=NOVA_GIFTS.find(x=>x.id===b.dataset.giftChoice);layer.remove();if(g)sendGift(g);}));}
async function sendGift(gift){if(!activeChatId||!activeChatUser?.withUid)return toast("Сначала открой личный чат с другом.",true);if(activeChatUser.withUid===currentUser.uid)return toast("Себе подарки отправлять нельзя.",true);let charged=false;try{const result=await runTransaction(ref(db,"users/"+currentUser.uid+"/coins"),n=>{n=Number(n??50);return n>=gift.price?n-gift.price:undefined;});if(!result.committed)return toast("Не хватает NOVA-монет на этот подарок.",true);charged=true;currentProfile.coins=Number(result.snapshot.val()||0);updateCurrencyDisplay();const now=Date.now(),m=push(ref(db,"messages/"+activeChatId));await set(m,{type:"gift",giftId:gift.id,giftName:gift.name,giftEmoji:gift.emoji,price:gift.price,senderUid:currentUser.uid,recipientUid:activeChatUser.withUid,chatId:activeChatId,createdAt:now});const profileGift=push(ref(db,"profileGifts/"+activeChatUser.withUid));await set(profileGift,{giftId:gift.id,name:gift.name,emoji:gift.emoji,senderUid:currentUser.uid,senderName:currentProfile.displayName||currentProfile.username,recipientUid:activeChatUser.withUid,chatId:activeChatId,createdAt:now});const u={};u["chats/"+activeChatId+"/lastMessage"]="🎁 Подарок: "+gift.name;u["chats/"+activeChatId+"/updatedAt"]=now;u["userChats/"+currentUser.uid+"/"+activeChatId+"/lastMessage"]="🎁 Подарок: "+gift.name;u["userChats/"+currentUser.uid+"/"+activeChatId+"/lastMessageAt"]=now;u["userChats/"+activeChatUser.withUid+"/"+activeChatId+"/lastMessage"]="🎁 Подарок: "+gift.name;u["userChats/"+activeChatUser.withUid+"/"+activeChatId+"/lastMessageAt"]=now;await update(ref(db),u);toast("Подарок «"+gift.name+"» отправлен!");}catch(e){if(charged){try{await runTransaction(ref(db,"users/"+currentUser.uid+"/coins"),n=>Number(n??0)+gift.price);currentProfile.coins=Number(currentProfile.coins||0)+gift.price;updateCurrencyDisplay();}catch(_){}}toast(errorText(e),true);}}

function renderPremiumPage() {
  const isSecretAccount = String(currentProfile?.username || "").toLowerCase() === "nova_infinity";
  const adminPanel = isSecretAccount ? '<section class="premium-admin-panel"><div class="premium-admin-head"><span class="eyebrow">NOVA CREATOR CONSOLE</span><h3>🛡️ Панель создателя</h3><p>Найди пользователя и выдай NOVA Premium, статус SPONSOR или оба статуса. Используй SPONSOR для тех, кто реально поддержал проект.</p></div><form id="premiumGrantSearch" class="premium-grant-search"><input id="premiumGrantQuery" maxlength="40" autocomplete="off" placeholder="@username или имя пользователя"><button type="submit">Найти</button></form><div id="premiumGrantResults" class="premium-grant-results"><p class="premium-admin-empty">Введи имя друга и нажми «Найти».</p></div></section>' : "";
  $("#content").innerHTML = '<div class="page-wrap premium-page"><section class="premium-hero"><div class="premium-orb">✦</div><div class="premium-kicker">NOVA · БОЛЬШЕ ВОЗМОЖНОСТЕЙ</div><h3>Общайся <span>без границ</span></h3><p>Premium задуман для тех, кто хочет поддержать развитие NOVA и получить больше возможностей. Сейчас реальные платежи ещё не подключены.</p><div class="premium-pills"><span>✦ Ранний доступ</span><span>◈ Особые темы</span><span>♡ Поддержка проекта</span></div></section><div class="premium-section-heading"><div><span class="eyebrow">ТВОЙ ТАРИФ</span><h3>Выбери свой NOVA</h3></div><span class="plan-status">Сейчас: '+(currentProfile?.premium ? "NOVA Premium активен" : "Бесплатный")+'</span></div><div class="premium-plans"><article class="plan-card"><div class="plan-top"><div class="plan-icon free-icon">✦</div><span class="plan-label">ДЛЯ ВСЕХ</span></div><h4>NOVA Free</h4><div class="plan-price">$0 <small>/ навсегда</small></div><p class="plan-description">Всё необходимое для общения с друзьями.</p><ul><li>✓ Личные сообщения</li><li>✓ Друзья и заявки</li><li>✓ Настройка профиля</li><li>✓ Синхронизация в реальном времени</li></ul><div class="current-plan">ТВОЙ ТЕКУЩИЙ ТАРИФ</div></article><article class="plan-card premium-plan"><div class="plan-top"><div class="plan-icon premium-icon">✧</div><span class="plan-label">'+(currentProfile?.premium ? "АКТИВЕН" : "В РАЗРАБОТКЕ")+'</span></div><h4>NOVA Premium</h4><div class="plan-price">$0.99 <small>/ месяц · планируемая цена</small></div><p class="plan-description">Больше персонализации и способ поддержать развитие приложения.</p><ul><li>✦ Эксклюзивные темы оформления</li><li>✦ Дополнительные настройки профиля</li><li>✦ Значок Premium</li><li>✦ Ранний доступ к новым функциям</li></ul><button class="premium-disabled-button" disabled>'+(currentProfile?.premium ? "✦ Premium активен" : "Скоро появится")+'</button><p class="payment-note">'+(currentProfile?.premiumGiftedBy ? "Premium подарен секретным аккаунтом NOVA INFINITY. Оплата не нужна." : currentProfile?.premium ? "Твой секретный бонус активен. Оплата не нужна." : "Оплата отключена. Сейчас деньги не списываются.")+'</p></article></div><section class="premium-roadmap"><div class="roadmap-icon">↗</div><div><strong>Сначала — стабильный мессенджер</strong><p>Перед запуском подписки мы проверим чаты, защиту аккаунтов и работу приложения. Цена и функции могут измениться до официального запуска.</p></div></section>'+adminPanel+'</div>';
  if (!isSecretAccount) return;
  const form = $("#premiumGrantSearch");
  const results = $("#premiumGrantResults");
  const queryInput = $("#premiumGrantQuery");
  async function searchPremiumUsers() {
    const term = String(queryInput.value || "").trim().replace(/^@/, "").toLowerCase();
    if (!term) { results.innerHTML = '<p class="premium-admin-empty">Сначала введи имя или @username.</p>'; return; }
    results.innerHTML = '<p class="premium-admin-empty">Ищем пользователей…</p>';
    try {
      const snap = await get(ref(db, "users"));
      const found = Object.entries(snap.val() || {}).filter(([id, user]) => id !== currentUser.uid && (String(user.username || "").toLowerCase().includes(term) || String(user.displayName || "").toLowerCase().includes(term))).slice(0, 15);
      results.innerHTML = found.length ? found.map(([id,user])=>'<div class="premium-user-row"><div><strong>'+esc(user.displayName||user.username||"Пользователь")+'</strong><small>@'+esc(user.username||"user")+(user.premium?' · Premium':' · Free')+(user.sponsor?' · SPONSOR':'')+'</small></div><div class="grant-actions"><button type="button" data-premium-uid="'+esc(id)+'" '+(user.premium?"disabled":"")+'>'+(user.premium?"✓ Premium":"✦ Выдать Premium")+'</button><button type="button" class="sponsor-grant-button" data-sponsor-uid="'+esc(id)+'" '+(user.sponsor?"disabled":"")+'>'+(user.sponsor?"✓ SPONSOR":"♡ Выдать SPONSOR")+'</button></div></div>').join("") : '<p class="premium-admin-empty">Никого не нашли. Проверь написание username.</p>';
    } catch (e) { results.innerHTML = '<p class="premium-admin-empty">Не удалось загрузить пользователей: '+esc(errorText(e))+'</p>'; }
  }
  form.addEventListener("submit", e => { e.preventDefault(); searchPremiumUsers(); });
  results.addEventListener("click",async e=>{
    const sb=e.target.closest("[data-sponsor-uid]"),pb=e.target.closest("[data-premium-uid]"),button=sb||pb;if(!button||button.disabled)return;
    const targetUid=sb?sb.dataset.sponsorUid:pb.dataset.premiumUid;button.disabled=true;button.textContent="Выдаём…";
    try{const updates={};if(sb){updates["users/"+targetUid+"/sponsor"]=true;updates["users/"+targetUid+"/sponsorGrantedBy"]=currentUser.uid;updates["users/"+targetUid+"/sponsorGrantedAt"]=Date.now();}
    else{updates["users/"+targetUid+"/premium"]=true;updates["users/"+targetUid+"/premiumGiftedBy"]=currentUser.uid;updates["users/"+targetUid+"/premiumGiftedAt"]=Date.now();}
    await update(ref(db),updates);toast(sb?"Статус SPONSOR выдан!":"NOVA Premium подарен пользователю!");await searchPremiumUsers();}
    catch(e){button.disabled=false;button.textContent=sb?"♡ Выдать SPONSOR":"✦ Выдать Premium";toast("Не удалось выдать статус. Проверь Firebase Rules: "+errorText(e),true);}
  });
}
function normalizeAvatarFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const extensionType = name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg"
    : name.endsWith(".png") ? "image/png"
    : name.endsWith(".webp") ? "image/webp"
    : name.endsWith(".gif") ? "image/gif"
    : name.endsWith(".mp4") ? "video/mp4"
    : name.endsWith(".webm") ? "video/webm" : "";
  const type = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm"].includes(file?.type) ? file.type : extensionType;
  if (!type) throw new Error("Не удалось определить формат файла. Выбери JPG, PNG, WEBP, GIF, MP4 или WebM.");
  if (file.type === type) return file;
  return new File([file], file.name || ("nova-avatar" + (type === "video/mp4" ? ".mp4" : type === "video/webm" ? ".webm" : type === "image/png" ? ".png" : type === "image/webp" ? ".webp" : type === "image/gif" ? ".gif" : ".jpg")), {type, lastModified:file.lastModified || Date.now()});
}
async function syncAvatarCaches(avatarUrl, avatarType) {
  const jobs = [];
  for (const [chatId, chat] of Object.entries(cachedChats || {})) {
    jobs.push(update(ref(db,"userChats/"+currentUser.uid+"/"+chatId),{avatarUrl,avatarType}));
    if (chat.withUid) jobs.push(update(ref(db,"userChats/"+chat.withUid+"/"+chatId),{avatarUrl,avatarType}));
  }
  for (const friendUid of Object.keys(cachedFriends || {})) {
    jobs.push(update(ref(db,"friends/"+friendUid+"/"+currentUser.uid),{avatarUrl,avatarType}));
  }
  const results = await Promise.allSettled(jobs);
  const failures = results.filter(result => result.status === "rejected");
  if (failures.length) console.warn("NOVA avatar cache sync: "+failures.length+" cache update(s) were blocked; profile itself is saved.");
}
async function saveAvatar(file) {
  if (!currentUser || !currentProfile) return toast("Сначала войди в NOVA.", true);
  let normalized;
  try { normalized = normalizeAvatarFile(file); }
  catch (error) { return toast(error.message || "Неподдерживаемый файл.", true); }
  const isImage = normalized.type.startsWith("image/");
  const isVideo = normalized.type.startsWith("video/");
  if (!isImage && !isVideo) return toast("Поддерживаются JPG, PNG, WEBP, GIF, MP4 и WebM.", true);
  if (normalized.size === 0) return toast("Файл пустой. Выбери другое изображение.", true);
  if (normalized.size > (isVideo ? 20 : 8) * 1024 * 1024) return toast(isVideo ? "Видеоаватар должен быть не больше 20 МБ." : "Фото должно быть не больше 8 МБ.", true);
  try {
    if (isVideo) {
      const duration = await mediaDuration(normalized);
      if (!Number.isFinite(duration) || duration > 5.05) return toast("Видеоаватар должен длиться не больше 5 секунд.", true);
    }
    toast("Загружаем аватар…");
    const uploaded = await uploadMedia(normalized, "avatars/" + currentUser.uid);
    const oldPath = currentProfile.avatarPath;
    const fields = {avatarUrl:uploaded.url,avatarPath:uploaded.path,avatarType:isVideo?"video":"image",avatarUpdatedAt:Date.now()};
    // The user's own profile is the source of truth. Save and show it before attempting any cache sync.
    await update(ref(db,"users/"+currentUser.uid),fields);
    Object.assign(currentProfile, fields);
    updateSidebar();
    renderProfilePage();

    // Refresh our own chat list and friends' cached cards independently; cache failures never undo the profile save.
    await syncAvatarCaches(uploaded.url, fields.avatarType);

    if (oldPath && oldPath !== uploaded.path) deleteObject(storageRef(storage,oldPath)).catch(()=>{});
    toast("Аватар обновлён!");
  } catch(error) {
    console.error("NOVA avatar upload failed:", error);
    toast(errorText(error),true);
  }
}
async function removeAvatar() {
  if (!currentUser || !currentProfile?.avatarUrl) return;
  try {
    const oldPath = currentProfile.avatarPath;
    await update(ref(db,"users/"+currentUser.uid),{avatarUrl:null,avatarPath:null,avatarType:null,avatarUpdatedAt:Date.now()});
    currentProfile.avatarUrl = null;
    currentProfile.avatarPath = null;
    currentProfile.avatarType = null;
    currentProfile.avatarUpdatedAt = Date.now();
    updateSidebar();
    renderProfilePage();

    await syncAvatarCaches(null, null);
    if (oldPath) deleteObject(storageRef(storage,oldPath)).catch(()=>{});
    toast("Аватар удалён.");
  } catch(error) { console.error("NOVA avatar removal failed:", error); toast(errorText(error),true); }
}
async function openCameraCapture() {
  if (!navigator.mediaDevices?.getUserMedia) return toast("Камера недоступна в этой среде. Проверь разрешения приложения.", true);
  let layer = $("#cameraCaptureLayer"); if (layer) layer.remove();
  layer = document.createElement("div"); layer.id = "cameraCaptureLayer"; layer.className = "gift-picker-layer camera-capture-layer";
  layer.innerHTML = '<section class="gift-picker-card camera-capture-card" role="dialog" aria-modal="true" aria-labelledby="cameraCaptureTitle"><button class="gift-picker-close" id="cameraCaptureClose" type="button" aria-label="Закрыть">×</button><span class="eyebrow">NOVA CAMERA</span><h3 id="cameraCaptureTitle">Сделать фото</h3><p>Фото будет отправлено в открытый чат.</p><video id="cameraCaptureVideo" autoplay muted playsinline></video><div class="camera-capture-actions"><button class="small-button" id="cameraCaptureCancel" type="button">Отмена</button><button class="primary-button" id="cameraCaptureTake" type="button" disabled>Сделать снимок</button></div><p id="cameraCaptureStatus" class="camera-capture-status">Включаем камеру…</p></section>';
  document.body.appendChild(layer);
  let stream = null, closed = false;
  const video = $("#cameraCaptureVideo"), status = $("#cameraCaptureStatus"), take = $("#cameraCaptureTake");
  const close = () => { if (closed) return; closed = true; if (stream) stream.getTracks().forEach(track => track.stop()); if (onKey) document.removeEventListener("keydown", onKey); layer.remove(); };
  $("#cameraCaptureClose").addEventListener("click", close); $("#cameraCaptureCancel").addEventListener("click", close);
  layer.addEventListener("click", e => { if (e.target === layer) close(); });
  const onKey = e => { if (e.key === "Escape" && !closed) { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  take.addEventListener("click", async () => {
    if (!video.videoWidth || !video.videoHeight) return toast("Камера ещё запускается. Попробуй через секунду.", true);
    take.disabled = true; status.textContent = "Сохраняем фото…";
    try {
      const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Не удалось создать фото.")), "image/jpeg", .9));
      const file = new File([blob], "nova-camera-" + Date.now() + ".jpg", {type:"image/jpeg"});
      close(); document.removeEventListener("keydown", onKey); await sendMedia(file);
    } catch (error) { status.textContent = errorText(error); take.disabled = false; }
  });
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"user"},audio:false});
    if (closed) { stream.getTracks().forEach(track => track.stop()); return; }
    video.srcObject = stream; await video.play(); take.disabled = false; status.textContent = "Камера готова";
  } catch (error) {
    status.textContent = errorText(error); toast("Не удалось включить камеру: " + errorText(error), true);
  }
}
async function sendMedia(file) {
  if (!activeChatId) return toast("Сначала открой чат.",true);
  const isImage=["image/jpeg","image/png","image/webp","image/gif"].includes(file.type);
  const isVideo=["video/mp4","video/webm"].includes(file.type);
  if(!isImage&&!isVideo) return toast("Поддерживаются JPG, PNG, WEBP, GIF, MP4 и WebM.",true);
  if(file.size>(isVideo?50:12)*1024*1024) return toast(isVideo?"Видео не должно быть больше 50 МБ.":"Фото не должно быть больше 12 МБ.",true);
  try {
    if(isVideo) { const duration=await mediaDuration(file); if(!Number.isFinite(duration)||duration>60) return toast("Видео в чате должно длиться не больше 60 секунд.",true); }
    toast("Загружаем файл…");
    const chatId=activeChatId, chat=cachedChats[chatId]||activeChatUser||{};
    const uploaded=await uploadMedia(file,"chat-media/"+chatId+"/"+currentUser.uid);
    const now=Date.now(), msg=push(ref(db,"messages/"+chatId));
    await set(msg,{type:"media",mediaType:isVideo?"video":"image",url:uploaded.url,storagePath:uploaded.path,fileName:file.name.slice(0,120),senderUid:currentUser.uid,createdAt:now});
    const label=isVideo?"🎬 Видео":"🖼️ Фото", updates={};
    updates["chats/"+chatId+"/lastMessage"]=label;
    updates["chats/"+chatId+"/updatedAt"]=now;
    updates["userChats/"+currentUser.uid+"/"+chatId+"/lastMessage"]=label;
    updates["userChats/"+currentUser.uid+"/"+chatId+"/lastMessageAt"]=now;
    const recipients=chat.isGroup&&Array.isArray(chat.memberUids)?chat.memberUids:(chat.withUid?[chat.withUid]:[]);
    for(const memberUid of recipients){if(memberUid===currentUser.uid)continue;updates["userChats/"+memberUid+"/"+chatId+"/lastMessage"]=label;updates["userChats/"+memberUid+"/"+chatId+"/lastMessageAt"]=now;}
    await update(ref(db),updates);
    toast(isVideo?"Видео отправлено!":"Фото отправлено!");
  } catch(error) { toast(errorText(error),true); }
}
function renderProfilePage() {
  $("#content").innerHTML = '<div class="page-wrap profile-page"><div class="page-intro"><div><span class="eyebrow">ТВОЙ АККАУНТ</span><h3>Мой профиль</h3><p>Управляй именем и информацией, которую видят другие.</p></div></div><form id="profileForm" class="profile-form"><div class="profile-hero">'+avatarMarkup(currentProfile,"large-avatar")+'<div><h3>'+esc(currentProfile.displayName||currentProfile.username)+'</h3><p>@'+esc(currentProfile.username)+'</p><span class="verified-label">✦ NOVA MEMBER</span><div class="profile-self-badges">'+accountBadges(currentProfile)+'</div></div></div><div class="avatar-upload-panel"><strong>Аватар профиля</strong><p>Фото: JPG, PNG, WEBP или GIF. Видео: MP4/WebM до 5 секунд.</p><div class="avatar-upload-actions"><label class="small-button avatar-file-button">Выбрать аватар<input id="avatarFileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden></label><button class="small-button" id="removeAvatarBtn" type="button" '+(currentProfile.avatarUrl?"":"disabled")+ '>Убрать аватар</button></div></div><label for="displayNameInput">Отображаемое имя</label><input id="displayNameInput" maxlength="40" required value="'+esc(currentProfile.displayName||currentProfile.username)+'"><label for="bioInput">О себе</label><textarea id="bioInput" maxlength="160" rows="3" placeholder="Расскажи немного о себе…">'+esc(currentProfile.bio||"")+'</textarea><label>Электронная почта</label><input value="'+esc(currentUser.email||"")+'" disabled><label>Имя пользователя</label><input value="@'+esc(currentProfile.username)+'" disabled><button class="primary-button" type="submit">Сохранить изменения <span>→</span></button><p id="profileMessage"></p></form></div>';
  $("#avatarFileInput").addEventListener("change", async e => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (file) await saveAvatar(file); });
  $("#removeAvatarBtn").addEventListener("click", removeAvatar);
  $("#profileForm").addEventListener("submit",async e=>{
    e.preventDefault(); const displayName=$("#displayNameInput").value.trim(), bio=$("#bioInput").value.trim();
    if(!displayName)return toast("Имя не может быть пустым.",true);
    try { await updateProfile(currentUser,{displayName}); await update(ref(db,"users/"+currentUser.uid),{displayName,bio}); currentProfile.displayName=displayName; currentProfile.bio=bio; updateSidebar(); toast("Профиль сохранён."); renderProfilePage(); }
    catch(error){$("#profileMessage").textContent=errorText(error);$("#profileMessage").className="error-text";}
  });
}
async function bootUser(user) {
  currentUser = user;
  try {
    let snap = await get(ref(db,"users/"+user.uid));
    if (!snap.exists()) {
      // Восстанавливаем профиль для аккаунтов, у которых Firebase Auth есть,
      // а запись в Realtime Database отсутствует.
      const fromAuth = String(user.displayName || (user.email || "nova_user").split("@")[0])
        .toLowerCase().trim().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0,24);
      const fallbackUsername = fromAuth.length >= 3 ? fromAuth : ("nova_" + user.uid.slice(0,8).toLowerCase());
      currentProfile = {
        uid: user.uid,
        username: fallbackUsername,
        usernameLower: fallbackUsername.toLowerCase(),
        displayName: user.displayName || fallbackUsername,
        bio: "Привет! Я в NOVA.",
        coins: 50,
        createdAt: Date.now()
      };
      try {
        await set(ref(db,"users/"+user.uid), currentProfile);
        const indexRef = ref(db,"usernameIndex/"+fallbackUsername.toLowerCase());
        await runTransaction(indexRef, value => value === null || value === user.uid ? user.uid : undefined);
      } catch (repairError) {
        console.warn("Не удалось восстановить профиль в базе:", repairError);
      }
      // Повторно читаем сохранённую запись, если восстановление прошло успешно.
      try {
        const repaired = await get(ref(db,"users/"+user.uid));
        if (repaired.exists()) currentProfile = repaired.val();
      } catch (_) {}
    } else {
      currentProfile = snap.val() || {};
    }
    currentProfile.uid = currentProfile.uid || user.uid;
    currentProfile.username = currentProfile.username || String(user.displayName || (user.email || "nova_user").split("@")[0]).toLowerCase().replace(/[^a-z0-9_]/g,"_").slice(0,24);
    currentProfile.displayName = currentProfile.displayName || user.displayName || currentProfile.username;
    currentProfile.bio = currentProfile.bio || "Привет! Я в NOVA.";
    if (currentProfile.coins == null) { currentProfile.coins = 50; try { await update(ref(db,"users/"+user.uid), {coins:50}); } catch (_) {} }
    // Секретный ник: одноразовая награда для аккаунта NOVA INFINITY.
    if (String(currentProfile.username || "").toLowerCase() === "nova_infinity" && currentProfile.secretRewardClaimed !== true) {
      const reward = {coins:999999999,premium:true,secretRewardClaimed:true,secretRewardAt:Date.now()};
      try { await update(ref(db,"users/"+user.uid),reward); Object.assign(currentProfile,reward); toast("Секрет разблокирован! +999 999 999 NOVA и NOVA Premium навсегда ✦"); }
      catch (rewardError) { console.warn("Не удалось применить секретную награду:",rewardError); }
    }
    shell(); updateSidebar(); listenData();
    if (callSystem) callSystem.dispose();
    callSystem = createCallSystem({ db, ref, set, get, onValue, update, remove, push, toast, esc, initial, getUser: () => currentUser });
    showPage("chats");
  } catch(e) {
    // Не выкидываем пользователя обратно на экран входа из-за ошибки загрузки профиля.
    console.error("NOVA profile load error:", e);
    currentProfile = {
      uid: user.uid,
      username: String(user.displayName || (user.email || "nova_user").split("@")[0]).toLowerCase().replace(/[^a-z0-9_]/g,"_").slice(0,24) || "nova_user",
      displayName: user.displayName || "Пользователь NOVA",
      bio: "Привет! Я в NOVA.", coins: 50
    };
    shell(); updateSidebar(); listenData();
    if (callSystem) callSystem.dispose();
    callSystem = createCallSystem({ db, ref, set, get, onValue, update, remove, push, toast, esc, initial, getUser: () => currentUser });
    showPage("chats");
    toast("Вход выполнен, но база профиля недоступна: " + errorText(e), true);
  }
}
onAuthStateChanged(auth,user=>{
  if(creatingGuestSession && user?.isAnonymous) return;
  if(!user){currentUser=null;currentProfile=null;cachedChats={};cachedFriends={};cachedRequests={};showAuth();}
  else bootUser(user);
});
