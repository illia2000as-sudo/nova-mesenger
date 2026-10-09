// NOVA calls — WebRTC audio/video with in-call screen sharing.
export function createCallSystem(api) {
  const { db, ref, set, get, onValue, update, remove, push, toast, esc, initial, getUser } = api;
  let peer = null;
  let localStream = null;
  let displayStream = null;
  let screenAudioContext = null;
  let screenAudioSender = null;
  let activeCallId = null;
  let activeCallRef = null;
  let stopInbox = null;
  let stopIncomingCall = null;
  let stopCall = null;
  let stopCandidates = null;
  let remoteCandidateIds = new Set();
  let callReady = false;
  let pendingCandidates = [];
  let finishing = false;
  let incomingCall = null;
  let audioElement = null;
  let remoteVideoElement = null;
  let localVideoElement = null;
  let activeCallType = "audio";
  let remoteCandidateData = {};

  const uid = () => getUser()?.uid;
  const callLayer = () => document.getElementById("novaCallLayer");

  function ensureLayer() {
    if (callLayer()) return;
    const layer = document.createElement("div");
    layer.id = "novaCallLayer";
    layer.className = "call-layer";
    layer.hidden = true;
    layer.innerHTML = '<section class="call-card" role="dialog" aria-modal="true" aria-labelledby="callTitle"><div class="call-orb" id="callOrb">☎</div><div class="call-eyebrow">NOVA · CALL</div><h2 id="callTitle">Аудиозвонок</h2><p id="callPerson" class="call-person">Пользователь NOVA</p><p id="callStatus" class="call-status">Подключаемся…</p><div id="callVideoStage" class="call-video-stage" hidden><video id="callRemoteVideo" class="call-remote-video" autoplay playsinline></video><video id="callLocalVideo" class="call-local-video" autoplay muted playsinline></video></div><audio id="callRemoteAudio" autoplay></audio><div class="call-controls"><button id="callMuteBtn" class="call-control mute" type="button" title="Выключить микрофон">🎙</button><button id="callCameraBtn" class="call-control camera" type="button" title="Выключить камеру" hidden>📹</button><button id="callScreenBtn" class="call-control screen" type="button" title="Показать экран" hidden>🖥️</button><button id="callHangupBtn" class="call-control hangup" type="button" title="Завершить звонок">☎</button></div><div id="callIncomingActions" class="call-incoming-actions" hidden><button id="callRejectBtn" class="call-reject" type="button">Отклонить</button><button id="callAcceptBtn" class="call-accept" type="button">Принять звонок</button></div><p id="callFootnote" class="call-footnote">Только голос · камера не используется</p></section>';
    document.body.appendChild(layer);
    audioElement = layer.querySelector("#callRemoteAudio");
    remoteVideoElement = layer.querySelector("#callRemoteVideo");
    localVideoElement = layer.querySelector("#callLocalVideo");
    layer.querySelector("#callCameraBtn").addEventListener("click", toggleCamera);
    layer.querySelector("#callScreenBtn").addEventListener("click", () => toggleScreenShare());
    layer.querySelector("#callHangupBtn").addEventListener("click", () => endCall(true));
    layer.querySelector("#callMuteBtn").addEventListener("click", toggleMute);
    layer.querySelector("#callAcceptBtn").addEventListener("click", acceptIncoming);
    layer.querySelector("#callRejectBtn").addEventListener("click", rejectIncoming);
  }

  function showLayer(name, status, incoming = false) {
    ensureLayer();
    const layer = callLayer();
    layer.hidden = false;
    layer.querySelector("#callPerson").textContent = name || "Пользователь NOVA";
    layer.querySelector("#callStatus").textContent = status || "";
    layer.querySelector("#callIncomingActions").hidden = !incoming;
    layer.querySelector("#callMuteBtn").hidden = incoming;
    layer.querySelector("#callHangupBtn").hidden = incoming;
    layer.querySelector("#callTitle").textContent = incoming ? (activeCallType === "video" ? "Входящий видеозвонок" : "Входящий аудиозвонок") : (activeCallType === "video" ? "Видеозвонок" : "Аудиозвонок");
    layer.querySelector("#callOrb").hidden = activeCallType === "video";
    layer.querySelector("#callVideoStage").hidden = activeCallType !== "video";
    layer.querySelector("#callCameraBtn").hidden = incoming || activeCallType !== "video";
    layer.querySelector("#callScreenBtn").hidden = incoming || activeCallType !== "video";
    layer.querySelector("#callFootnote").textContent = activeCallType === "video" ? "Видео и звук · камера работает только во время звонка" : "Только голос · камера не используется";
  }

  function hideLayer() {
    const layer = callLayer();
    if (layer) layer.hidden = true;
    if (audioElement) audioElement.srcObject = null;
    if (remoteVideoElement) remoteVideoElement.srcObject = null;
    if (localVideoElement) localVideoElement.srcObject = null;
  }

  function setStatus(value) {
    const node = callLayer()?.querySelector("#callStatus");
    if (node) node.textContent = value;
  }

  function cleanupLocal() {
    if (stopCall) stopCall();
    if (stopCandidates) stopCandidates();
    stopCall = stopCandidates = null;
    if (peer) { try { peer.onicecandidate = null; peer.ontrack = null; peer.close(); } catch (_) {} }
    peer = null;
    if (displayStream) { displayStream.getTracks().forEach(track => { track.onended = null; track.stop(); }); displayStream = null; }
    if (screenAudioContext) { try { screenAudioContext.close(); } catch (_) {} screenAudioContext = null; }
    screenAudioSender = null;
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    if (audioElement) audioElement.srcObject = null;
    if (remoteVideoElement) remoteVideoElement.srcObject = null;
    if (localVideoElement) localVideoElement.srcObject = null;
    activeCallType = "audio";
    activeCallId = null;
    activeCallRef = null;
    callReady = false;
    pendingCandidates = [];
    remoteCandidateIds = new Set();
    remoteCandidateData = {};
    finishing = false;
  }

  async function endCall(notify = true, message = "Звонок завершён.") {
    if (finishing) return;
    finishing = true;
    const id = activeCallId;
    const userId = uid();
    cleanupLocal();
    hideLayer();
    if (notify && id && userId) {
      try {
        await update(ref(db, "calls/" + id), { status: "ended", endedBy: userId, endedAt: Date.now() });
      } catch (e) { console.warn("NOVA call end signal:", e); }
      try { await remove(ref(db, "callInbox/" + userId + "/" + id)); } catch (_) {}
    }
    if (message) toast(message);
  }

  async function createPeer(callId, otherUid) {
    peer = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
    });
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    peer.ontrack = event => {
      const stream = event.streams[0];
      if (activeCallType === "video" && remoteVideoElement) remoteVideoElement.srcObject = stream;
      else if (audioElement) audioElement.srcObject = stream;
    };
    peer.onconnectionstatechange = () => {
      if (!peer) return;
      if (peer.connectionState === "connected") setStatus("Разговор идёт");
      if (["failed", "disconnected"].includes(peer.connectionState)) setStatus("Соединение нестабильно. Подожди немного…");
      if (peer.connectionState === "closed") hideLayer();
    };
    peer.onicecandidate = async event => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      if (!callReady) { pendingCandidates.push(candidate); return; }
      try { await push(ref(db, "calls/" + callId + "/candidates/" + uid()), candidate); }
      catch (e) { console.warn("NOVA ICE candidate:", e); }
    };
    activeCallRef = ref(db, "calls/" + callId);
    stopCandidates = onValue(ref(db, "calls/" + callId + "/candidates/" + otherUid), snap => {
      remoteCandidateData = snap.val() || {};
      processRemoteCandidates();
    });
  }

  async function flushLocalCandidates(callId) {
    callReady = true;
    for (const candidate of pendingCandidates.splice(0)) {
      try { await push(ref(db, "calls/" + callId + "/candidates/" + uid()), candidate); }
      catch (e) { console.warn("NOVA queued ICE candidate:", e); }
    }
  }

  async function processRemoteCandidates() {
    if (!peer || !peer.remoteDescription) return;
    for (const [candidateId, candidate] of Object.entries(remoteCandidateData)) {
      if (remoteCandidateIds.has(candidateId)) continue;
      remoteCandidateIds.add(candidateId);
      try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (e) { console.warn("NOVA remote ICE candidate:", e); }
    }
  }

  async function startCall(friend, type = "audio") {
    if (activeCallId) return toast("Сначала заверши текущий звонок.", true);
    const otherUid = friend?.withUid || friend?.uid;
    if (!otherUid || otherUid === uid()) return toast("Не удалось определить собеседника.", true);
    activeCallType = type === "video" ? "video" : "audio";
    try {
      ensureLayer();
      showLayer(friend.displayName || friend.username, activeCallType === "video" ? "Запрашиваем доступ к камере и микрофону…" : "Запрашиваем доступ к микрофону…");
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: activeCallType === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false
      });
      if (activeCallType === "video" && localVideoElement) localVideoElement.srcObject = localStream;
      const callRef = push(ref(db, "calls"));
      const callId = callRef.key;
      const me = getUser();
      activeCallId = callId;
      const callBase = {
        callerUid: me.uid,
        calleeUid: otherUid,
        callerName: me.displayName || me.email?.split("@")[0] || "Пользователь NOVA",
        calleeName: friend.displayName || friend.username || "Пользователь NOVA",
        members: { [me.uid]: true, [otherUid]: true },
        callType: activeCallType,
        status: "preparing",
        createdAt: Date.now()
      };
      await set(callRef, callBase);
      await createPeer(callId, otherUid);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await update(callRef, { status: "ringing", offer: { type: offer.type, sdp: offer.sdp } });
      await flushLocalCandidates(callId);
      await set(ref(db, "callInbox/" + otherUid + "/" + callId), {
        callId, callerUid: me.uid,
        callerName: me.displayName || me.email?.split("@")[0] || "Пользователь NOVA",
        callType: activeCallType,
        chatId: friend.chatId || "",
        createdAt: Date.now()
      });
      setStatus(activeCallType === "video" ? "Видеозвонок · звоним…" : "Звоним…");
      stopCall = onValue(callRef, snap => {
        const data = snap.val();
        if (!data) return;
        if (data.status === "active" && data.answer && peer && !peer.remoteDescription) {
          peer.setRemoteDescription(new RTCSessionDescription(data.answer)).then(() => {
            setStatus(activeCallType === "video" ? "Соединяем видео…" : "Соединяем голос…");
            processRemoteCandidates();
          }).catch(e => console.warn(e));
        }
        if (["declined", "ended", "missed"].includes(data.status) && activeCallId === callId) {
          endCall(false, data.status === "declined" ? "Звонок отклонён." : "Собеседник завершил звонок.");
        }
      });
    } catch (e) {
      console.error("NOVA call error:", e);
      const denied = e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError";
      await endCall(false, denied ? "Нет доступа к камере или микрофону. Разреши их в настройках Windows." : "Не удалось начать звонок: " + (e?.message || "ошибка"));
    }
  }

  async function startAudioCall(friend) { return startCall(friend, "audio"); }
  async function startVideoCall(friend) { return startCall(friend, "video"); }

  async function acceptIncoming() {
    const incoming = incomingCall;
    if (!incoming || activeCallId) return;
    incomingCall = null;
    if (stopIncomingCall) stopIncomingCall();
    stopIncomingCall = null;
    try {
      activeCallType = incoming.callType === "video" ? "video" : "audio";
      showLayer(incoming.callerName, activeCallType === "video" ? "Подключаем камеру и микрофон…" : "Подключаем микрофон…");
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: activeCallType === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false
      });
      if (activeCallType === "video" && localVideoElement) localVideoElement.srcObject = localStream;
      const snap = await get(ref(db, "calls/" + incoming.callId));
      if (!snap.exists()) throw new Error("Звонок уже завершён.");
      const data = snap.val();
      if (data.status !== "ringing") throw new Error("Звонок больше не активен.");
      activeCallId = incoming.callId;
      await createPeer(incoming.callId, incoming.callerUid);
      await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
      await processRemoteCandidates();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await update(ref(db, "calls/" + incoming.callId), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: "active",
        acceptedAt: Date.now()
      });
      await flushLocalCandidates(incoming.callId);
      await remove(ref(db, "callInbox/" + uid() + "/" + incoming.callId));
      setStatus("Соединяем голос…");
      stopCall = onValue(ref(db, "calls/" + incoming.callId), snap2 => {
        const call = snap2.val();
        if (!call || ["ended", "declined", "missed"].includes(call.status)) {
          if (activeCallId === incoming.callId) endCall(false, "Звонок завершён.");
        }
      });
    } catch (e) {
      console.error("NOVA accept call error:", e);
      try { await update(ref(db, "calls/" + incoming.callId), { status: "declined", endedBy: uid(), endedAt: Date.now() }); } catch (_) {}
      try { await remove(ref(db, "callInbox/" + uid() + "/" + incoming.callId)); } catch (_) {}
      await endCall(false, "Не удалось принять звонок: " + (e?.message || "ошибка"));
    }
  }

  async function rejectIncoming() {
    const incoming = incomingCall;
    incomingCall = null;
    if (stopIncomingCall) stopIncomingCall();
    stopIncomingCall = null;
    hideLayer();
    if (!incoming) return;
    try { await update(ref(db, "calls/" + incoming.callId), { status: "declined", endedBy: uid(), endedAt: Date.now() }); } catch (_) {}
    try { await remove(ref(db, "callInbox/" + uid() + "/" + incoming.callId)); } catch (_) {}
    toast("Вызов отклонён.");
  }

  function toggleMute() {
    if (!localStream) return;
    const enabled = localStream.getAudioTracks().some(track => track.enabled);
    localStream.getAudioTracks().forEach(track => { track.enabled = !enabled; });
    const button = callLayer()?.querySelector("#callMuteBtn");
    if (button) { button.classList.toggle("muted", enabled); button.textContent = enabled ? "🔇" : "🎙"; button.title = enabled ? "Включить микрофон" : "Выключить микрофон"; }
    setStatus(enabled ? "Микрофон выключен" : "Разговор идёт");
  }

  function toggleCamera() {
    if (!localStream) return;
    const tracks = localStream.getVideoTracks();
    if (!tracks.length) return;
    const enabled = tracks.some(track => track.enabled);
    tracks.forEach(track => { track.enabled = !enabled; });
    const button = callLayer()?.querySelector("#callCameraBtn");
    if (button) { button.classList.toggle("muted", enabled); button.textContent = enabled ? "🚫" : "📹"; button.title = enabled ? "Включить камеру" : "Выключить камеру"; }
    setStatus(enabled ? "Камера выключена" : "Разговор идёт");
  }

  async function toggleScreenShare() {
    if (!activeCallId || activeCallType !== "video" || !peer) {
      toast("Для демонстрации экрана сначала начни видеозвонок.", true);
      return;
    }
    if (displayStream) { await stopScreenShare(true); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast("Демонстрация экрана недоступна. Открой NOVA в Chrome или Edge.", true);
      return;
    }
    let pickedStream = null;
    try {
      pickedStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true });
      const displayVideoTrack = pickedStream.getVideoTracks()[0];
      const videoSender = peer.getSenders().find(sender => sender.track?.kind === "video");
      if (!displayVideoTrack || !videoSender) throw new Error("Не найден видеоканал. Перезапусти видеозвонок.");
      await videoSender.replaceTrack(displayVideoTrack);
      displayStream = pickedStream;
      if (localVideoElement) localVideoElement.srcObject = displayStream;
      const button = callLayer()?.querySelector("#callScreenBtn");
      if (button) { button.textContent = "⏹"; button.title = "Остановить показ экрана"; button.classList.add("sharing"); }
      displayVideoTrack.onended = () => { if (displayStream) stopScreenShare(true); };
      const displayAudioTracks = pickedStream.getAudioTracks();
      const micTracks = localStream?.getAudioTracks() || [];
      if (displayAudioTracks.length && micTracks.length) {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          const audioSender = peer.getSenders().find(sender => sender.track?.kind === "audio");
          if (AudioContextClass && audioSender) {
            screenAudioContext = new AudioContextClass();
            await screenAudioContext.resume();
            const destination = screenAudioContext.createMediaStreamDestination();
            screenAudioContext.createMediaStreamSource(new MediaStream(micTracks)).connect(destination);
            screenAudioContext.createMediaStreamSource(new MediaStream(displayAudioTracks)).connect(destination);
            const mixedTrack = destination.stream.getAudioTracks()[0];
            if (mixedTrack) { await audioSender.replaceTrack(mixedTrack); screenAudioSender = audioSender; }
          }
        } catch (audioError) {
          console.warn("NOVA screen audio mix unavailable:", audioError);
          toast("Экран показывается, но звук игры не удалось подключить.", true);
        }
      }
      setStatus(displayAudioTracks.length ? "Ты показываешь экран · звук зависит от источника" : "Ты показываешь экран");
      toast("Демонстрация экрана включена. Чтобы закончить, нажми ⏹.");
    } catch (e) {
      if (pickedStream && pickedStream !== displayStream) pickedStream.getTracks().forEach(track => track.stop());
      console.error("NOVA screen share error:", e);
      if (e?.name === "NotAllowedError" || e?.name === "AbortError") return;
      toast("Не удалось показать экран: " + (e?.message || "ошибка доступа"), true);
    }
  }

  async function stopScreenShare(notify = false) {
    const stream = displayStream;
    if (!stream) return;
    displayStream = null;
    const cameraTrack = localStream?.getVideoTracks().find(track => track.readyState === "live");
    const videoSender = peer?.getSenders().find(sender => sender.track?.kind === "video");
    try { if (cameraTrack && videoSender) await videoSender.replaceTrack(cameraTrack); } catch (e) { console.warn("NOVA restore camera:", e); }
    const micTrack = localStream?.getAudioTracks().find(track => track.readyState === "live");
    try { if (screenAudioSender && micTrack) await screenAudioSender.replaceTrack(micTrack); } catch (e) { console.warn("NOVA restore microphone:", e); }
    screenAudioSender = null;
    if (screenAudioContext) { try { await screenAudioContext.close(); } catch (_) {} screenAudioContext = null; }
    stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (localVideoElement) localVideoElement.srcObject = localStream;
    const button = callLayer()?.querySelector("#callScreenBtn");
    if (button) { button.textContent = "🖥️"; button.title = "Показать экран"; button.classList.remove("sharing"); }
    setStatus("Разговор идёт");
    if (notify) toast("Демонстрация экрана остановлена.");
  }

  function listenForCalls() {
    if (stopInbox) stopInbox();
    stopInbox = onValue(ref(db, "callInbox/" + uid()), async snap => {
      const entries = Object.values(snap.val() || {}).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      if (!entries.length || activeCallId || incomingCall) return;
      const candidate = entries[0];
      try {
        const callSnap = await get(ref(db, "calls/" + candidate.callId));
        if (!callSnap.exists() || callSnap.val().status !== "ringing") {
          await remove(ref(db, "callInbox/" + uid() + "/" + candidate.callId));
          return;
        }
        incomingCall = candidate;
        ensureLayer();
        activeCallType = candidate.callType === "video" ? "video" : "audio";
        showLayer(candidate.callerName, activeCallType === "video" ? "Входящий видеозвонок…" : "Входящий аудиозвонок…", true);
        if (stopIncomingCall) stopIncomingCall();
        stopIncomingCall = onValue(ref(db, "calls/" + candidate.callId), callSnap => {
          const call = callSnap.val();
          if ((!call || call.status !== "ringing") && incomingCall?.callId === candidate.callId && !activeCallId) {
            incomingCall = null;
            if (stopIncomingCall) stopIncomingCall();
            stopIncomingCall = null;
            hideLayer();
            remove(ref(db, "callInbox/" + uid() + "/" + candidate.callId)).catch(() => {});
          }
        });
        toast("Входящий звонок: " + (candidate.callerName || "пользователь"));
      } catch (e) { console.warn("NOVA incoming call:", e); }
    }, e => console.warn("NOVA call inbox listener:", e));
  }

  ensureLayer();
  listenForCalls();
  return { startAudioCall, startVideoCall, endCall, dispose() {
    if (stopInbox) stopInbox();
    if (stopIncomingCall) stopIncomingCall();
    stopIncomingCall = null;
    cleanupLocal();
    hideLayer();
  }};
}
