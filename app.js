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

function renderMessage(
  text,
  direction = "outgoing",
  timeStr = "",
  isImage = false,
  imageDataUrl = "",
  msgId = null,
  replyTo = null,
) {
  if(!msgId) msgId = generateMsgId();

  const rowEl = document.createElement("div");
  rowEl.classList.add("msgRow", direction);
  rowEl.dataset.msgId = msgId;
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

  actionsEl.appendChild(reactBtn);
  actionsEl.appendChild(replyBtn);
  rowEl.appendChild(actionsEl);

  const bubbleEl = document.createElement("div");
  bubbleEl.classList.add("msgBubble");

  if(replyTo && replyTo.text) {
    const quoteEl = document.createElement("div");
    quoteEl.className = "replyQuote";
    quoteEl.textContent = replyTo.text.length > 80 ? replyTo.text.slice(0, 80) + "..." : replyTo.text;
    bubbleEl.appendChild(quoteEl);
  }

  if (isImage && imageDataUrl) {
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
    const textNode = document.createElement("span");
    textNode.textContent = text
    bubbleEl.appendChild(textNode);
  }
  if (!timeStr) {
    const now = new Date();
    timeStr = now.toLocaleDateString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const metaEl = document.createElement("span");
  metaEl.classList.add("msgMeta");
  metaEl.textContent = timeStr;
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
      reactionsData: new Map(),
      text,
    }
  );
  return { rowEl, msgId };
}

const EmojiList = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
let activePickerEl = null;

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
  if(!dataChannel || dataChannel.readyState !== "open" || !chatSession.key) return;

  const payload = {
    type: "REACTION",
    targetMsgId,
    emoji,
    timestamp: Date.now(),
  };

  try {
    const encrypted = await encryptText(JSON.stringify(payload), chatSession.key);
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

let replyContext = null;
const replyContextBar = document.getElementById("replyContextBar");
const replyPreviewText = document.getElementById("replyPreviewText");
const cancelReplyBtn = document.getElementById("cancelReplyBtn");

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
  const userMasterPhrase = masterPhraseInput.value;

  if (userMasterPhrase.length >= 8) {
    try {
      masterStorageKey = await deriveKeyFromPhrase(
        userMasterPhrase,
        staticSalt,
      );
      console.log("CryptoKey Object Created!");
      splashWall.classList.add("hidden");
      mainApp.classList.remove("hidden");
      masterPhraseInput.value = "";

      await loadAndDecryptHistory();
    } catch (error) {
      console.error(error);
      alert("Cryptographic Initialization Failed!");
    }
  } else {
    alert("It must be atleast 8 characters long.");
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const plainText = messageInputEl.value.trim();
  if (!plainText) return;

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
      if (!chatSession.key) {
        console.warn("Session Encryption Key not registered yet.");
        return;
      }

      // const encryptedWirePkg = await encryptText(plainText, chatSession.key);

      const wirePayLoad = {
        type: "TEXT_MESSAGE",
        msgId,
        plainText,
        replyTo: currentReply,
        timestamp: Date.now(),
        sender: "peer_node",
      };
      const encrypted = await encryptText(JSON.stringify(wirePayLoad), chatSession.key);
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
        displayTime = new Date(record.timestamp).toLocaleDateString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      }

      chatSession.history.push(record.text);
      renderMessage(
        record.text,
        record.direction || "outgoing",
        displayTime,
        record.isImage || false,
        record.fileData || "",
        record.msgId || null,
        record.replyTo || null,
      );
    } catch (error) {
      console.error("Decryption Failed", error);
    }
  }
}

lockBtn.addEventListener("click", () => {
  masterStorageKey = null;
  chatSession.key = null;
  chatSession.history = [];
  chatLog.innerHTML = "";

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  dataChannel = null;

  mainApp.classList.add("hidden");
  splashWall.classList.remove("hidden");
});

let peerConnection = null;
let dataChannel = null;

const genOfferBtn = document.getElementById("genOfferBtn");
const localSdpTextArea = document.getElementById("localSdpTextArea");
const remoteSdpTextArea = document.getElementById("remoteSdpTextArea");
const acceptRemoteBtn = document.getElementById("acceptRemoteBtn");

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
    alert("Please paste a remote SDP COde!");
    return;
  }

  try {
    const remoteDescriptionObject = JSON.parse(atob(rawInputText));
    if (!peerConnection) {
      initializePeerConnection();
    }

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(remoteDescriptionObject),
    );
    console.log(
      `Remote Description Applied Successfuly! Type: ${remoteDescriptionObject.type}`,
    );

    if (remoteDescriptionObject.type === "offer") {
      console.log("Connection Offer Detected!");
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
    } else if (remoteDescriptionObject.type === "answer") {
      console.log("Answer Recieved and Processed!");
    }
  } catch (error) {
    console.error("Failed to Parse SDP Code.");
    alert("Invalid String :(");
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

async function handleIncomingMsg(rawWireDate) {
  try {
    const parsedFrame = JSON.parse(rawWireDate);

    if (parsedFrame && parsedFrame.type === "TYPING_SIGNAL" && chatSession.key) {
      try {
        const decrypted = await decryptText(parsedFrame.ciphertext, parsedFrame.iv, chatSession.key);
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
      // return;
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
        chatSession.key = freshSessionKey;
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
      chatSession.key = unwrappedSessionKey;
      console.log("Symetric session key decrypted and extracted");
      return;
    }

    if (parsedFrame && parsedFrame.type === "TEXT_MESSAGE") {
      hideTypingIndicator();
      if (!chatSession.key) {
        renderMessage(
          "Error: Cannot Decrypt Message. Local Session Locked",
          "incoming"
        );
        return;
      }

      const decryptedJSON = await decryptText(
        parsedFrame.ciphertext,
        parsedFrame.iv,
        chatSession.key,
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
      renderMessage(plainText, "incoming", displayTime, false, "", msgId, replyTo || null);
    }

    if (parsedFrame && parsedFrame.type === "REACTION") {
      if(!chatSession.key) return;
      try {
        const decryptedJSON = await decryptText(
          parsedFrame.ciphertext,
          parsedFrame.iv,
          chatSession.key,
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
      if (!fileContext || !chatSession.key) return;

      try {
        const decryptedBuffer = await decryptBuffer(
          parsedFrame.ciphertext,
          parsedFrame.iv,
          chatSession.key,
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
        incomingFileMap.delete(parsedFrame.fileId);
        return;
      }

      const orderedChunks = fileContext.chunks.filter(Boolean);

      const combinedBlob = new Blob(orderedChunks, {
        type: fileContext.mimeType,
      });

      if (fileContext.mimeType && fileContext.mimeType.startsWith("image/")) {
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

      incomingFileMap.delete(parsedFrame.fileId);
      return;
    }

    if(parsedFrame && parsedFrame.type === "CALL_SIGNAL") {
      if(!chatSession.key) return;

      const decryptedSignalJson = await decryptText(parsedFrame.ciphertext, parsedFrame.iv, chatSession.key);
      const signalData = JSON.parse(decryptedSignalJson);

      if(signalData.subtype === "MEDIA_OFFER") {
        console.log("Processing inbound call request!");
        const acceptCall = confirm("Inbound Video Call Request Recieved! Accept?");
        if(!acceptCall) {
          sendCallTerminationMsg();
          return;
        }

        await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        localMediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        localVideoEl.srcObject = localMediaStream;

        localMediaStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, localMediaStream);
        });

        const ansDesc = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(ansDesc);

        await transmitCallSignal({
          subtype: "MEDIA_ANSWER",
          sdp: peerConnection.localDescription
        });

        callOverlay.classList.remove("hidden");
      }

      else if(signalData.subtype === "MEDIA_ANSWER") {
        console.log("Remote Peer Accepted Calling Session");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
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
  if (!dataChannel || dataChannel.readyState !== "open" || !chatSession.key) {
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

  dataChannel.send(
    JSON.stringify({
      type: "FILE_START",
      fileId: fileId,
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
      const encryptedPkg = await encryptBuffer(rawBuffer, chatSession.key);
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
            renderMessage(file.name, "outgoing", "", true, base64DataUrl);
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
          renderMessage(`Successfully Sent: ${file.name}`, "outgoing", "");
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
  if (dataChannel && dataChannel.readyState === "open" && chatSession.key) {
    if (!isLocallyTyping) {
      isLocallyTyping = true;
      try {
        const encrypted = await encryptText(
          JSON.stringify({status: "typing"}),
          chatSession.key
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
          chatSession.key
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
  if (dataChannel && dataChannel.readyState === "open" && chatSession.key) {
    const encryptedWirePkg = await encryptText(JSON.stringify(payLoadData), chatSession.key);
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
  try {
    console.log("Accessing media hardware ");
    localMediaStream = await navigator.mediaDevices.getUserMedia({
      audio:true,
      video:true
    });
    mediaSenders = [];
    localVideoEl.srcObject = localMediaStream;
    callOverlay.classList.remove("hidden");

    localMediaStream.getTracks().forEach(track => {
      const sender = peerConnection.addTrack(track, localMediaStream);
      mediaSenders.push(sender);
    });

    const callOffer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(callOffer);

    await transmitCallSignal({
      subtype: "MEDIA_OFFER",
      sdp: peerConnection.localDescription
    });
  } catch (error) {
    console.error("Cannot Access Camera/Microphone: ", error);
    shutDownActiveMediaTracks();
  }
}

function shutDownActiveMediaTracks() {
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
