"use strict";
// Replaces node-fetch inside @solana/web3.js. ScanPay never makes RPC or HTTP calls,
// so any attempt fails loudly instead of reaching the network.
function fetch() {
  return Promise.reject(new Error("ScanPay makes no network calls."));
}
module.exports = fetch;
module.exports.default = fetch;
