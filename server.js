const axios = require("axios")
require("dotenv").config();

// Load Kraken API credentials from .env file
const API_KEY = process.env.KRAKEN_API_KEY;
const API_SECRET = process.env.KRAKEN_API_SECRET;

// Kraken API endpoints
const KRAKEN_API_URL = "https://api.kraken.com";
const KRAKEN_API_VERSION = "/0";

const crypto = require("crypto");

// Trading parameters
const TRADE_PAIR = "XXRPZUSD"; // XRP/USD trading pair
const TRADE_AMOUNT = 15; // Amount of XRP to trade
const BUY_PERCENTAGE_DROP = 2; // 2% drop to trigger buy
const SELL_PERCENTAGE_RISE = 2; // 2% rise to trigger sell
const PROFIT_THRESHOLD = 10; // USD profit threshold for withdrawals

let lastBuyPrice = null; // Track last buy price for sell calculation

// Function to create Kraken API headers
function createKrakenHeaders(path, body) {
  const nonce = Date.now() * 1000;
  const message = nonce + body;
  const secretBuffer = Buffer.from(API_SECRET, "base64");
  const hash = crypto.createHash("sha256").update(message).digest();
  const hmac = crypto
    .createHmac("sha512", secretBuffer)
    .update(path + hash)
    .digest("base64");

  return {
    "API-Key": API_KEY,
    "API-Sign": hmac,
    "Content-Type": "application/json",
  };
}

// Fetch current market price
async function fetchMarketPrice() {
  const response = await axios.get(
    `${KRAKEN_API_URL}${KRAKEN_API_VERSION}/public/Ticker?pair=${TRADE_PAIR}`
  );
  const price = response.data.result[TRADE_PAIR].c[0]; // Current market price
  return parseFloat(price);
}

// Place a buy/sell order
async function placeOrder(orderType, volume) {
  const url = `${KRAKEN_API_URL}${KRAKEN_API_VERSION}/private/AddOrder`;
  const body = new URLSearchParams({
    nonce: Date.now() * 1000,
    pair: TRADE_PAIR,
    type: orderType, // "buy" or "sell"
    ordertype: "market",
    volume: volume.toString(),
  }).toString();

  const headers = createKrakenHeaders("/0/private/AddOrder", body);

  const response = await axios.post(url, body, { headers });
  console.log(`${orderType.toUpperCase()} order placed:`, response.data);
}

// Main trading bot logic
async function main() {
  try {
    console.log("Fetching current market price...");
    const marketPrice = await fetchMarketPrice();
    console.log(`Market Price: $${marketPrice}`);

    if (!lastBuyPrice) {
      console.log(`First buy since no last price. Placing buy order...`);
      await placeOrder("buy", TRADE_AMOUNT);
      lastBuyPrice = marketPrice;
    } else {
      const buyThreshold = lastBuyPrice * (1 - BUY_PERCENTAGE_DROP / 100);
      const sellThreshold = lastBuyPrice * (1 + SELL_PERCENTAGE_RISE / 100);

      if (marketPrice <= buyThreshold) {
        console.log(
          `Price dropped ${BUY_PERCENTAGE_DROP}%. Buying ${TRADE_AMOUNT} XRP...`
        );
        await placeOrder("buy", TRADE_AMOUNT);
        lastBuyPrice = marketPrice; // Update last buy price
      } else if (marketPrice >= sellThreshold) {
        console.log(
          `Price increased ${SELL_PERCENTAGE_RISE}%. Selling ${TRADE_AMOUNT} XRP...`
        );
        await placeOrder("sell", TRADE_AMOUNT);
        lastBuyPrice = null; // Reset after selling
      } else {
        console.log("No trade action required.");
      }
    }
  } catch (err) {
    console.error("Error in trading bot:", err);
  }
}

// Run the bot in intervals (e.g., every 30 seconds)
setInterval(main, 30000);
