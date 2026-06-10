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
  decryptBuffer
} from "./cryptoUtils.js";

let chatSession = {
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
  const plainText = messageInputEl.value.trim();
  if (!plainText) return;

  try {

    const historyPayload = {
      text: plainText,
      direction: "outgoing",
      timestamp: Date.now()
    };
    const encryptedPkg = await encryptText(JSON.stringify(historyPayload), masterStorageKey);

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
      const decryptedJSON = await decryptText(
        msgPkg.ciphertext,
        msgPkg.iv,
        masterStorageKey,
      );

      const record = JSON.parse(decryptedJSON);

      let displayTime = "";

      if(record.timestamp) {
        displayTime = new Date(record.timestamp).toLocaleDateString([],{
          hour: "2-digit",
          minute: "2-digit"
        });
      }

      chatSession.history.push(record.text);
      renderMessage(record.text, record.direction || "outgoing", displayTime);
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
      updateLocalQrCode(localSdpTextArea.value);
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

      try {
        const historyPayload = {
          text: decryptedText,
          direction: "incoming",
          timestamp: parsedFrame.timestamp || Date.now()
        };
        const encryptedPkg = await encryptText(JSON.stringify(historyPayload), masterStorageKey);
        const savedHistory = JSON.parse(localStorage.getItem("javault_history") || "[]");
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
      renderMessage(decryptedText, "incoming", displayTime);
    }

    if (parsedFrame && parsedFrame.type === "FILE_START") {
      incomingFileMap.set(parsedFrame.fileId, {
        name: parsedFrame.name,
        mimeType: parsedFrame.mimeType,
        totalChunks: parsedFrame.totalChunks,
        receivedCount: 0,
        chunks: new Array(parsedFrame.totalChunks)
      });

      renderMessage(`Receiving encrypted file: ${parsedFrame.name}`, "incoming", "");
      return;
    }

    if(parsedFrame && parsedFrame.type === "FILE_CHUNK") {
      const fileContext = incomingFileMap.get(parsedFrame.fileId);
      if(!fileContext || !chatSession.key) return ;

      try {
        const decryptedBuffer = await decryptBuffer(
          parsedFrame.ciphertext,
          parsedFrame.iv,
          chatSession.key
        );

        fileContext.chunks[parsedFrame.chunkIndex] = decryptedBuffer;
        fileContext.receivedCount++;
      }
      catch(decErr){
        console.error("Failed chunk decryption", decErr);
      }
      return;
    }

    if(parsedFrame && parsedFrame.type === "FILE_END") {
      const fileContext = incomingFileMap.get(parsedFrame.fileId);
      if(!fileContext) return;
      
      const combinedBlob = new Blob(fileContext.chunks, {
        type: fileContext.mimeType
      });

      const downloadUrl = URL.createObjectURL(combinedBlob);

      const rowEl = document.createElement("div");
      rowEl.className = "msgRow incoming";
      const bubbleEl = document.createElement("div");
      bubbleEl.className = "msgBubble";

      const downloadLink = document.createElement("a");

      downloadLink.href = downloadUrl;
      downloadLink.download = fileContext.name;
      downloadLink.textContent = `Download File: ${fileContext.name}`;
      downloadLink.style.color = "#34d399";
      downloadLink.style.fontWeight = "bold";
      downloadLink.style.textDecoration = "underline";

      bubbleEl.appendChild(downloadLink);
      rowEl.appendChild(bubbleEl);
      chatLog.appendChild(rowEl);
      chatLog.scrollTop = chatLog.scrollHeight;

      incomingFileMap.delete(parsedFrame.fileId);
      return;
    }
  } catch (e) {
    console.error("Error parsing incoming message", e);
  }
}

async function transferEncryptedFile(file) {
  if(!dataChannel || dataChannel.readyState !== "open" || !chatSession.key){
    alert("Cannot send file: Connection Inactive");
    return;
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = crypto.randomUUID();

  dataChannel.send(JSON.stringify(
    {
      type: "FILE_START",
      fileId: fileId,
      name: file.name,
      mimeType: file.type,
      totalChunks: totalChunks
    }
  ));

  renderMessage(`Sending File: ${file.name}`, "outgoing", "");

  const reader = new FileReader();
  let offset = 0;
  let chunkIndex = 0;

  const readNextChunk = () => {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    reader.readAsArrayBuffer(slice);
  }

  reader.onload = async (e) => {
    const rawBuffer = e.target.result;
    try {
      const encryptedPkg = await encryptBuffer(rawBuffer, chatSession.key);
      dataChannel.send(JSON.stringify({
        type: "FILE_CHUNK",
        fileId: fileId,
        chunkIndex: chunkIndex,
        iv:encryptedPkg.iv,
        ciphertext: encryptedPkg.ciphertext
      }));

      chunkIndex++;
      offset += CHUNK_SIZE;

      if(offset < file.size) {
        readNextChunk();
      }
      else {
        dataChannel.send(JSON.stringify({
          type: "FILE_END",
          fileId: fileId
        }));
        renderMessage(`Successfully Sent: ${file.name}`, "outgoing", "");
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

async function updateLocalQrCode(rawSdp) {
  try {
    const compressedPayLoad = await compressString(rawSdp);

    new QRious({
      element: document.getElementById("localQrCanvas"),
      value: compressedPayLoad,
      size: 250,
      level: "L"
    });
  } catch (error) {
    console.error("Error:" ,error);
  }
}

function startQrScanner() {
  const video = document.getElementById("scannerVideo");
  const modal = document.getElementById("qrScanner");
  modal.classList.remove("hidden");

  navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "environment"
    }
  }).then(stream => {
    scannerStream = stream;
    video.srcObject = stream;
    video.setAttribute("playsinline", true);
    video.play();
    scannerAnimationId = requestAnimationFrame(tickScanner);
  }).catch(err => {
    console.error("Webcam Launch Error: ", err);
    alert("Unable to lauch video scanner. Check permissions.");
    hideQrScanner();
  });
}

function tickScanner() {
  const video = document.getElementById("scannerVideo");
  if(video.readyState === video.HAVE_CURRENT_DATA) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });

    if(code && code.data) {
      handleScannedData(code.data);
      return;
    }
  }
  scannerAnimationId = requestAnimationFrame(tickScanner);
}

async function handleScannedData(compressedData) {
  try {
    const structuralSdp = await decompressString(compressedData);
    remoteSdpTextArea.value = structuralSdp;
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
  if(scannerStream) {
    scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
  }

  if(scannerAnimationId) {
    cancelAnimationFrame(scannerAnimationId);
    scannerAnimationId = null;
  }
}

document.getElementById("scanRemoteQrBtn").addEventListener("click", startQrScanner);
document.getElementById("closeScannerBtn").addEventListener("click", hideQrScanner);
document.getElementById("fileSelectBtn").addEventListener("click", ()=> {
  document.getElementById("fileInput").click();
});
document.getElementById("fileInput").addEventListener("change", (e)=>{
  const selectedFile = e.target.files[0];
  if(selectedFile) {
    transferEncryptedFile(selectedFile);
    e.target.value = "";
  }
});
genOfferBtn.addEventListener("click", generateLocalConnectionOffer);
acceptRemoteBtn.addEventListener("click", acceptRemotePeerConnection);
