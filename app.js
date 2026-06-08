import { 
    deriveKeyFromPhrase,
    encryptText,
    decryptText,
    stringToBuffer,
    bufferToHex,
    hexToBuffer
} from "./cryptoUtils.js";

let chatSession = {
    key: null,
    history: []
};

const staticSalt = stringToBuffer("JaVaultScript_Application_Salt_Fixed_16B");

const splashWall = document.getElementById("splashWall");
const masterPhraseForm = document.getElementById("masterPhraseForm");
const masterPhraseInput = document.getElementById("masterPhraseInput");
const mainApp = document.getElementById("mainApp");
const chatLog = document.getElementById("chatLog");
const messageForm = document.getElementById("messageForm");
const lockBtn = document.getElementById("lockBtn");

function renderMessage(text) {
    const messageEl = document.createElement("div");
    messageEl.textContent = text;
    messageEl.style.padding = "0.5rem";
    messageEl.style.borderBottom = "1px solid #1e293b";
    chatLog.appendChild(messageEl);
    chatLog.scrollTop = chatLog.scrollHeight;
}

masterPhraseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userMasterPhrase = masterPhraseInput.value;

    if(userMasterPhrase.length >= 8) {
        try {
            chatSession.key = await deriveKeyFromPhrase(userMasterPhrase, staticSalt);
            console.log("CryptoKey Object Created!");
            splashWall.classList.add("hidden");
            mainApp.classList.remove("hidden");
            masterPhraseInput.value = "";

            await loadAndDecryptHistory();
        } catch (error) {
            console.error(error);
            alert("Cryptographic Initialization Failed!");
        }
    }
    else {
        alert("It must be atleast 8 characters long.");
    }
});

messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const messageInput = document.getElementById("messageInput");
    const plainText = messageInput.value;
    if(!plainText) return;

    try {
        const encryptedPkg = await encryptText(plainText, chatSession.key);

        const savedHistory = JSON.parse(localStorage.getItem("javault_history") || "[]");
        savedHistory.push(encryptedPkg);

        localStorage.setItem("javault_history", JSON.stringify(savedHistory));

        chatSession.history.push(plainText);
        renderMessage(plainText);

        messageInput.value = "";
    } catch (e) {
        console.error("Encryption Crash: ", e)
    }
})

async function loadAndDecryptHistory() {
    chatLog.innerHTML = "";
    const savedHistory = JSON.parse(localStorage.getItem("javault_history") || "[]");

    for (const msgPkg of savedHistory) {
        try {
            const plainText = await decryptText(msgPkg.ciphertext, msgPkg.iv, chatSession.key);
            chatSession.history.push(plainText);
            renderMessage(plainText);
        } catch (error) {
            console.error("Decryption Failed", error);
        }
    }
}

lockBtn.addEventListener("click", () => {
    chatSession.key = null;
    chatSession.history = [];
    chatLog.innerHTML = "";

    mainApp.classList.add("hidden");
    splashWall.classList.remove("hidden")
});

let peerConnection = null;
let dataChannel = null;

const genOfferBtn = document.getElementById("genOfferBtn");
const localSdpTextArea = document.getElementById("localSdpTextArea");
const remoteSdpTextArea = document.getElementById("remoteSdpTextArea");
const acceptRemoteBtn = document.getElementById("acceptRemoteBtn")

function initializePeerConnection() {
    console.log("Initializing Peer Connection!");

    const configuration = {
        iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
        ]
    };

    peerConnection = new RTCPeerConnection(configuration);

    dataChannel = peerConnection.createDataChannel("chatChannel");
    setupDataChannelListeners(dataChannel);

    peerConnection.onconnectionstatechange = () => {
        console.log(`WebRTC Connection State Updated: ${peerConnection.connectionState}`);
    };
    peerConnection.oniceconnectionstatechange = () => {
        console.log(`WebRTC ICE Connection Status Update: ${peerConnection.iceConnectionState}`);
    };

    peerConnection.ondatachannel = (event) => {
        console.log("Inbound remote WebRTC data Channel Captured");
        setupDataChannelListeners(event.channel)
    };
}


function setupDataChannelListeners(channel) {
    channel.onopen = () => {
        console.log("Data Channel Link Stauts: Open");
    };
    channel.onclose = () => {
        console.log("Data Channel Link Status: Close");
    }
    channel.onerror = (error) => {
        console.error("Data Channel Communication Fault", error);
    }
    channel.onmessage = (event) => {
        console.log("Encrypted Data Recieved over Data Channel");

    };
}

async function generateLocalConnectionOffer(p) {
    if(!peerConnection) {
        initializePeerConnection();
    }
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        peerConnection.onicecandidate = (event) => {
            if(!event.candidate) {
                console.log("ICE Network Parsing done :)");
                localSdpTextArea.value = btoa(JSON.stringify(peerConnection.localDescription));
            }
        };

        if (peerConnection.iceGatheringState === "complete") {
            localSdpTextArea.value = btoa(JSON.stringify(peerConnection.localDescription));
        }
    } catch (error) {
        console.error("Failed to construct local connection configuration profile :(");
        alert("Strucutre Initialization Failure.");
    }
}

genOfferBtn.addEventListener("click", generateLocalConnectionOffer);