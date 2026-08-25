// config/chuteId.js
// D035 -> "btn35" (leading zeros drop naturally via parseInt). Shared
// between clearBag.js (operator Block/Clear Bag) and sortEngine.js
// (the Machine's blocked-bag check), so the mapping is defined once.

function chuteIdFromBagCode(bagCode) {
  const match = /^[A-Za-z](\d+)$/.exec(String(bagCode || "").trim());
  if (!match) return null;
  return `btn${parseInt(match[1], 10)}`;
}

module.exports = { chuteIdFromBagCode };