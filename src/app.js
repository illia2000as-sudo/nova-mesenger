import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, deleteUser } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getDatabase, ref, set, get, onValue, push, update, remove, runTransaction } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";
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
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);
const $ = (s) => document.querySelector(s);
let currentUser = null, currentProfile = null, currentPage = "chats", activeChatId = null, activeChatUser = null;
let stopUserChats = null, stopMessages = null, stopRequests = null;
let callSystem = null;
let cachedChats = {}, cachedFriends = {}, cachedRequests = {};

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function initial(v) { return esc((String(v || "?").trim().split(/\s+/)[0][0] || "?").toUpperCase()); }
function uname(v) { return String(v || "").trim().replace(/^@/, "").toLowerCase(); }
function errorText(e) {
  const map = {"auth/email-already-in-use":"Этот email уже зарегистрирован.","auth/invalid-email":"Проверь адрес электронной почты.","auth/invalid-credential":"Неверная почта или пароль.","auth/weak-password":"Пароль должен содержать минимум 6 символов.","auth/network-request-failed":"Нет соединения с интернетом.","auth/too-many-requests":"Слишком много попыток. Попробуй позже.","PERMISSION_DENIED":"Firebase отклонил действие. Проверь правила базы данных."};
  return map[e && e.code] || (e && e.message) || "Неизвестная ошибка.";
}
function toast(message, error) {
  let n = $("#toast");
  if (!n) { n = document.createElement("div"); n.id = "toast"; n.className = "toast"; document.body.appendChild(n); }
  n.textContent = message; n.className = "toast show" + (error ? " error" : "");
  clearTimeout(n._timer); n._timer = setTimeout(() => n.classList.remove("show"), 3500);
}
function stopListeners() {
  if (stopUserChats) stopUserChats();
  if (stopMessages) stopMessages();
  if (stopRequests) stopRequests();
  stopUserChats = stopMessages = stopRequests = null;
}
function showAuth() {
  stopListeners();
  document.body.innerHTML = '<main class="auth-screen"><div class="auth-glow"></div><section class="auth-card"><div class="brand auth-brand"><div class="brand-mark">✦</div><div><h1>NOVA</h1><small>MESSENGER</small></div></div><div class="auth-heading"><span class="eyebrow">ТВОЯ СВЯЗЬ. ТВОИ ЛЮДИ.</span><h2 id="authTitle">С возвращением</h2><p id="authSub">Войди, чтобы продолжить общение.</p></div><form id="authForm"><div id="usernameWrap" hidden><label for="usernameInput">Имя пользователя</label><input id="usernameInput" maxlength="24" autocomplete="username" placeholder="например, nova_player"><small class="field-hint">3–24 символа: латиница, цифры и _</small></div><label for="emailInput">Электронная почта</label><input id="emailInput" type="email" autocomplete="email" required placeholder="you@example.com"><label for="passwordInput">Пароль</label><input id="passwordInput" type="password" minlength="6" autocomplete="current-password" required placeholder="Минимум 6 символов"><p id="authMessage" role="status"></p><button class="primary-button full-button" id="authSubmit" type="submit">Войти в NOVA <span>→</span></button></form><button class="auth-switch" id="authSwitch" type="button">Нет аккаунта? <strong>Создать</strong></button><p class="auth-foot">Сообщения синхронизируются через Firebase.</p></section></main>';
  let registering = false;
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
          await set(ref(db, "users/" + credential.user.uid), {uid:credential.user.uid, username, usernameLower:username, displayName:username, bio:"Привет! Я в NOVA.", createdAt:Date.now()});
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
  document.body.innerHTML = '<aside class="sidebar"><div class="brand"><div class="brand-mark">✦</div><div><h1>NOVA</h1><small>MESSENGER</small></div></div><button class="nav active" data-page="chats"><span>▤</span> Сообщения <b id="chatBadge" class="badge" hidden>0</b></button><button class="nav" data-page="friends"><span>♧</span> Друзья</button><button class="nav" data-page="requests"><span>♡</span> Заявки <b id="requestBadge" class="badge" hidden>0</b></button><button class="nav premium-nav" data-page="premium"><span>✧</span> NOVA Premium <em>SOON</em></button><button class="nav" data-page="profile"><span>⚙</span> Мой профиль</button><div class="sidebar-bottom"><div class="profile-mini"><div class="avatar" id="sideAvatar">N</div><div class="profile-text"><strong id="sideName">Загрузка…</strong><small id="sideHandle">@nova</small></div><button class="icon-button" id="logoutBtn" title="Выйти">↪</button></div><div class="connection"><i></i> Подключено к NOVA</div></div></aside><main class="main-shell"><header class="topbar"><div><div class="eyebrow">ТВОЁ ПРОСТРАНСТВО</div><h2 id="pageTitle">Сообщения</h2></div><div class="topbar-right"><span class="online-dot"></span><span>В сети</span></div></header><section id="content" class="content"></section></main><div id="toast" class="toast"></div>';
  document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
  $("#logoutBtn").addEventListener("click", async () => { try { await signOut(auth); } catch(e) { toast(errorText(e), true); } });
}
function updateSidebar() {
  $("#sideName").textContent = currentProfile.displayName || currentProfile.username || "Пользователь";
  $("#sideHandle").textContent = "@" + (currentProfile.username || "user");
  $("#sideAvatar").textContent = initial(currentProfile.displayName || currentProfile.username);
}
function listenData() {
  stopListeners();
  stopUserChats = onValue(ref(db, "userChats/" + currentUser.uid), snap => {
    cachedChats = snap.val() || {};
    const badge = $("#chatBadge"); if (badge) badge.hidden = Object.keys(cachedChats).length === 0;
    if (currentPage === "chats") { if (activeChatId) renderChatListOnly(); else renderChatsPage(); }
  }, e => toast(errorText(e), true));
  stopRequests = onValue(ref(db, "friendRequests/" + currentUser.uid), snap => {
    cachedRequests = snap.val() || {};
    const badge = $("#requestBadge");
    if (badge) { const count = Object.keys(cachedRequests).length; badge.hidden = !count; badge.textContent = count > 9 ? "9+" : count; }
    if (currentPage === "requests") renderRequestsPage();
  }, e => toast(errorText(e), true));
}
function showPage(page) {
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
  $("#content").innerHTML = '<div class="chat-layout"><aside class="chat-list-panel"><div class="panel-heading"><div><h3>Твои диалоги</h3><p>Личные сообщения</p></div><button class="icon-button accent-icon" id="newChatBtn" title="Найти друзей">＋</button></div><div class="chat-search"><span>⌕</span><input id="chatFilter" placeholder="Поиск диалога…"></div><div id="chatList" class="chat-list"></div></aside><div id="chatStage" class="chat-stage"><div class="empty-state"><div class="empty-orbit">✦</div><h3>Твоя связь начинается здесь</h3><p>Выбери диалог слева или найди друзей, чтобы начать общаться.</p><button class="primary-button" id="findPeopleBtn">Найти людей <span>→</span></button></div></div></div>';
  $("#newChatBtn").addEventListener("click", () => showPage("friends"));
  $("#findPeopleBtn").addEventListener("click", () => showPage("friends"));
  $("#chatFilter").addEventListener("input", renderChatListOnly);
  renderChatListOnly();
}
function renderChatListOnly() {
  const list = $("#chatList"); if (!list) return;
  const filter = ($("#chatFilter") ? $("#chatFilter").value : "").toLowerCase();
  const entries = Object.entries(cachedChats).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0)).filter(x => (x[1].username || x[1].displayName || "").toLowerCase().includes(filter));
  if (!entries.length) { list.innerHTML = '<div class="list-empty"><div>✧</div><strong>Пока тихо</strong><p>Найди друга и отправь первое сообщение.</p></div>'; return; }
  list.innerHTML = entries.map(([id,c]) => '<button class="chat-item '+(activeChatId===id?"selected":"")+'" data-chat-id="'+esc(id)+'"><div class="avatar">'+initial(c.displayName||c.username)+'</div><div class="chat-item-copy"><strong>'+esc(c.displayName||c.username||"Пользователь")+'</strong><small>'+esc(c.lastMessage||"Начните общение")+'</small></div><small class="chat-time">'+(c.lastMessageAt?timeLabel(c.lastMessageAt):"")+'</small></button>').join("");
  list.querySelectorAll("[data-chat-id]").forEach(b => b.addEventListener("click", () => openChat(b.dataset.chatId, cachedChats[b.dataset.chatId])));
}
async function openChat(chatId, info) {
  activeChatId = chatId; activeChatUser = info || {}; renderChatListOnly();
  const stage = $("#chatStage"); if (!stage) return;
  stage.innerHTML = '<div class="conversation-head"><div class="avatar">'+initial(activeChatUser.displayName||activeChatUser.username)+'</div><div><strong>'+esc(activeChatUser.displayName||activeChatUser.username||"Диалог")+'</strong><small>@'+esc(activeChatUser.username||"user")+'</small></div><button id="audioCallBtn" class="call-start-button" type="button" title="Начать аудиозвонок">☎ <span>Позвонить</span></button><span class="conversation-status"><i></i> NOVA</span></div><div id="messageList" class="message-list"><div class="loading-note">Загружаем сообщения…</div></div><form id="messageForm" class="message-composer"><input id="messageInput" maxlength="4000" autocomplete="off" placeholder="Напиши сообщение…" required><button class="send-button" type="submit" aria-label="Отправить">➤</button></form>';
  $("#audioCallBtn").addEventListener("click", () => {
    if (!callSystem) return toast("Система звонков ещё запускается.", true);
    callSystem.startAudioCall({...activeChatUser, chatId});
  });
  if (stopMessages) stopMessages();
  stopMessages = onValue(ref(db, "messages/" + chatId), snap => {
    const messages = Object.entries(snap.val() || {}).sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0));
    const box = $("#messageList"); if (!box) return;
    box.innerHTML = messages.length ? messages.map(x => '<div class="message-row '+(x[1].senderUid===currentUser.uid?"mine":"")+'"><div class="message-bubble"><div>'+esc(x[1].text).replace(/\n/g,"<br>")+'</div><small>'+timeLabel(x[1].createdAt||Date.now())+(x[1].senderUid===currentUser.uid?" · Вы":"")+'</small></div></div>').join("") : '<div class="empty-messages"><span>✦</span><p>Это начало вашей истории. Напиши первым!</p></div>';
    box.scrollTop = box.scrollHeight;
  }, e => toast(errorText(e), true));
  $("#messageForm").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#messageInput"), text = input.value.trim(); if (!text || !activeChatId) return;
    $(".send-button").disabled = true;
    try {
      const now = Date.now(), id = activeChatId, message = push(ref(db, "messages/" + id));
      await set(message, {senderUid:currentUser.uid,text,createdAt:now});
      const chat = cachedChats[id] || {}, updates = {};
      updates["chats/"+id+"/lastMessage"] = text.slice(0,120);
      updates["chats/"+id+"/updatedAt"] = now;
      updates["userChats/"+currentUser.uid+"/"+id+"/lastMessage"] = text.slice(0,120);
      updates["userChats/"+currentUser.uid+"/"+id+"/lastMessageAt"] = now;
      if (chat.withUid) {
        updates["userChats/"+chat.withUid+"/"+id+"/lastMessage"] = text.slice(0,120);
        updates["userChats/"+chat.withUid+"/"+id+"/lastMessageAt"] = now;
      }
      await update(ref(db), updates); input.value = ""; input.focus();
    } catch(e) { toast(errorText(e), true); }
    finally { if ($(".send-button")) $(".send-button").disabled = false; }
  });
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
    result.innerHTML = matches.map(u => {
      const isFriend = !!cachedFriends[u.uid], pending = !!cachedRequests[u.uid];
      return '<article class="person-card"><div class="avatar">'+initial(u.displayName||u.username)+'</div><div class="person-copy"><strong>'+esc(u.displayName||u.username)+'</strong><small>@'+esc(u.username)+'</small><p>'+esc(u.bio||"Пользователь NOVA")+'</p></div><button class="small-button" data-add-uid="'+esc(u.uid)+'" '+(isFriend||pending?"disabled":"")+'>'+(isFriend?"Уже друг":pending?"Заявка отправлена":"＋ Добавить")+'</button></article>';
    }).join("");
    result.querySelectorAll("[data-add-uid]").forEach(b => b.addEventListener("click", () => sendFriendRequest(b.dataset.addUid,b)));
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
    grid.innerHTML = friends.length ? friends.map(f => '<article class="person-card"><div class="avatar">'+initial(f.displayName||f.username)+'</div><div class="person-copy"><strong>'+esc(f.displayName||f.username)+'</strong><small>@'+esc(f.username)+'</small><p>Уже в твоём списке друзей</p></div><button class="small-button" data-chat-friend="'+esc(f.uid)+'">Написать ↗</button></article>').join("") : '<div class="helper-card"><span>♧</span><p>Пока нет друзей. Найди пользователя выше и отправь заявку.</p></div>';
    grid.querySelectorAll("[data-chat-friend]").forEach(b => b.addEventListener("click", () => startChat(b.dataset.chatFriend)));
  } catch(e) { toast(errorText(e),true); }
}
function renderRequestsPage() {
  const entries = Object.entries(cachedRequests);
  $("#content").innerHTML = '<div class="page-wrap"><div class="page-intro"><div><span class="eyebrow">НОВЫЕ ЗНАКОМСТВА</span><h3>Заявки в друзья</h3><p>Принимай заявки, чтобы начать общаться.</p></div></div><div class="people-grid">'+(entries.length?entries.map(([uid,r])=>'<article class="person-card"><div class="avatar">'+initial(r.displayName||r.username)+'</div><div class="person-copy"><strong>'+esc(r.displayName||r.username)+'</strong><small>@'+esc(r.username)+'</small><p>Хочет добавить тебя в друзья</p></div><button class="small-button accept-button" data-accept="'+esc(uid)+'">Принять</button><button class="small-button muted-button" data-reject="'+esc(uid)+'">✕</button></article>').join(""):'<div class="helper-card"><span>♡</span><p>Новых заявок пока нет.</p></div>')+'</div></div>';
  $("#content").querySelectorAll("[data-accept]").forEach(b => b.addEventListener("click",()=>acceptRequest(b.dataset.accept)));
  $("#content").querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click",async()=>{try{await remove(ref(db,"friendRequests/"+currentUser.uid+"/"+b.dataset.reject));toast("Заявка отклонена.");}catch(e){toast(errorText(e),true);}}));
}
async function acceptRequest(friendUid) {
  try {
    const snap = await get(ref(db,"friendRequests/"+currentUser.uid+"/"+friendUid));
    if (!snap.exists()) return toast("Заявка уже удалена.",true);
    const incoming = snap.val(), now = Date.now(), updates = {};
    updates["friends/"+currentUser.uid+"/"+friendUid] = {uid:friendUid,username:incoming.username,displayName:incoming.displayName,since:now};
    updates["friends/"+friendUid+"/"+currentUser.uid] = {uid:currentUser.uid,username:currentProfile.username,displayName:currentProfile.displayName,since:now};
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
    const mine = {withUid:friendUid,username:friend.username,displayName:friend.displayName||friend.username,lastMessage:"",updatedAt:now};
    const theirs = {withUid:currentUser.uid,username:currentProfile.username,displayName:currentProfile.displayName||currentProfile.username,lastMessage:"",updatedAt:now};
    const updates = {};
    updates["userChats/"+currentUser.uid+"/"+id] = mine;
    updates["userChats/"+friendUid+"/"+id] = theirs;
    await update(ref(db),updates);
    showPage("chats"); setTimeout(()=>openChat(id,cachedChats[id]||mine),150);
  } catch(e) { toast(errorText(e),true); }
}
function renderPremiumPage() {
  $("#content").innerHTML = '<div class="page-wrap premium-page"><section class="premium-hero"><div class="premium-orb">✦</div><div class="premium-kicker">NOVA · БОЛЬШЕ ВОЗМОЖНОСТЕЙ</div><h3>Общайся <span>без границ</span></h3><p>Premium задуман для тех, кто хочет поддержать развитие NOVA и получить больше возможностей. Сейчас это предварительный экран: реальные платежи ещё не подключены.</p><div class="premium-pills"><span>✦ Ранний доступ</span><span>◈ Особые темы</span><span>♡ Поддержка проекта</span></div></section><div class="premium-section-heading"><div><span class="eyebrow">ТВОЙ ТАРИФ</span><h3>Выбери свой NOVA</h3></div><span class="plan-status">Сейчас: Бесплатный</span></div><div class="premium-plans"><article class="plan-card"><div class="plan-top"><div class="plan-icon free-icon">✦</div><span class="plan-label">ДЛЯ ВСЕХ</span></div><h4>NOVA Free</h4><div class="plan-price">$0 <small>/ навсегда</small></div><p class="plan-description">Всё необходимое для общения с друзьями.</p><ul><li>✓ Личные сообщения</li><li>✓ Друзья и заявки</li><li>✓ Настройка профиля</li><li>✓ Синхронизация в реальном времени</li></ul><div class="current-plan">ТВОЙ ТЕКУЩИЙ ТАРИФ</div></article><article class="plan-card premium-plan"><div class="plan-top"><div class="plan-icon premium-icon">✧</div><span class="plan-label">В РАЗРАБОТКЕ</span></div><h4>NOVA Premium</h4><div class="plan-price">$0.99 <small>/ месяц · планируемая цена</small></div><p class="plan-description">Больше персонализации и способ поддержать развитие приложения.</p><ul><li>✦ Эксклюзивные темы оформления</li><li>✦ Дополнительные настройки профиля</li><li>✦ Значок Premium</li><li>✦ Ранний доступ к новым функциям</li></ul><button class="premium-disabled-button" disabled>Скоро появится</button><p class="payment-note">Оплата отключена. Сейчас деньги не списываются.</p></article></div><section class="premium-roadmap"><div class="roadmap-icon">↗</div><div><strong>Сначала — стабильный мессенджер</strong><p>Перед запуском подписки мы проверим чаты, защиту аккаунтов и работу приложения. Цена и функции могут измениться до официального запуска.</p></div></section></div>';
}
function renderProfilePage() {
  $("#content").innerHTML = '<div class="page-wrap profile-page"><div class="page-intro"><div><span class="eyebrow">ТВОЙ АККАУНТ</span><h3>Мой профиль</h3><p>Управляй именем и информацией, которую видят другие.</p></div></div><form id="profileForm" class="profile-form"><div class="profile-hero"><div class="avatar large-avatar">'+initial(currentProfile.displayName||currentProfile.username)+'</div><div><h3>'+esc(currentProfile.displayName||currentProfile.username)+'</h3><p>@'+esc(currentProfile.username)+'</p><span class="verified-label">✦ NOVA MEMBER</span></div></div><label for="displayNameInput">Отображаемое имя</label><input id="displayNameInput" maxlength="40" required value="'+esc(currentProfile.displayName||currentProfile.username)+'"><label for="bioInput">О себе</label><textarea id="bioInput" maxlength="160" rows="3" placeholder="Расскажи немного о себе…">'+esc(currentProfile.bio||"")+'</textarea><label>Электронная почта</label><input value="'+esc(currentUser.email||"")+'" disabled><label>Имя пользователя</label><input value="@'+esc(currentProfile.username)+'" disabled><button class="primary-button" type="submit">Сохранить изменения <span>→</span></button><p id="profileMessage"></p></form></div>';
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
      bio: "Привет! Я в NOVA."
    };
    shell(); updateSidebar(); listenData();
    if (callSystem) callSystem.dispose();
    callSystem = createCallSystem({ db, ref, set, get, onValue, update, remove, push, toast, esc, initial, getUser: () => currentUser });
    showPage("chats");
    toast("Вход выполнен, но база профиля недоступна: " + errorText(e), true);
  }
}
onAuthStateChanged(auth,user=>{
  if(!user){currentUser=null;currentProfile=null;cachedChats={};cachedFriends={};cachedRequests={};showAuth();}
  else bootUser(user);
});
