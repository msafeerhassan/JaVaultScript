export function stringToBuffer(rawString) {
  if (typeof rawString !== "string") {
    throw new TypeError("It must be string!");
  }
  const encoder = new TextEncoder();
  return encoder.encode(rawString);
}

export function bufferToString(binaryBuffer) {
  if (
    !(binaryBuffer instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(binaryBuffer)
  ) {
    throw new TypeError(
      "Must be an instance of ArrayBuffer or an ArrayBuffer view.",
    );
  }

  const decoder = new TextDecoder();
  return decoder.decode(binaryBuffer);
}

export function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBuffer(hexStr) {
  if (hexStr.length % 2 !== 0) {
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
      name: "PBKDF2",
    },
    false,
    ["deriveKey"],
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptText(plainText, cryptoKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const dataBuffer = stringToBuffer(plainText);

  const cipherTextBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    cryptoKey,
    dataBuffer,
  );

  return {
    iv: bufferToHex(iv),
    ciphertext: bufferToHex(cipherTextBuffer),
  };
}

export async function decryptText(cipherTextHex, ivHex, cryptoKey) {
  const iv = hexToBuffer(ivHex);
  const ciphertext = hexToBuffer(cipherTextHex);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    cryptoKey,
    ciphertext,
  );

  return bufferToString(decryptedBuffer);
}

export async function generateEphemeralKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["wrapKey", "unwrapKey"],
  );
}

export async function exportPublicKeySpki(publicKey) {
  return await window.crypto.subtle.exportKey("spki", publicKey);
}

export function bufferToBase64(buffer) {
  const binStr = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binStr);
}

export function base64ToBuffer(base64Str) {
  const binStr = atob(base64Str);
  const view = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    view[i] = binStr.charCodeAt(i);
  }

  return view.buffer;
}

export async function importPublicKeySpki(buffer) {
  return await window.crypto.subtle.importKey(
    "spki",
    buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["wrapKey"],
  );
}

export async function generateSharedSessionKey() {
  return await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function wrapSymmetricKey(symmetricKey, rsaPublicKey) {
  return await window.crypto.subtle.wrapKey("raw", symmetricKey, rsaPublicKey, {
    name: "RSA-OAEP",
  });
}

export async function unwrapSymetricKey(wrappedBufferKey, rsaPrivateKey) {
  return await window.crypto.subtle.unwrapKey(
    "raw",
    wrappedBufferKey,
    rsaPrivateKey,
    {
      name: "RSA-OAEP",
    },
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function compressString(str) {
  if (!str) return "";
  const stream = new Blob([str]).stream();
  const compressionStream = new CompressionStream("deflate");
  const compressedStream = stream.pipeThrough(compressionStream);
  const response = new Response(compressedStream);
  const buffer = await response.arrayBuffer();

  const bytes = new Uint8Array(buffer);
  let binaryStr = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binaryStr += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryStr);
}

export async function decompressString(base64Str) {
  if (!base64Str) return "";
  const binaryStr = atob(base64Str);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const stream = new Blob([bytes]).stream();
  const decompressionStream = new DecompressionStream("deflate");
  const decompressedStream = stream.pipeThrough(decompressionStream);
  const response = new Response(decompressedStream);

  return await response.text();
}

export async function encryptBuffer(dataBuffer, cryptoKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const cipherTextBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    cryptoKey,
    dataBuffer,
  );

  return {
    iv: bufferToHex(iv),
    ciphertext: bufferToHex(cipherTextBuffer),
  };
}

export async function decryptBuffer(cipherTextHex, ivHex, cryptoKey) {
  const iv = hexToBuffer(ivHex);
  const ciphertext = hexToBuffer(cipherTextHex);

  return await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    cryptoKey,
    ciphertext,
  );
}
