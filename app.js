// import { act } from "react";
import {
  deriveKeyFromPhrase,
  encryptText,
  decryptText,
  stringToBuffer,
  bufferToHex,
  hexToBuffer,
  generateEphemeralKeyPair,
  exportPublicKeySpki,
  bufferToBase64,
  base64ToBuffer,
  importPublicKeySpki,
  generateSharedSessionKey,
  wrapSymmetricKey,
  unwrapSymetricKey,
  compressString,
  decompressString,
  encryptBuffer,
  decryptBuffer,
  ratchetStep,
  miniSdp,
  expandSdp
} from "./cryptoUtils.js";

let chatSession = {
  sendChainKey: null,
  recvChainKey: null,
  ackKey: null,
  key: null,
  history: [],
};

let incomingFileMap = new Map();
const CHUNK_SIZE = 16384;
let localEphemeralKeyPair = null;
let remotePeerPublicKeyBase64 = null;
let remotePeerPublicKey = null;
let masterStorageKey = null;
let localTypingTimeout = null;
let isLocallyTyping = false;
let remoteTypingTimer = null;
let scannerStream = null;
let scannerAnimationId = null;
const messageInputEl = document.getElementById("messageInput");
const messageMap = new Map();
const staticSalt = getOrCreateSalt();
const splashWall = document.getElementById("splashWall");
const masterPhraseForm = document.getElementById("masterPhraseForm");
const masterPhraseInput = document.getElementById("masterPhraseInput");
const mainApp = document.getElementById("mainApp");
const chatLog = document.getElementById("chatLog");
const messageForm = document.getElementById("messageForm");
const lockBtn = document.getElementById("lockBtn");
const statusRing = document.getElementById("statusRing");
const statusText = document.getElementById("statusText");
let localMediaStream = null;
let isAudioMuted = false;
let isVideoMuted = false;
let mediaSenders = [];
const callOverlay = document.getElementById("callOverlay");
const localVideoEl = document.getElementById("localVideo");
const remoteVideoEl = document.getElementById("remoteVideo")
const initiateCallBtn = document.getElementById("initiateCallBtn");
const toggleAudioBtn = document.getElementById("toggleAudioBtn");
const toggleVideoBtn = document.getElementById("toggleVideoBtn");
const endCallBtn = document.getElementById("endCallBtn");
const EmojiList = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
let activePickerEl = null;
let replyContext = null;
const replyContextBar = document.getElementById("replyContextBar");
const replyPreviewText = document.getElementById("replyPreviewText");
const cancelReplyBtn = document.getElementById("cancelReplyBtn");
const genOfferBtn = document.getElementById("genOfferBtn");
const localSdpTextArea = document.getElementById("localSdpTextArea");
const remoteSdpTextArea = document.getElementById("remoteSdpTextArea");
const acceptRemoteBtn = document.getElementById("acceptRemoteBtn");
let peerConnection = null;
let dataChannel = null;
const voiceRecordBtn = document.getElementById("voiceRecordBtn");
let mediaRecordInstance = null;
let recordedAudioChunks = [];
const EDIT_WINDOW_MS = 5 * 60 * 1000;
let editingMsgId = null;
const historySearchInput = document.getElementById("historySearchInput");
const exportHistoryBtn = document.getElementById("exportHistoryBtn");
const DRAFT_KEY = "javault_msg_draft";
const PINNED_KEY = "javault_pinned_msgs";
let pinnedMessages = [];

function savePinnedMessages() {
  localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedMessages));
}

function loadPinnedMessages() {
  try {
    const stored = localStorage.getItem(PINNED_KEY);
    pinnedMessages = stored ? JSON.parse(stored) : [];
  } catch {
    pinnedMessages = [];
  }
}

function renderPinnedBar() {
  const pinnedBar = document.getElementById("pinnedBar");
  const pinnedList = document.getElementById("pinnedList");
  pinnedList.innerHTML = "";

  if(pinnedMessages.length === 0) {
    pinnedBar.classList.add("hidden");
    return;
  }

  pinnedBar.classList.remove("hidden");

  pinnedMessages.forEach(({msgId, text}) => {
    const entry = document.createElement("div");
    entry.className = "pinnedEntry";

    const label = document.createElement("span");
    label.className = "pinnedEntryText";
    label.textContent = text.length > 60 ? text.slice(0,60) + "..." : text;
    label.addEventListener("click", ()=> {
      const target = chatLog.querySelector(`[data-msg-id="${msgId}"]`);
      if(target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
        target.querySelector(".msgBubble").classList.add("isPinned");
      }
      else {
        showNotification("Message not found in current session.", "warning");
      }
    });
    const unpinBtn = document.createElement("button");
    unpinBtn.className = "unpinBtn";
    unpinBtn.textContent = "x";
    unpinBtn.title = "Unpin";
    unpinBtn.addEventListener("click", (e)=>{
      e.stopPropagation();
      unpinMessage(msgId);
    });
    entry.appendChild(label);
    entry.appendChild(unpinBtn);
    pinnedList.appendChild(entry);
  });
}

function pinMessage(msgId, text) {
  if(pinnedMessages.length >= 3) {
    showNotification("Maximum 3 messages can be pinned. Unpin anyone first.", "warning");
    return;
  }
  if(pinnedMessages.find(p => p.msgId === msgId)) {
    showNotification("Aleady Pinned.", "info");
    return;
  }

  pinnedMessages.push({
    msgId,
    text
  });
  savePinnedMessages();
  renderPinnedBar();

  const target = chatLog.querySelector(`[data-msg-id="${msgId}"]`);
  if(target) target.querySelector(".msgBubble").classList.add("isPinned");
  showNotification("Message Pinned.", "success");
}

function unpinMessage(msgId) {
  pinnedMessages = pinnedMessages.filter(p => p.msgId !== msgId);
  savePinnedMessages();
  renderPinnedBar();

  const target = chatLog.querySelector(`[data-msg-id="${msgId}"]`);
  if(target) target.querySelector(".msgBubble").classList.remove("isPinned");

  showNotification("Message Unpinned.", "info");
}

function showNotification(message, type="info") {
  const container = document.getElementById("alertContainer");
  if(!container) return;

  const alert = document.createElement("div");
  alert.className = `alertCard ${type}`;
  const textContainer = document.createElement("span");
  textContainer.textContent = message;
  alert.appendChild(textContainer);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "x";
  closeBtn.style.cssText = "background:none; border:none; color:inherit; font-size:1.25rem; cursor:pointer; margin-left: 1rem; opacity: 0.7;";
  closeBtn.onclick = () => dismissAlert(alert);
  alert.appendChild(closeBtn);

  container.appendChild(alert);
  setTimeout(()=> dismissAlert(alert), 4500);
}

function dismissAlert(alert) {
  if(alert.classList.contains("alertFadeOut")) return;
  alert.classList.add("alertFadeOut");
  alert.addEventListener("animationend", ()=> alert.remove());
}

function generateMsgId() {
  return crypto.randomUUID();
}

function getOrCreateSalt() {
  const stored = localStorage.getItem("javault_pbkdf2_salt");
  if(stored) {
    return hexToBuffer(stored);
  }
  const fresh = window.crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem("javault_pbkdf2_salt", bufferToHex(fresh));
  return fresh;
}

function renderMessage(
  text,
  direction = "outgoing",
  timeStr = "",
  isImage = false,
  imageDataUrl = "",
  msgId = null,
  replyTo = null,
  isAudio = false,
  audioDataUrl = "",
  timestampMs = null
) {
  if(!msgId) msgId = generateMsgId();
  const actualTimeStamp = timestampMs || Date.now();

  const rowEl = document.createElement("div");
  rowEl.classList.add("msgRow", direction);
  rowEl.dataset.msgId = msgId;
  rowEl.dataset.timestamp = actualTimeStamp;

  const actionsEl = document.createElement("div");
  actionsEl.className = "msgActions";
  const reactBtn = document.createElement("button");
  reactBtn.className = "msgActionBtn";
  reactBtn.textContent = "😊";
  reactBtn.title = "React";
  reactBtn.addEventListener("click", (e)=>{
    e.stopPropagation();
    showEmojiPicker(msgId, rowEl, direction);
  });

  const replyBtn = document.createElement("button");
  replyBtn.className = "msgActionBtn";
  replyBtn.textContent = "⬅️";
  replyBtn.title = "Reply";
  replyBtn.addEventListener("click", ()=>{
    setReplyContext(msgId, text);
  })

  const pinBtn = document.createElement("button");
  pinBtn.className = "msgActionBtn";
  pinBtn.textContent = "📌";
  pinBtn.title = "Pin";
  pinBtn.addEventListener("click", () => {
    pinMessage(msgId, text);
  });

  actionsEl.appendChild(reactBtn);
  actionsEl.appendChild(replyBtn);
  actionsEl.appendChild(pinBtn);

  if (direction === "outgoing" && !isAudio && !isImage) {
    const editBtn = document.createElement("button");
    editBtn.className = "msgActionBtn";
    editBtn.textContent = "✏️";
    editBtn.title = "Edit";
    editBtn.addEventListener("click", () => {
      const timeElasped = Date.now() - parseInt(rowEl.dataset.timestamp);
      if(timeElasped > EDIT_WINDOW_MS) {
        showNotification("Message can only be editted within 5 minutes of sending.", "warning");
        return;
      }
      enterEditMode(msgId, text);
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "msgActionBtn";
    deleteBtn.textContent = "🗑️";
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", ()=> {
      const timeElasped = Date.now() - parseInt(rowEl.dataset.timestamp);
      if(timeElasped > EDIT_WINDOW_MS) {
        showNotification("Message can only be deleted within 5 minutes of sending.", "warning");
        return;
      }
      if(confirm("Are you sure you want to delete this message?")) {
        executeLocalDeletion(msgId);
      }
    });
    actionsEl.appendChild(editBtn);
    actionsEl.appendChild(deleteBtn);
  }

  rowEl.appendChild(actionsEl);

  const bubbleEl = document.createElement("div");
  bubbleEl.classList.add("msgBubble");

  if(replyTo && replyTo.text) {
    const quoteEl = document.createElement("div");
    quoteEl.className = "replyQuote";
    quoteEl.textContent = replyTo.text.length > 80 ? replyTo.text.slice(0, 80) + "..." : replyTo.text;
    bubbleEl.appendChild(quoteEl);
  }

  if(isAudio && audioDataUrl) {
    const voiceContainer = document.createElement("div");
    voiceContainer.className = "voiceMessageContainer";
    const audioNode = document.createElement("audio");
    audioNode.src = audioDataUrl;
    audioNode.controls = true;
    audioNode.preload = "metadata";

    voiceContainer.appendChild(audioNode)
    bubbleEl.appendChild(voiceContainer);
  } else if (isImage && imageDataUrl) {
    const imageLink = document.createElement("a");
    imageLink.href = imageDataUrl;
    imageLink.download = text || "encryptedImage.png";
    const imageEl = document.createElement("img");
    imageEl.src = imageDataUrl;
    imageEl.alt = text || "Secure Image File";
    imageEl.className = "chatImage";
    imageLink.appendChild(imageEl);
    bubbleEl.appendChild(imageLink);
  } else {
    const contentContainer = document.createElement("div");
    contentContainer.className = "msgContentContainer";
    const textNode = document.createElement("span");
    textNode.textContent = text;
    contentContainer.appendChild(textNode);
    bubbleEl.appendChild(contentContainer);
  }
  if (!timeStr) {
    const now = new Date();
    timeStr = now.toLocaleString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const metaEl = document.createElement("span");
  metaEl.classList.add("msgMeta");
  metaEl.textContent = timeStr;
  let tickSpan = null;
  if (direction === "outgoing") {
    const tickWrapper = document.createElement("span");
    tickWrapper.className = "msgTicks";
    tickSpan = document.createElement("span");
    tickSpan.className = "tick";
    tickSpan.textContent = "✓"
    tickWrapper.appendChild(tickSpan);
    metaEl.appendChild(tickWrapper);
  }

  bubbleEl.appendChild(metaEl);

  const reactionBar = document.createElement("div");
  reactionBar.className = "reactionBar";
  bubbleEl.appendChild(reactionBar);

  rowEl.appendChild(bubbleEl);
  chatLog.appendChild(rowEl);
  chatLog.scrollTop = chatLog.scrollHeight;
  messageMap.set(msgId,
    {
      rowEl,
      reactionBar,
      contentContainer: bubbleEl.querySelector(".msgContentContainer") || bubbleEl,
      reactionsData: new Map(),
      text,
      tickEl: tickSpan,
    }
  );
  return { rowEl, msgId };
}

function showEmojiPicker(msgId, rowEl, direction) {
  closeEmojiPicker();
  const picker = document.createElement("div");
  picker.className = "emojiPicker";

  const bubbleEl = rowEl.querySelector(".msgBubble");

  picker.style.position = "absolute";
  if(direction === "outgoing") {
    picker.style.right = "0";
  }
  else {
    picker.style.left = "0";
  }

  const bubbleRect = bubbleEl.getBoundingClientRect();
  const chatLogRect = chatLog.getBoundingClientRect();
  const spaceAbove = bubbleRect.top - chatLogRect.top;

  if(spaceAbove < 60) {
    picker.style.top = "calc(100% + 6px)";
  }
  else {
    picker.style.bottom = "calc(100% + 6px)";
  }

  EmojiList.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.className = "emojiPickerBtn";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      sendReaction(msgId, emoji);
      closeEmojiPicker();
    });
    picker.appendChild(btn);
  });
  bubbleEl.appendChild(picker);
  activePickerEl = {
    el: picker,
    rowEl
  };

  setTimeout(() => {
    document.addEventListener("click", closeEmojiPicker, {once:true});
  }, 0);
}

function closeEmojiPicker() {
  if(activePickerEl) {
    activePickerEl.el.remove();
    activePickerEl = null;
  }
}

async function sendReaction(targetMsgId, emoji) {
  applyReaction(targetMsgId, emoji, "local");
  if(!dataChannel || dataChannel.readyState !== "open" || !chatSession.ackKey) return;

  const payload = {
    type: "REACTION",
    targetMsgId,
    emoji,
    timestamp: Date.now(),
  };

  try {
    const encrypted = await encryptText(JSON.stringify(payload), chatSession.ackKey);
    dataChannel.send(JSON.stringify({
      type: "REACTION",
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    }));
  } catch (error) {
    console.error("Failed to send reaction: ", error);
  }
}

function applyReaction(targetMsgId, emoji, source) {
  const entry = messageMap.get(targetMsgId);
  if(!entry) return;
  if(!entry.reactionsData.has(emoji)) {
    entry.reactionsData.set(emoji, new Set());
  }
  entry.reactionsData.get(emoji).add(source);
  entry.reactionBar.innerHTML = "";
  for (const [e, sources] of entry.reactionsData.entries()) {
    const chip = document.createElement("div");
    chip.className = "reactionChip" + (sources.has("local") ? " mine" : "");
    chip.innerHTML = `${e} <span class = "reactionCount">${sources.size}</span>`;
    entry.reactionBar.appendChild(chip);
  }
}

function updateMsgTick(msgId, status) {
  const entry = messageMap.get(msgId);
  if (!entry || !entry.tickEl) return;
  if (status === "delivered") {
    entry.tickEl.className = "tick delivered";
    entry.tickEl.textContent = "✓✓";
  }
  else if (status === "read") {
    entry.tickEl.className = "tick read";
    entry.tickEl.textContent = "✓✓";
  }
}

async function sendReadUpdate(msgId) {
  if(!dataChannel || dataChannel.readyState !== "open" || !chatSession.ackKey) return;

  try {
    const ack = {
      type: "MSG_ACK",
      status: "read",
      msgId
    };
    const encryptedAck = await encryptText(JSON.stringify(ack), chatSession.ackKey);
    dataChannel.send(JSON.stringify({
      type: "MSG_ACK",
      iv: encryptedAck.iv,
      ciphertext: encryptedAck.ciphertext,
    }));
  }
  catch (e) {
    console.warn("Failed to send read update: ", e);
  }
}

function setReplyContext(msgId, text) {
  replyContext = {msgId, text};
  replyPreviewText.textContent = text.length > 80 ? text.slice(0, 80) + "..." : text;
  replyContextBar.classList.add("active");
  messageInputEl.focus();
}

function clearReplyContext() {
  replyContext = null;
  replyContextBar.classList.remove("active");
  replyPreviewText.textContent = "";
}

function enterEditMode(msgId, text) {
  editingMsgId = msgId;
  messageInputEl.value = text;
  messageInputEl.focus();
  messageForm.querySelector('button[type="submit"]').textContent = "Confirm Edit";

  let cancelEditBtn = document.getElementById("cancelEditBtn");
  if (!cancelEditBtn) {
    cancelEditBtn = document.createElement("button");
    cancelEditBtn.id = "cancelEditBtn";
    cancelEditBtn.type = "button";
    cancelEditBtn.textContent = "Cancel Edit";
    cancelEditBtn.style.marginLeft = "4px";
    cancelEditBtn.addEventListener("click", exitEditMode);
    messageForm.appendChild(cancelEditBtn);
  }
}

function exitEditMode() {
  editingMsgId = null;
  messageInputEl.value = "";
  messageForm.querySelector('button[type="submit"]').textContent = "Send";
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  if(cancelEditBtn) cancelEditBtn.remove();
}

async function executeLocalUpdate(msgId, newText, isRemoteCall = false) {
  const item = messageMap.get(msgId);
  if(!item) return;

  item.text = newText;
  item.contentContainer.innerHTML = "";
  const newTextNode = document.createElement("span");
  newTextNode.textContent = newText;
  item.contentContainer.appendChild(newTextNode);

  const editedIndicator = document.createElement("small");
  editedIndicator.style.opacity = "0.5";
  editedIndicator.style.fontSize = "0.75rem";
  editedIndicator.style.marginLeft = "4px";
  editedIndicator.textContent = "(edited)";
  item.contentContainer.appendChild(editedIndicator);

  await modifyStorageRecord(msgId, (record) => {
    record.text = newText;
    record.isEdited = true;
    return record;
  });

  if(!isRemoteCall && dataChannel && dataChannel.readyState === "open" && chatSession.ackKey) {
    try {
      const payload = {
        type: "EDIT_MESSAGE",
        targetMsgId: msgId,
        newText
      };
      const encrypted = await encryptText(JSON.stringify(payload), chatSession.ackKey);
      dataChannel.send(JSON.stringify({
        type: "EDIT_MESSAGE",
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext
      }));
    } catch (e) {
      console.error("Failed sending message update message: ", e);
    }
  }
}

async function executeLocalDeletion(msgId,isRemoteCall=false) {
  const item = messageMap.get(msgId);
  if(!item) return;

  item.contentContainer.innerHTML = "";
  const deletionNode = document.createElement("span");
  deletionNode.style.fontStyle = "italic";
  deletionNode.style.opacity = "0.4";
  deletionNode.textContent = isRemoteCall ? "Peer Deleted this Message" : "You deleted this message";
  item.contentContainer.appendChild(deletionNode);

  const actionsContainer = item.rowEl.querySelector(".msgActions");
  if(actionsContainer) actionsContainer.remove();

  await modifyStorageRecord(msgId, (record)=>{
    record.text = "This Message Was Deleted!";
    record.isDeleted = true;
    return record;
  })

  if(!isRemoteCall && dataChannel && dataChannel.readyState === "open" && chatSession.ackKey) {
    try {
      const payload = {
        type: "DELETE_MESSAGE",
        targetMsgId: msgId
      };
      const encrypted = await encryptText(JSON.stringify(payload), chatSession.ackKey);
      dataChannel.send(JSON.stringify({
        type: "DELETE_MESSAGE",
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext
      }));
    } catch (error) {
      console.error("Failed sending message deletion message: ", error);
    } 
  }
}

async function modifyStorageRecord(msgId, updateCallBack) {
  try {
    const rawSavedHistory = JSON.parse(localStorage.getItem("javault_history") || "[]");
    const structuralArray = [];
    for (const msgPkg of rawSavedHistory) {
      try {
        const decryptedJSON = await decryptText(msgPkg.ciphertext, msgPkg.iv, masterStorageKey);
        let record = JSON.parse(decryptedJSON);

        if(record.msgId === msgId) {
          record = updateCallBack(record);
        }

        const encryptedPkg = await encryptText(JSON.stringify(record), masterStorageKey);
        structuralArray.push(encryptedPkg);
      } catch (error) {
        structuralArray.push(msgPkg)
      }
    }
    localStorage.setItem("javault_history", JSON.stringify(structuralArray));
  } catch (err) {
    console.error("Error writing update data to local storage: ", err);
  }
}

cancelReplyBtn.addEventListener("click", clearReplyContext);

function updateStatusUI(state) {
  statusRing.className = "statusRing";
  if (state === "idle") {
    statusRing.classList.add("statusIdle");
    statusText.textContent = "Disconnected :(";
  } else if (state === "connecting") {
    statusText.textContent = "Connecting ...";
    statusRing.classList.add("statusConnecting");
  } else if (state === "connected") {
    statusRing.classList.add("statusConnected");
    statusText.textContent = "Connected :)";
  }
}

masterPhraseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userMasterPhrase = masterPhraseInput.value.trim();
  if(!userMasterPhrase) return;

  if(userMasterPhrase.length < 8) {
    showNotification("The master phrase must be atleast 8 characters long.", "warning");
    return;
  }

  try {
    masterPhraseForm.querySelector('button[type="submit"]').disabled = true;
      masterStorageKey = await deriveKeyFromPhrase(
        userMasterPhrase,
        staticSalt,
      );
      splashWall.classList.add("hidden");
      mainApp.classList.remove("hidden");
      const savedDraft = localStorage.getItem(DRAFT_KEY);
      if(savedDraft) {
        messageInputEl.value = savedDraft;
        showNotification("Draft message restored.", "info");
      }
      loadPinnedMessages();
      renderPinnedBar();
      await loadAndDecryptHistory();
      showNotification("JaVaultScript Login Successful!", "success");
    } catch (error) {
      console.error(error);
      showNotification("Cryptographic Initialization Failed. Please refresh and try again", "error");
      masterStorageKey = null;
    }
    finally {
      masterPhraseForm.querySelector('button[type="submit"]').disabled = false;
    }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const plainText = messageInputEl.value.trim();
  if (!plainText) return;

  if(editingMsgId !== null) {
    await executeLocalUpdate(editingMsgId, plainText);
    exitEditMode();
    return;
  }

  const msgId = generateMsgId();
  const currentReply = replyContext ? {...replyContext} : null;
  clearReplyContext();

  try {
    const historyPayload = {
      msgId,
      text: plainText,
      direction: "outgoing",
      timestamp: Date.now(),
      replyTo: currentReply,
    };
    const encryptedPkg = await encryptText(
      JSON.stringify(historyPayload),
      masterStorageKey,
    );

    const savedHistory = JSON.parse(
      localStorage.getItem("javault_history") || "[]",
    );
    savedHistory.push(encryptedPkg);

    localStorage.setItem("javault_history", JSON.stringify(savedHistory));

    chatSession.history.push(plainText);
    renderMessage(plainText, "outgoing", "", false, "", msgId, currentReply);

    if (dataChannel && dataChannel.readyState === "open") {
      if (!chatSession.sendChainKey) {
        console.warn("Session Encryption Key not registered yet.");
        return;
      }
      const {nextChainKeyBuffer, msgKey} = await ratchetStep(chatSession.sendChainKey);
      chatSession.sendChainKey = nextChainKeyBuffer;
      // const encryptedWirePkg = await encryptText(plainText, chatSession.key);

      const wirePayLoad = {
        type: "TEXT_MESSAGE",
        msgId,
        plainText,
        replyTo: currentReply,
        timestamp: Date.now(),
        sender: "peer_node",
      };
      const encrypted = await encryptText(JSON.stringify(wirePayLoad), msgKey);
      dataChannel.send(JSON.stringify({
        type: "TEXT_MESSAGE",
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        timestamp: Date.now(),
      }));
    } else {
      console.warn("Data Channel isn't open");
    }

    messageInputEl.value = "";
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    console.error("Encryption Crash: ", e);
  }
});

async function loadAndDecryptHistory() {
  chatLog.innerHTML = "";
  messageMap.clear();
  const savedHistory = JSON.parse(
    localStorage.getItem("javault_history") || "[]",
  );

  for (const msgPkg of savedHistory) {
    try {
      const decryptedJSON = await decryptText(
        msgPkg.ciphertext,
        msgPkg.iv,
        masterStorageKey,
      );

      const record = JSON.parse(decryptedJSON);

      let displayTime = "";

      if (record.timestamp) {
        displayTime = new Date(record.timestamp).toLocaleString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      }

      chatSession.history.push(record.text);
      renderMessage(
        record.isDeleted ? "The Message was Deleted" : record.text,
        record.direction || "outgoing",
        displayTime,
        record.isImage || false,
        record.fileData || "",
        record.msgId || null,
        record.replyTo || null,
        record.isAudio || false,
        record.fileData || "",
        record.timestamp || null
      );

      if(record.msgId && (record.isEdited || record.isDeleted)) {
        const item = messageMap.get(record.msgId);
        if(item) {
          if(record.isDeleted) {
            item.contentContainer.innerHTML = `<span style="font-style: italic; opacity: 0.4;">${record.direction === "outgoing" ? "You Deleted this message." : "Peer deleted this message"}</span>`;
            const act = item.rowEl.querySelector(".msgActions");
            if(act) act.remove();
          }
          else if(record.isEdited) {
            const ind = document.createElement("small");
            ind.style.opacity = "0.5";
            ind.style.fontSize = "0.75rem";
            ind.style.marginLeft = "4px";
            ind.textContent = "(edited)";
            item.contentContainer.appendChild(ind);
          }
        }
      }
    } catch (error) {
      console.error("Decryption Failed", error);
    }
  }
}

historySearchInput.addEventListener("input", (e) => {
  const query = e.target.value.toLowerCase().trim();
  messageMap.forEach((entry) => {
    if(!query) {
      entry.rowEl.style.display = "";
      return;
    }

    if (entry.text && entry.text.toLowerCase().includes(query)) {
      entry.rowEl.style.display = "";
    }
    else {
      entry.rowEl.style.display = "none";
    }
  });
});

exportHistoryBtn.addEventListener("click", async () => {
  if(!masterStorageKey) {
    alert("SessionKey not Available. Cannot Export.");
    return;
  }

  const savedHistory = JSON.parse(localStorage.getItem("javault_history") || "[]");
  if(savedHistory.length === 0) {
    alert("No history present");
    return;
  }

  const decryptedRecords = [];

  for(const msgPkg of savedHistory) {
    try {
      const decryptedJSON = await decryptText(
        msgPkg.ciphertext,
        msgPkg.iv,
        masterStorageKey
      );
      decryptedRecords.push(JSON.parse(decryptedJSON));
    } catch (error) {
      console.error("Export Decryption failed: ", error);
    }
  }

  if(decryptedRecords.length === 0) {
    alert("No History Messages could be successfully decrypted :(");
    return;
  }

  try {
    const rawExportString = JSON.stringify(decryptedRecords, null, 2);
    const encryptedExportPkg = await encryptText(rawExportString, masterStorageKey);

    const backUpContainer = {
      vaultExport: true,
      timestamp: Date.now(),
      payload: encryptedExportPkg
    };

    const blob = new Blob([JSON.stringify(backUpContainer, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);

    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = url;
    downloadAnchor.download = `javault_secure_backup_${Date.now()}.json`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();

    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Export Generation Error: ", error);
    alert("Failed to encrypt export package");
  }
});

lockBtn.addEventListener("click", () => {
  masterStorageKey = null;
  chatSession.key = null;
  chatSession.ackKey = null;
  chatSession.sendChainKey = null;
  chatSession.recvChainKey = null;
  chatSession.history = [];
  chatLog.innerHTML = ""

  if(historySearchInput) historySearchInput.value = "";

  if (peerConnection) {
    localStorage.removeItem(DRAFT_KEY);
    pinnedMessages = [];
    renderPinnedBar();
    peerConnection.close();
    peerConnection = null;
  }

  dataChannel = null;

  mainApp.classList.add("hidden");
  splashWall.classList.remove("hidden");
});

function initializePeerConnection() {
  console.log("Initializing Peer Connection!");

  const configuration = {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
    ],
  };

  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("ICE Route Found", event.candidate.candidate);
    } else {
      localSdpTextArea.value = btoa(
        JSON.stringify(peerConnection.localDescription),
      );
      updateLocalQrCode(peerConnection.localDescription);
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(
      `WebRTC Connection Status Update: ${peerConnection.connectionState}`,
    );
    if (peerConnection.connectionState === "connected") {
      updateStatusUI("connected");
      initiateCallBtn.classList.remove("hidden");
    } else {
      updateStatusUI("idle");
      initiateCallBtn.classList.add("hidden");
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(
      `WebRTC ICE Connection Update: ${peerConnection.iceConnectionState}`,
    );
  };

  peerConnection.ondatachannel = (event) => {
    console.log("WebRTC Data Channel Captured!");
    dataChannel = event.channel;
    setupDataChannelListeners(dataChannel);
  };

  peerConnection.ontrack = (event) => {
    console.log("Hardware Media Track Intercepted!")
    if(event.streams && event.streams[0]) {
      remoteVideoEl.srcObject = event.streams[0];
      callOverlay.classList.remove("hidden");
    }
  }
}

function setupDataChannelListeners(channel) {
  channel.onopen = async () => {
    console.log("Data Channel Link Stauts: Open");
    updateStatusUI("connected");

    await executeAutomatedKeyExchange();
  };
  channel.onclose = () => {
    console.log("Data Channel Link Status: Close");
    updateStatusUI("idle");
  };
  channel.onerror = (error) => {
    console.error("Data Channel Communication Fault", error);
    // updateStatusUI("idle");
  };
  channel.onmessage = (event) => {
    console.log("Encrypted Data Recieved over Data Channel", event.data);
    handleIncomingMsg(event.data);
  };
}

async function generateLocalConnectionOffer() {
  if (!peerConnection) {
    initializePeerConnection();
  }

  if(!dataChannel || dataChannel.readyState === "closed") {
  dataChannel = peerConnection.createDataChannel("chatChannel");
  setupDataChannelListeners(dataChannel);
  }
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
  } catch (error) {
    console.error(
      "Failed to construct local connection configuration profile :(",
    );
    alert("Strucutre Initialization Failure.");
  }
}

async function acceptRemotePeerConnection() {
  const rawInputText = remoteSdpTextArea.value.trim();
  if (!rawInputText) {
    showNotification("Please provide a valid remote SDP Session Profile", "warning");
    return;
  }

  try {
    let remoteDescriptionObject;
    try {
      remoteDescriptionObject = JSON.parse(atob(rawInputText));
    } catch (error) {
      throw new Error("The signature code format is corrupted/malformed.");
    }

    if (!peerConnection) {
      initializePeerConnection();
    }

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(remoteDescriptionObject),
    );

    if (remoteDescriptionObject.type === "offer") {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      showNotification("Remote Connection Offer Configured. Share your local response code.", "success");
    } else if (remoteDescriptionObject.type === "answer") {
      showNotification("Remote answer cofigured. Establishing Pathway", "success");
    }
  } catch (error) {
    console.error("Failed to Parse SDP Code.");
    showNotification(`Link Parsing Error: ${error.message}`, "error");
    
    if(peerConnection) {
      peerConnection.close();
      peerConnection = null;
  }
  updateStatusUI("idle");
  }
}

async function executeAutomatedKeyExchange() {
  try {
    localEphemeralKeyPair = await generateEphemeralKeyPair();
    console.log("Ephemeral keypair initialized");

    const rawSpkiBuffer = await exportPublicKeySpki(
      localEphemeralKeyPair.publicKey,
    );
    const base64PublicKey = bufferToBase64(rawSpkiBuffer);

    const exchangePayLoad = {
      type: "KEY_EXCHANGE_PUBLIC_KEY",
      publicKeyStr: base64PublicKey,
    };

    dataChannel.send(JSON.stringify(exchangePayLoad));
  } catch (error) {
    console.error("Error during key config exchange: ", error);
  }
}

function showIncomingCallPrompt(remoteSdp) {
  const existing = document.getElementById("incomingCallPrompt");
  if(existing) existing.remove();

  const prompt = document.createElement("div");
  prompt.id = "incomingCallPrompt";
  prompt.className = "incomingCallPrompt";
  prompt.innerHTML = `
    <div class="incomingCallCard">
  <div class="callRingIcon">📞</div>
  <p class="callRingText">Incoming Video Call</p>
  <div class="callPromptBtns">
    <button id="acceptCallBtn" class="acceptCallBtn">Accept</button>
    <button id="rejectCallBtn" class="rejectCallBtn">Decline</button>
  </div>
</div>
  `;

  document.body.appendChild(prompt);

  document.getElementById("rejectCallBtn").addEventListener("click", ()=> {
    prompt.remove();
    sendCallTerminationMsg();
  });
  document.getElementById("acceptCallBtn").addEventListener("click", async ()=> {
    prompt.remove();
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteSdp));
      localMediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });
      localVideoEl.srcObject = localMediaStream;
      localMediaStream.getTracks().forEach(track => peerConnection.addTrack(track, localMediaStream));
      const ansDesc = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(ansDesc);

      await transmitCallSignal({
        subtype: "MEDIA_ANSWER",
        sdp: {
          type: peerConnection.localDescription.type,
          sdp: peerConnection.localDescription.sdp,
        }
      });
      callOverlay.classList.remove("hidden");
    } catch (error) {
      console.err("Failed to accept call: ", error);
      showNotification("Could not access Camera/Microphone", "error");
      sendCallTerminationMsg();
    }
  })
}

async function handleIncomingMsg(rawWireData) {
  try {
    const parsedFrame = JSON.parse(rawWireData);

    if(parsedFrame && (parsedFrame.type === "EDIT_MESSAGE" || parsedFrame.type === "DELETE_MESSAGE") && chatSession.ackKey) {
      try {
        const decrypted = await decryptText(parsedFrame.ciphertext, parsedFrame.iv, chatSession.ackKey);
        const actionData = JSON.parse(decrypted);

        if(parsedFrame.type === "EDIT_MESSAGE") {
          await executeLocalUpdate(actionData.targetMsgId, actionData.newText, true);
        }
        else if (parsedFrame.type === "DELETE_MESSAGE") {
          await executeLocalDeletion(actionData.targetMsgId, true);
        }
      } catch (error) {
        console.error("Failed handling incoming system frame update details: ", error);
      }
      return;
    }

    if (parsedFrame && parsedFrame.type === "TYPING_SIGNAL" && chatSession.ackKey) {
      try {
        const decrypted = await decryptText(parsedFrame.ciphertext, parsedFrame.iv, chatSession.ackKey);
        const signal = JSON.parse(decrypted);
        if(signal.status === "typing"){
          showTypingIndicator();
        }
        else {
          hideTypingIndicator();
        }
      } catch (error) {
        console.warn("Failed to decrypt typing signal: ", error)
      }
      return;
    }

    if (parsedFrame && parsedFrame.type === "KEY_EXCHANGE_PUBLIC_KEY") {
      console.log("Intercepted public key");
      remotePeerPublicKeyBase64 = parsedFrame.publicKeyStr;
      console.log("Extracted remote peer Base64 public key");
      const remotePublicKeyBuffer = base64ToBuffer(remotePeerPublicKeyBase64);
      remotePeerPublicKey = await importPublicKeySpki(remotePublicKeyBuffer);

      console.log("Remote Public Key Imported!");

      const ifOfferer =
        peerConnection &&
        peerConnection.localDescription &&
        peerConnection.localDescription.type === "offer";

      if (ifOfferer) {
        console.log("Offerer role detected.");

        const freshSessionKey = await generateSharedSessionKey();
        chatSession.ackKey = freshSessionKey;
        const rawKeyBits = new Uint8Array(await window.crypto.subtle.exportKey("raw", freshSessionKey));
        chatSession.sendChainKey = rawKeyBits.buffer;
        const recvSeed = rawKeyBits.map((b,i) => b ^ 0xA5);
        chatSession.recvChainKey = recvSeed.buffer;

        const wrappedKeyBuffer = await wrapSymmetricKey(
          freshSessionKey,
          remotePeerPublicKey,
        );
        const wrappedKeyBase64 = bufferToBase64(wrappedKeyBuffer);

        const wirePayload = {
          type: "KEY_EXCHANGE_SESSION_KEY",
          wrappedKeyStr: wrappedKeyBase64,
        };

        dataChannel.send(JSON.stringify(wirePayload));
        // chatSession.key = freshSessionKey;
        console.log("Session key gen, wrap and transmitted");
      }
      return;
    }

    if (parsedFrame && parsedFrame.type === "KEY_EXCHANGE_SESSION_KEY") {
      console.log("Intercepted wrapped session key");
      if (!localEphemeralKeyPair || !localEphemeralKeyPair.privateKey) {
        console.log("Local private key missing");
        return;
      }

      const wrappedBuffer = base64ToBuffer(parsedFrame.wrappedKeyStr);

      const unwrappedSessionKey = await unwrapSymetricKey(
        wrappedBuffer,
        localEphemeralKeyPair.privateKey,
      );

      chatSession.ackKey = unwrappedSessionKey;

      const rawKeyBits = new Uint8Array(await window.crypto.subtle.exportKey("raw", unwrappedSessionKey));
      const recvSeed = rawKeyBits.map((b, i) => b ^ 0xA5);
      chatSession.sendChainKey = recvSeed.buffer;
      chatSession.recvChainKey = rawKeyBits.buffer;

      console.log("Symetric session key decrypted and extracted");
      return;
    }

    if (parsedFrame && parsedFrame.type === "TEXT_MESSAGE") {
      hideTypingIndicator();
      if (!chatSession.recvChainKey) {
        renderMessage(
          "Error: Cannot Decrypt Message. Local Session Locked",
          "incoming"
        );
        return;
      }

      const {nextChainKeyBuffer, msgKey} = await ratchetStep(chatSession.recvChainKey);
      chatSession.recvChainKey = nextChainKeyBuffer;

      const decryptedJSON = await decryptText(
        parsedFrame.ciphertext,
        parsedFrame.iv,
        msgKey,
      );

      const wirePayLoad = JSON.parse(decryptedJSON);
      const {msgId, plainText, replyTo, timestamp} = wirePayLoad;

      try {
        const historyPayload = {
          msgId,
          text: plainText,
          direction: "incoming",
          timestamp: timestamp || Date.now(),
          replyTo: replyTo || null,
        };
        const encryptedPkg = await encryptText(
          JSON.stringify(historyPayload),
          masterStorageKey,
        );
        const savedHistory = JSON.parse(
          localStorage.getItem("javault_history") || "[]",
        );
        savedHistory.push(encryptedPkg);
        localStorage.setItem("javault_history", JSON.stringify(savedHistory));
      } catch (storageError) {
        console.error("Failed to fetch and store incoming msg: ", storageError);
      }

      let displayTime = "";
      if (parsedFrame.timestamp) {
        const date = new Date(parsedFrame.timestamp);
        displayTime = date.toLocaleDateString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      const {rowEl} = renderMessage(plainText, "incoming", displayTime, false, "", msgId, replyTo || null);

      if(dataChannel && dataChannel.readyState === "open" && chatSession.ackKey) {
        try {
          const isFocused = document.hasFocus();
          const statusState = isFocused ? "read" : "delivered";

          if(isFocused) {
            rowEl.dataset.readAcknowledged = "true";
          }

          const ack = {
            type: "MSG_ACK",
            status: statusState,
            msgId
          };
          const encryptedAck = await encryptText(JSON.stringify(ack), chatSession.ackKey);
          dataChannel.send(JSON.stringify({
            type: "MSG_ACK",
            iv: encryptedAck.iv,
            ciphertext: encryptedAck.ciphertext,
          }));
        } catch (e) {
          console.warn("Failed to send ack: ", e);
        }
      }
    }

    if(parsedFrame && parsedFrame.type === "MSG_ACK") {
      if (!chatSession.ackKey) return;
      try {
        const decryptedJSON = await decryptText(
          parsedFrame.ciphertext,
          parsedFrame.iv,
          chatSession.ackKey,
        );
        const {msgId, status} = JSON.parse(decryptedJSON);
        updateMsgTick(msgId, status);
      } catch (e) {
        console.error("Failed to decrypt ACK: ", e)
      }
      return;
    }

    if(parsedFrame && parsedFrame.type === "READ_RECEIPT") {
      const trackedMsg = messageMap.get(parsedFrame.msgId);
      if (trackedMsg && trackedMsg.tickEl) {
        trackedMsg.tickEl.textContent = "✓✓";
        trackedMsg.tickEl.classList.remove("delivered");
        trackedMsg.tickEl.classList.add("read");
      }
      return;
    }

    if (parsedFrame && parsedFrame.type === "REACTION") {
      if(!chatSession.ackKey) return;
      try {
        const decryptedJSON = await decryptText(
          parsedFrame.ciphertext,
          parsedFrame.iv,
          chatSession.ackKey,
        );
        const {targetMsgId, emoji} = JSON.parse(decryptedJSON);
        applyReaction(targetMsgId, emoji, "remote");
      } catch (error) {
        console.error("Failed to decrypt reaction: ", error);
      }
      return;
    }

    if (parsedFrame && parsedFrame.type === "FILE_START") {
      incomingFileMap.set(parsedFrame.fileId, {
        name: parsedFrame.name,
        mimeType: parsedFrame.mimeType,
        totalChunks: parsedFrame.totalChunks,
        fileMsgId: parsedFrame.fileMsgId || null,
        receivedCount: 0,
        chunks: new Array(parsedFrame.totalChunks),
      });

      renderMessage(
        `Receiving encrypted file: ${parsedFrame.name}`,
        "incoming",
        "",
      );
      return;
    }

    if (parsedFrame && parsedFrame.type === "FILE_CHUNK") {
      const fileContext = incomingFileMap.get(parsedFrame.fileId);
      if (!fileContext || !chatSession.recvChainKey) return;

      try {

        const {nextChainKeyBuffer, msgKey} = await ratchetStep(chatSession.recvChainKey);
        chatSession.recvChainKey = nextChainKeyBuffer;

        const decryptedBuffer = await decryptBuffer(
          parsedFrame.ciphertext,
          parsedFrame.iv,
          msgKey,
        );

        fileContext.chunks[parsedFrame.chunkIndex] = decryptedBuffer;
        fileContext.receivedCount++;
      } catch (decErr) {
        console.error("Failed chunk decryption", decErr);
      }
      return;
    }

    if (parsedFrame && parsedFrame.type === "FILE_END") {
      const fileContext = incomingFileMap.get(parsedFrame.fileId);
      if (!fileContext) return;

      if(fileContext.receivedCount !== fileContext.totalChunks) {
        console.error(`${fileContext.name} incomplete!`);
        renderMessage(`File Transfer Incomplete: ${fileContext.name}`, "incoming", "");
        if(fileContext.fileMsgId && dataChannel && dataChannel.readyState === "open" && chatSession.ackKey) {
          try {
            const ack = {
              type: "MSG_ACK",
              status: document.hasFocus() ? "read" : "delivered",
              msgId: fileContext.fileMsgId
            };
            const encryptedAck = await encryptText(JSON.stringify(ack), chatSession.ackKey);
            dataChannel.send(JSON.stringify({
              type: "MSG_ACK",
              iv: encryptedAck.iv,
              ciphertext: encryptedAck.ciphertext
            }));
          } catch (e) {
            console.warn("File ACK failed: ", e);
          }
        }
        incomingFileMap.delete(parsedFrame.fileId);
        return;
      }

      // const orderedChunks = fileContext.chunks.filter(Boolean);

      const combinedBlob = new Blob(fileContext.chunks, {
        type: fileContext.mimeType,
      });
      const dataUrl = URL.createObjectURL(combinedBlob);
      

      if(fileContext.mimeType === "audio/wav;secure=true")
      {
        renderMessage("Voice Message Recieved", "incoming", "", false, "", null, null, true, dataUrl)
      }
      else if (fileContext.mimeType && fileContext.mimeType.startsWith("image/")) {
        const base64Reader = new FileReader();
        base64Reader.onloadend = async () => {
          const base64DataUrl = base64Reader.result;

          renderMessage(fileContext.name, "incoming", "", true, base64DataUrl);

          try {
            const historyPayload = {
              text: fileContext.name,
              direction: "incoming",
              timestamp: Date.now(),
              isImage: true,
              fileData: base64DataUrl,
            };

            const encryptedPkg = await encryptText(
              JSON.stringify(historyPayload),
              masterStorageKey,
            );
            const savedHistory = JSON.parse(
              localStorage.getItem("javault_history") || "[]",
            );
            savedHistory.push(encryptedPkg);
            localStorage.setItem(
              "javault_history",
              JSON.stringify(savedHistory),
            );
          } catch (error) {
            console.error("Failed to store incoming image:", error);
          }
        };
        base64Reader.readAsDataURL(combinedBlob);
      } else {
        const downloadUrl = URL.createObjectURL(combinedBlob);
        const { rowEl: fileRowEl } = renderMessage(
          `Download File: ${fileContext.name}`,
          "incoming",
          "",
        );

        const bubbleEl = fileRowEl.querySelector(".msgBubble");
        const textSpan = bubbleEl.querySelector("span");
        if(textSpan) textSpan.remove();

        const downloadLink = document.createElement("a");
        downloadLink.href = downloadUrl;
        downloadLink.download = fileContext.name;
        downloadLink.textContent = `Download File: ${fileContext.name}`;
        downloadLink.style.color = "#34d399";
        downloadLink.style.fontWeight = "bold";
        downloadLink.style.textDecoration = "underline";

        downloadLink.addEventListener("click", () => {
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000)
        });
        bubbleEl.insertBefore(downloadLink, bubbleEl.querySelector(".msgMeta"));
      }

      if(fileContext.fileMsgId && dataChannel && dataChannel.readyState === "open" && chatSession.ackKey) {
        try {
          const ack = {
            type: "MSG_ACK",
            status: document.hasFocus() ? "read" : "delivered",
            msgId: fileContext.fileMsgId
          };
          const encryptedAck = await encryptText(JSON.stringify(ack), chatSession.ackKey);
          dataChannel.send(JSON.stringify({
            type: "MSG_ACK",
            iv: encryptedAck.iv,
            ciphertext: encryptedAck.ciphertext
          }));
        } catch (error) {
          console.warn("File ack failed: ", error);
        }
      }
      incomingFileMap.delete(parsedFrame.fileId);
      return;
    }

    if(parsedFrame && parsedFrame.type === "CALL_SIGNAL") {
      if(!chatSession.ackKey) return;

      const decryptedSignalJson = await decryptText(parsedFrame.ciphertext, parsedFrame.iv, chatSession.ackKey);
      const signalData = JSON.parse(decryptedSignalJson);

      if(signalData.subtype === "MEDIA_OFFER") {
        console.log("Processing inbound Call Request!");
        showIncomingCallPrompt(signalData.sdp);
      }

      else if(signalData.subtype === "MEDIA_ANSWER") {
        console.log("Remote Peer Accepted Calling Session");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        if(localMediaStream) {
          callOverlay.classList.remove("hidden");
        }
      }
      else if (signalData.subtype === "MEDIA_HANGUP") {
        console.log("Remote Media Session Terminated");
        shutDownActiveMediaTracks();
      }
      return;
    }
  } catch (e) {
    console.error("Error parsing incoming message", e);
  }
}

async function transferEncryptedFile(file) {
  if (!dataChannel || dataChannel.readyState !== "open" || !chatSession.ackKey) {
    alert("Cannot send file: Connection Inactive");
    return;
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  if (file.size > MAX_FILE_SIZE) {
    alert(`File Rejected: ${file.name} exceeds maxmimum allowed size of 10MB`);
    return;
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = crypto.randomUUID();
  const fileMsgId = generateMsgId();

  dataChannel.send(
    JSON.stringify({
      type: "FILE_START",
      fileId: fileId,
      fileMsgId: fileMsgId,
      name: file.name,
      mimeType: file.type,
      totalChunks: totalChunks,
    }),
  );

  const sendingStatus = renderMessage(
    `Sending File: ${file.name}`,
    "outgoing",
    "",
  )
  const sendingStatusEl = sendingStatus.rowEl;

  const reader = new FileReader();
  let offset = 0;
  let chunkIndex = 0;

  const readNextChunk = () => {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    reader.readAsArrayBuffer(slice);
  };

  reader.onload = async (e) => {
    const rawBuffer = e.target.result;
    try {

      if(!chatSession.sendChainKey) throw new Error("Ratchet Uninitalized");

      const {nextChainKeyBuffer, msgKey} = await ratchetStep(chatSession.sendChainKey);
      chatSession.sendChainKey = nextChainKeyBuffer;

      const encryptedPkg = await encryptBuffer(rawBuffer, msgKey);
      dataChannel.send(
        JSON.stringify({
          type: "FILE_CHUNK",
          fileId: fileId,
          chunkIndex: chunkIndex,
          iv: encryptedPkg.iv,
          ciphertext: encryptedPkg.ciphertext,
        }),
      );

      chunkIndex++;
      offset += CHUNK_SIZE;

      if (offset < file.size) {
        readNextChunk();
      } else {
        dataChannel.send(
          JSON.stringify({
            type: "FILE_END",
            fileId: fileId,
          }),
        );

        if (sendingStatusEl && sendingStatusEl.parentNode) {
          sendingStatusEl.parentNode.removeChild(sendingStatusEl);
        }

        if (file.type && file.type.startsWith("image/")) {
          const base64Reader = new FileReader();
          base64Reader.onloadend = async () => {
            const base64DataUrl = base64Reader.result;
            // const fileMsgId = generateMsgId();
            renderMessage(file.name, "outgoing", "", true, base64DataUrl, fileMsgId);
            try {
              const historyPayload = {
                text: file.name,
                direction: "outgoing",
                timestamp: Date.now(),
                isImage: true,
                fileData: base64DataUrl,
              };
              const encryptedPkg = await encryptText(
                JSON.stringify(historyPayload),
                masterStorageKey,
              );
              const savedHistory = JSON.parse(
                localStorage.getItem("javault_history") || "[]",
              );
              savedHistory.push(encryptedPkg);
              localStorage.setItem(
                "javault_history",
                JSON.stringify(savedHistory),
              );
            } catch (error) {
              console.error("Local History Saving Failed: ", error);
            }
          };
          base64Reader.readAsDataURL(file);
        } else {
          // const fileMsgId = generateMsgId();
          renderMessage(`Successfully Sent: ${file.name}`, "outgoing", "", false, "", fileMsgId);
        }
      }
    } catch (error) {
      console.error("File Chunk Encryption or transmission fault: ", error);
    }
  };
  readNextChunk();
}

function showTypingIndicator() {
  let indicator = document.getElementById("typingIndicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "typingIndicator";
    indicator.className = "msgRow incoming";

    const bubbleEl = document.createElement("div");
    bubbleEl.className = "msgBubble typingBubble";
    bubbleEl.innerHTML = `
        <div class="typingDots">
            <span></span><span></span><span></span>
        </div>
        <span class="typingText">Peer is typing...</span>
    `;

    indicator.appendChild(bubbleEl);
    chatLog.appendChild(indicator);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  clearTimeout(remoteTypingTimer);
  remoteTypingTimer = setTimeout(() => {
    hideTypingIndicator();
  }, 3500);
}

function hideTypingIndicator() {
  const indicator = document.getElementById("typingIndicator");
  if (indicator) {
    indicator.remove();
  }
}

messageInputEl.addEventListener("input", async () => {
  if (dataChannel && dataChannel.readyState === "open" && chatSession.ackKey) {
    if (!isLocallyTyping) {
      isLocallyTyping = true;
      try {
        const encrypted = await encryptText(
          JSON.stringify({status: "typing"}),
          chatSession.ackKey
        );
        dataChannel.send(JSON.stringify({type: "TYPING_SIGNAL", iv: encrypted.iv, ciphertext: encrypted.ciphertext}));

      } catch (error) {
        console.warn("Failed sending typing signal: ", error);
      }
    }

    clearTimeout(localTypingTimeout);
    localTypingTimeout = setTimeout(async () => {
      isLocallyTyping = false;
      try {
        const encrypted = await encryptText(
          JSON.stringify({status: "idle"}),
          chatSession.ackKey
        );
        dataChannel.send(JSON.stringify({type: "TYPING_SIGNAL", iv: encrypted.iv, ciphertext: encrypted.ciphertext}));
      } catch (error) {
        console.warn("Failed to send idle signal", error);}
    }, 3000);
  }
});

async function updateLocalQrCode(localDesc) {
  try {

    if(!localDesc || !localDesc.sdp) return ;
    const minified = miniSdp(localDesc.sdp);
    const payLoadToCompress = `${localDesc.type}|${minified}`;
    const compressedPayLoad = await compressString(payLoadToCompress);

    new QRious({
      element: document.getElementById("localQrCanvas"),
      value: compressedPayLoad,
      size: 250,
      level: "L",
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

function startQrScanner() {
  const video = document.getElementById("scannerVideo");
  const modal = document.getElementById("qrScanner");
  modal.classList.remove("hidden");

  navigator.mediaDevices
    .getUserMedia({
      video: {
        facingMode: "environment",
      },
    })
    .then((stream) => {
      scannerStream = stream;
      video.srcObject = stream;
      video.setAttribute("playsinline", true);
      video.play();
      scannerAnimationId = requestAnimationFrame(tickScanner);
    })
    .catch((err) => {
      console.error("Webcam Launch Error: ", err);
      alert("Unable to lauch video scanner. Check permissions.");
      hideQrScanner();
    });
}

function tickScanner() {
  const video = document.getElementById("scannerVideo");
  if (video.readyState === video.HAVE_CURRENT_DATA) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });

    if (code && code.data) {
      handleScannedData(code.data);
      return;
    }
  }
  scannerAnimationId = requestAnimationFrame(tickScanner);
}

async function handleScannedData(compressedData) {
  try {

    const decompressed = await decompressString(compressedData);
    const separatorIndex = decompressed.indexOf('|');
    if (separatorIndex === -1) throw new Error("Invalid scanned QR Layout");

    const type = decompressed.substring(0, separatorIndex);
    const minifiedSdp = decompressed.substring(separatorIndex + 1);
    const structuralSdp = expandSdp(minifiedSdp);
    const remoteDescriptionObject = {
      type: type,
      sdp: structuralSdp
    };

    remoteSdpTextArea.value = btoa(JSON.stringify(remoteDescriptionObject));
    hideQrScanner();
    acceptRemoteBtn.click();
  } catch (error) {
    console.error("Decompression failed: ", error);
    alert("Corrypted Configuration Code");
    hideQrScanner();
  }
}

function hideQrScanner() {
  document.getElementById("qrScanner").classList.add("hidden");
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }

  if (scannerAnimationId) {
    cancelAnimationFrame(scannerAnimationId);
    scannerAnimationId = null;
  }
}

async function transmitCallSignal(payLoadData) {
  if (dataChannel && dataChannel.readyState === "open" && chatSession.ackKey) {
    const encryptedWirePkg = await encryptText(JSON.stringify(payLoadData), chatSession.ackKey);
    const wirePayLoad = {
      type: "CALL_SIGNAL",
      iv: encryptedWirePkg.iv,
      ciphertext: encryptedWirePkg.ciphertext,
      timestamp: Date.now()
    };
    dataChannel.send(JSON.stringify(wirePayLoad));
  }
}

async function startPeerVoiceVideoCall() {
  if(!peerConnection || peerConnection.connectionState !== "connected") {
    showNotification("Cannot Call! No Active Peer Connection", "warning");
    return;
  }
  if(!dataChannel || dataChannel.readyState !== "open" || !chatSession.ackKey) {
    showNotification("Cannot Call! Secure Channel not initialized Yet.", "warning");
  }
  try {
    console.log("Accessing media hardware ");
    localMediaStream = await navigator.mediaDevices.getUserMedia({
      audio:true,
      video:true
    });
    mediaSenders = [];
    localVideoEl.srcObject = localMediaStream;
    // callOverlay.classList.remove("hidden");

    localMediaStream.getTracks().forEach(track => {
      const sender = peerConnection.addTrack(track, localMediaStream);
      mediaSenders.push(sender);
    });

    const callOffer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(callOffer);

    await transmitCallSignal({
      subtype: "MEDIA_OFFER",
      sdp: {
        type: callOffer.type,
        sdp: callOffer.sdp
      }
    });
    showNotification("Calling peer... waiting for answer.", "info");
  } catch (error) {
    console.error("Cannot Access Camera/Microphone: ", error);
    showNotification("Could not access Camera/Microphone", "error");
    shutDownActiveMediaTracks();
  }
}

function shutDownActiveMediaTracks() {
  const callPrompt = document.getElementById("incomingCallPrompt");
  if(callPrompt) callPrompt.remove();
  
  if(localMediaStream) {
    localMediaStream.getTracks().forEach(track => track.stop());
    localMediaStream = null;
  }
  if(peerConnection) {
    mediaSenders.forEach(sender => {
      try {
        peerConnection.removeTrack(sender);
      } catch (error) {
        console.warn(error)
      }
    });
  }
  mediaSenders = [];
  localVideoEl.srcObject = null;
  remoteVideoEl.srcObject = null;
  if (callOverlay) callOverlay.classList.add("hidden");

  isAudioMuted = false;
  isVideoMuted = false;
  if (toggleAudioBtn) {
  toggleAudioBtn.textContent = "Mute Mic";
  toggleAudioBtn.classList.remove("hardwareMuted");
  }
  if (toggleVideoBtn) {
    toggleVideoBtn.textContent = "Stop Video";
    toggleVideoBtn.classList.remove("hardwareMuted");
  }
}

function sendCallTerminationMsg() {
  transmitCallSignal({
    subtype: "MEDIA_HANGUP"
  });
  shutDownActiveMediaTracks();
}

if (initiateCallBtn) initiateCallBtn.addEventListener("click", startPeerVoiceVideoCall);
if (endCallBtn) endCallBtn.addEventListener("click", sendCallTerminationMsg);

if (toggleAudioBtn) {

toggleAudioBtn.addEventListener("click", () => {
  if(localMediaStream) {
    isAudioMuted = !isAudioMuted
    localMediaStream.getAudioTracks().forEach(track => track.enabled = !isAudioMuted);
    toggleAudioBtn.textContent = isAudioMuted ? "Unmute Mic" : "Mute Mic";
    toggleAudioBtn.classList.toggle("hardwareMuted", isAudioMuted);
  }
});
}

if (toggleVideoBtn) {

toggleVideoBtn.addEventListener("click", () => {
  if(localMediaStream) {
    isVideoMuted = !isVideoMuted;
    localMediaStream.getVideoTracks().forEach(track => track.enabled = !isVideoMuted);
    toggleVideoBtn.textContent = isVideoMuted ? "Start Video" : "Stop Video";
    toggleVideoBtn.classList.toggle("hardwareMuted", isVideoMuted);
  }
});
}

document
  .getElementById("scanRemoteQrBtn")
  .addEventListener("click", startQrScanner);
document
  .getElementById("closeScannerBtn")
  .addEventListener("click", hideQrScanner);
document.getElementById("fileSelectBtn").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});
document.getElementById("fileInput").addEventListener("change", (e) => {
  const selectedFile = e.target.files[0];
  if (selectedFile) {
    transferEncryptedFile(selectedFile);
    e.target.value = "";
  }
});
genOfferBtn.addEventListener("click", generateLocalConnectionOffer);
acceptRemoteBtn.addEventListener("click", acceptRemotePeerConnection);

window.addEventListener("focus", async ()=> {
  if(!dataChannel || dataChannel.readyState !== "open" || !chatSession.ackKey) return;

  for (const [msgId, value] of messageMap.entries()) {
    if(!value.rowEl.classList.contains("incoming")) continue;
    if(!value.rowEl.dataset.readAcknowledged === "true") continue;

    value.rowEl.dataset.readAcknowledged = "true";
    try {
      const ack = {
        type: "MSG_ACK",
        status: "read",
        msgId
      };
      const encryptedAck = await encryptText(JSON.stringify(ack), chatSession.ackKey);
      dataChannel.send(JSON.stringify({
        type: "MSG_ACK",
        iv: encryptedAck.iv,
        ciphertext: encryptedAck.ciphertext,
      }));
    } catch (error) {
      console.warn("Focus read ack failed: ", error);
    }
  };
});

async function startVoiceRecording() {
  if (!dataChannel || dataChannel.readyState !== "open") {
    alert("Cannot record voice because Peer Connection is offile");
    return;
  }
  try {
    recordedAudioChunks = [];
    const captureStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });
    mediaRecordInstance = new MediaRecorder(captureStream);

    mediaRecordInstance.ondataavailable = (event) => {
      if(event.data && event.data.size > 0) {
        recordedAudioChunks.push(event.data);
      }
    };

    mediaRecordInstance.onstop = async () => {
      captureStream.getTracks().forEach(track => track.stop());
      const audioBlob = new Blob(recordedAudioChunks, {
        type: "audio/wav"
      });

    if(audioBlob.size > 0) {
      await processSendVoiceMsg(audioBlob);
    }
    };
    mediaRecordInstance.start();
    voiceRecordBtn.classList.add("recording");
    console.log("Audio Recording Pipeline processing input");
  } catch (error) {
    console.error("Microphone configuration access error: ", error);
    alert("Could not access audio device.")
  }
}

function stopVoiceRecording() {
  if (mediaRecordInstance && mediaRecordInstance.state !== "inactive"){
    mediaRecordInstance.stop();
  }
  voiceRecordBtn.classList.remove("recording");
}

async function processSendVoiceMsg(audioBlob) {
  try {
    const rawBuffer = await audioBlob.arrayBuffer();
    const uniqueFileId = crypto.randomUUID();
    const targetMimeType = "audio/wav;secure=true";
    const descriptorLabel = "VoiceMessage.wav";

    const localDataUrl = URL.createObjectURL(audioBlob);
    const clientMsgId = generateMsgId();

    renderMessage("Voice Message Sent", "outgoing", "", false, "", clientMsgId, null, true, localDataUrl);
    const historyPayload = {
      msgId: clientMsgId,
      text: "Voice Message Sent",
      direction: "outgoing",
      timestamp: Date.now(),
      isImage: false,
      isAudio: true,
      fileData: localDataUrl
    };
    const encryptedHistoryPkg = await encryptText(JSON.stringify(historyPayload), masterStorageKey);
    const savedHistory = JSON.parse(localStorage.getItem("javault_history") || "[]");
    savedHistory.push(encryptedHistoryPkg);
    localStorage.setItem("javault_history", JSON.stringify(savedHistory));

    const binaryByteLen = rawBuffer.byteLength;
    const computedTotalChunks = Math.ceil(binaryByteLen / CHUNK_SIZE);

    dataChannel.send(JSON.stringify({
      type: "FILE_START",
      fileId: uniqueFileId,
      fileMsgId: clientMsgId,
      name: descriptorLabel,
      mimeType: targetMimeType,
      totalChunks: computedTotalChunks
    }));
    for (let chunkIndex = 0; chunkIndex < computedTotalChunks; chunkIndex++) {
      const byteStartOffset = chunkIndex * CHUNK_SIZE;
      const sliceSizeBound = Math.min(CHUNK_SIZE, binaryByteLen - byteStartOffset);
      const dataChunkSlice = rawBuffer.slice(byteStartOffset, byteStartOffset + sliceSizeBound);
      const { nextChainKeyBuffer, msgKey } = await ratchetStep(chatSession.sendChainKey);
      chatSession.sendChainKey = nextChainKeyBuffer;
      const encryptedChunkPayload = await encryptBuffer(dataChunkSlice, msgKey);

      dataChannel.send(JSON.stringify({
        type: "FILE_CHUNK",
        fileId: uniqueFileId,
        chunkIndex: chunkIndex,
        iv: encryptedChunkPayload.iv,
        ciphertext: encryptedChunkPayload.ciphertext
      }));
    }

    dataChannel.send(JSON.stringify({
      type: "FILE_END",
      fileId: uniqueFileId
    }))

    console.log("Encrypted Audio File Processing completed!")
  } catch (error) {
    console.error("Voice encryption crash: ", error);
  }
}

document.getElementById("copyOfferBtn").addEventListener("click", () => {
  const val = localSdpTextArea.value;
  if(!val) {
    showNotification("Generate an offer first.", "warning")
    return;
  }
  navigator.clipboard.writeText(val).then(()=>{
    showNotification("SDP Code copied to clipboard.", "success");
  }).catch(()=> showNotification("Copy failed. Select and Copy Manually", "error"));
});

messageInputEl.addEventListener("input", ()=> {
  const val = messageInputEl.value;
  if(val.trim()) {
    localStorage.setItem(DRAFT_KEY, val);
  }
  else {
    localStorage.removeItem(DRAFT_KEY);
  }
})

voiceRecordBtn.addEventListener("mousedown", (e)=> {
  e.preventDefault();
  startVoiceRecording();
});
voiceRecordBtn.addEventListener("mouseup", (e)=> {
  e.preventDefault();
  stopVoiceRecording();
});
voiceRecordBtn.addEventListener("mouseleave", (e)=> {
  e.preventDefault();
  stopVoiceRecording();
});
voiceRecordBtn.addEventListener("touchstart", (e)=> {
  e.preventDefault();
  startVoiceRecording();
},
{
  passive: false
});
voiceRecordBtn.addEventListener("touchend", (e)=> {
  e.preventDefault();
  stopVoiceRecording();
},
{
  passive: false
});
voiceRecordBtn.addEventListener("touchcancel", (e)=> {
  e.preventDefault();
  stopVoiceRecording();
},
{
  passive: false
});