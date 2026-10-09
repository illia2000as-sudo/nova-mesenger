
const chatsTab = document.getElementById("chatsTab");
const friendsTab = document.getElementById("friendsTab");
const pageTitle = document.getElementById("pageTitle");
const content = document.getElementById("content");

function showPage(page) {
  const isFriends = page === "friends";

  chatsTab.classList.toggle("active", !isFriends);
  friendsTab.classList.toggle("active", isFriends);

  pageTitle.textContent = isFriends ? "Друзі" : "Повідомлення";

  content.innerHTML = isFriends
    ? `<div class="welcome">
         <div class="welcome-icon">👥</div>
         <h2>Твої друзі</h2>
         <p>Тут буде пошук користувачів і додавання друзів.</p>
       </div>`
    : `<div class="welcome">
         <div class="welcome-icon">✦</div>
         <h2>Ласкаво просимо до NOVA</h2>
         <p>Тут будуть твої приватні повідомлення.</p>
       </div>`;
}

chatsTab.addEventListener("click", () => showPage("chats"));
friendsTab.addEventListener("click", () => showPage("friends"));
