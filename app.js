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
} from "./cryptoUtils.js";

let chatSession = {
  key: null,
  history: [],
};

let localEphemeralKeyPair = null;
let remotePeerPublicKeyBase64 = null;
let remotePeerPublicKey = null;
let masterStorageKey = null;
let localTypingTimeout = null;
let isLocallyTyping = false;
let remoteTypingTimer = null;
const messageInputEl = document.getElementById("messageInput");

const staticSalt = stringToBuffer("JaVaultScript_Application_Salt_Fixed_16B");

const splashWall = document.getElementById("splashWall");
const masterPhraseForm = document.getElementById("masterPhraseForm");
const masterPhraseInput = document.getElementById("masterPhraseInput");
const mainApp = document.getElementById("mainApp");
const chatLog = document.getElementById("chatLog");
const messageForm = document.getElementById("messageForm");
const lockBtn = document.getElementById("lockBtn");
const statusRing = document.getElementById("statusRing");
const statusText = document.getElementById("statusText");

function renderMessage(text, direction = "outgoing", timeStr = "") {
  const rowEl = document.createElement("div");
  rowEl.classList.add("msgRow", direction);

  const bubbleEl = document.createElement("div");
  bubbleEl.classList.add("msgBubble");

  bubbleEl.textContent = text;

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

  rowEl.appendChild(bubbleEl);
  chatLog.appendChild(rowEl);
  chatLog.scrollTop = chatLog.scrollHeight;
}

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
  const messageInput = document.getElementById("messageInput");
  const plainText = messageInput.value;
  if (!plainText) return;

  try {
    const encryptedPkg = await encryptText(plainText, masterStorageKey);

    const savedHistory = JSON.parse(
      localStorage.getItem("javault_history") || "[]",
    );
    savedHistory.push(encryptedPkg);

    localStorage.setItem("javault_history", JSON.stringify(savedHistory));

    chatSession.history.push(plainText);
    renderMessage(plainText, "outgoing");

    if (dataChannel && dataChannel.readyState === "open") {
      if (!chatSession.key) {
        console.warn("Session Encryption Key not registered yet.");
        return;
      }

      const encryptedWirePkg = await encryptText(plainText, chatSession.key);

      const wirePayLoad = {
        type: "TEXT_MESSAGE",
        iv: encryptedWirePkg.iv,
        ciphertext: encryptedWirePkg.ciphertext,
        timestamp: Date.now(),
        sender: "peer_node",
      };
      dataChannel.send(JSON.stringify(wirePayLoad));
    } else {
      console.warn("Data Channel isn't open");
    }

    messageInput.value = "";
  } catch (e) {
    console.error("Encryption Crash: ", e);
  }
});

async function loadAndDecryptHistory() {
  chatLog.innerHTML = "";
  const savedHistory = JSON.parse(
    localStorage.getItem("javault_history") || "[]",
  );

  for (const msgPkg of savedHistory) {
    try {
      const plainText = await decryptText(
        msgPkg.ciphertext,
        msgPkg.iv,
        masterStorageKey,
      );
      chatSession.history.push(plainText);
      renderMessage(plainText, "outgoing");
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
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(
      `WebRTC Connection Status Update: ${peerConnection.connectionState}`,
    );
    if (peerConnection.connectionState === "connected") {
      updateStatusUI("connected");
    } else if (
      peerConnection.connectionState === "failed" ||
      peerConnection.connectionState === "disconnected"
    ) {
      updateStatusUI("idle");
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

  dataChannel = peerConnection.createDataChannel("chatChannel");
  setupDataChannelListeners(dataChannel);

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    if (peerConnection.iceGatheringState === "complete") {
      localSdpTextArea.value = btoa(
        JSON.stringify(peerConnection.localDescription),
      );
    }
  } catch (error) {
    console.error(
      "Failed to construct local connection configuration profile :(",
    );
    alert("Strucutre Initialization Failure.");
  }
}

// genOfferBtn.addEventListener("click", generateLocalConnectionOffer);

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

      if (peerConnection.iceGatheringState === "complete") {
        localSdpTextArea.value = btoa(
          JSON.stringify(peerConnection.localDescription),
        );
      }
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

    if (
      parsedFrame &&
      (parsedFrame.status === "typing" || parsedFrame.status === "idle")
    ) {
      if (parsedFrame.status === "typing") {
        showTypingIndicator();
      } else {
        hideTypingIndicator();
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
          "incoming",
        );
        return;
      }

      const decryptedText = await decryptText(
        parsedFrame.ciphertext,
        parsedFrame.iv,
        chatSession.key,
      );

      let displayTime = "";
      if (parsedFrame.timestamp) {
        const date = new Date(parsedFrame.timestamp);
        displayTime = date.toLocaleDateString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      renderMessage(decryptedText, "incoming", displayTime);
    }
  } catch (e) {
    console.error("Error parsing incoming message", e);
  }
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

function hideTypingIndicator(){
    const indicator = document.getElementById("typingIndicator");
    if(indicator) {
        indicator.remove();
    }
}

messageInputEl.addEventListener("input", ()=>{
    if(dataChannel && dataChannel.readyState === "open") {
        if(!isLocallyTyping) {
            isLocallyTyping = true;
            dataChannel.send(JSON.stringify({
                status: "typing"
            }));
        }

        clearTimeout(localTypingTimeout);
        localTypingTimeout = setTimeout(() => {
            isLocallyTyping = false;
            dataChannel.send(JSON.stringify({
                status: "idle"
            }));
        }, 3000);
    }
})

genOfferBtn.addEventListener("click", generateLocalConnectionOffer);
acceptRemoteBtn.addEventListener("click", acceptRemotePeerConnection);
