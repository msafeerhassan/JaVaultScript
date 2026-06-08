export function stringToBuffer(rawString) {
    if (typeof rawString !== "string") {
        throw new TypeError("It must be string!");
    }
    const encoder = new TextEncoder();
    return encoder.encode(rawString);
}

export function bufferToString(binaryBuffer) {
    if (!(binaryBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(binaryBuffer)) {
        throw new TypeError("Must be an instance of ArrayBuffer or an ArrayBuffer view.");        
    }

    const decoder = new TextDecoder();
    return decoder.decode(binaryBuffer);
}


export function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");

}

export function hexToBuffer(hexStr) {
    if (hexStr.length % 2 !== 0){
        throw new Error("Invalid Hex String!");
    }

    const view = new Uint8Array(hexStr.length / 2);

    for (let i = 0; i < view.length; i++) {
        view[i] = parseInt(hexStr.substr(i * 2, 2), 16);
    }

    return view;
}

export async function deriveKeyFromPhrase(masterPhrase, salt) {
    const rawPhraseBuffer = stringToBuffer(masterPhrase);

    const baseKey = await window.crypto.subtle.importKey(
        "raw",
        rawPhraseBuffer,
        {
            name: "PBKDF2"
        },
        false,
        ["deriveKey"]
    );

    return await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        baseKey,
        {
            name: "AES-GCM",
            length: 256
        },
        false,
        [
            "encrypt",
            "decrypt"
        ]
    );
}

export async function encryptText(plainText, cryptoKey) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const dataBuffer = stringToBuffer(plainText);

    const cipherTextBuffer = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        cryptoKey,
        dataBuffer
    );

    return {
        iv: bufferToHex(iv),
        ciphertext: bufferToHex(cipherTextBuffer)
    };
}

export async function decryptText(cipherTextHex, ivHex, cryptoKey) {
    const iv = hexToBuffer(ivHex);
    const ciphertext = hexToBuffer(cipherTextHex);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        cryptoKey,
        ciphertext
    );

    return bufferToString(decryptedBuffer)
}