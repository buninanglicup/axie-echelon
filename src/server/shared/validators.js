export function cleanAxieId(value) {
  const axieId = String(value || "").trim();
  if (!/^\d+$/.test(axieId)) {
    throw new Error("Axie ID must contain only numbers.");
  }
  return axieId;
}

export function cleanRoninAddress(value) {
  const address = String(value || "").trim().replace(/^ronin:/i, "0x");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("A valid Ronin address is required.");
  }
  return address.toLowerCase();
}