const axios = require("axios");
require("dotenv").config();
const crypto = require("crypto");

const API_KEY = process.env.KRAKEN_API_KEY;
const API_SECRET = process.env.KRAKEN_API_SECRET;

const KRAKEN_API_URL = "https://api.kraken.com";
const KRAKEN_API_VERSION = "/0";

const TRADE_PAIR = "XXRPZUSD";  // XRP/USD trading pair
const TRADE_AMOUNT = 15;  // Amount of XRP to trade
const BUY_PERCENTAGE_DROP = 1;  // 2% drop to trigger buy
const SELL_PERCENTAGE_RISE = 1.5;  // 2% rise to trigger sell
const SMA_PERIOD_SHORT = 14;  // Short term SMA period
const SMA_PERIOD_LONG = 50;  // Long term SMA period

let lastBuyPrice = null;

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
  const price = response.data.result[TRADE_PAIR].c[0];
  return parseFloat(price);
}

// Fetch historical market data for SMA calculation
async function fetchHistoricalData() {
  const response = await axios.get(
    `${KRAKEN_API_URL}${KRAKEN_API_VERSION}/public/OHLC?pair=${TRADE_PAIR}&interval=5`
  );
  return response.data.result[TRADE_PAIR];
}

// Simple Moving Average (SMA) Calculation
function calculateSMA(data, period) {
  const prices = data.slice(-period).map(entry => parseFloat(entry[4]));  // Closing prices
  const sum = prices.reduce((acc, price) => acc + price, 0);
  return sum / period;
}

// Place buy/sell order
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

    const historicalData = await fetchHistoricalData();

    // Calculate Short and Long Term SMA
    const shortSMA = calculateSMA(historicalData, SMA_PERIOD_SHORT);
    const longSMA = calculateSMA(historicalData, SMA_PERIOD_LONG);
    console.log(`Short SMA: ${shortSMA}, Long SMA: ${longSMA}`);

    if (!lastBuyPrice) {
      console.log("First buy since no last price. Placing buy order...");
      await placeOrder("buy", TRADE_AMOUNT);
      lastBuyPrice = marketPrice;
    } else {
      const buyThreshold = lastBuyPrice * (1 - BUY_PERCENTAGE_DROP / 100);
      const sellThreshold = lastBuyPrice * (1 + SELL_PERCENTAGE_RISE / 100);

      if (marketPrice <= buyThreshold && shortSMA < longSMA) {
        // If the market is trending downward and the price drops 2%, buy
        console.log(`Price dropped ${BUY_PERCENTAGE_DROP}%. Buying ${TRADE_AMOUNT} XRP...`);
        await placeOrder("buy", TRADE_AMOUNT);
        lastBuyPrice = marketPrice;
      } else if (marketPrice >= sellThreshold && shortSMA > longSMA) {
        // If the market is trending upward and the price increases 2%, sell
        console.log(`Price increased ${SELL_PERCENTAGE_RISE}%. Selling ${TRADE_AMOUNT} XRP...`);
        await placeOrder("sell", TRADE_AMOUNT);
        lastBuyPrice = null;
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
