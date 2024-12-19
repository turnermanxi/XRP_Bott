const axios = require("axios");
require("dotenv").config();
const crypto = require("crypto");

// API credentials
const API_KEY = process.env.KRAKEN_API_KEY;
const API_SECRET = process.env.KRAKEN_API_SECRET;

// Kraken API configuration
const KRAKEN_API_URL = "https://api.kraken.com";
const KRAKEN_API_VERSION = "/0";

// Trading parameters
const TRADE_PAIR = "XXRPZUSD"; // XRP/USD trading pair
const TRADE_AMOUNT = 15; // Amount of XRP to trade
let BUY_PERCENTAGE_DROP = 0.75; // Default buy threshold
let SELL_PERCENTAGE_RISE = 2; // Default sell threshold

const SHARP_UPWARD_THRESHOLD = 3; // % increase for sharp upward trend
const SHARP_DOWNWARD_THRESHOLD = 3; // % decrease for sharp downward trend
const SMA_PERIOD_SHORT = 14;
const SMA_PERIOD_LONG = 50;

let lastBuyPrice = null;

// Function to create Kraken API headers
function createKrakenHeaders(path, body, nonce) {
  const postData = `${nonce}${body}`;
  const hash = crypto.createHash("sha256").update(postData).digest("binary");
  const secretBuffer = Buffer.from(API_SECRET, "base64");
  const hmac = crypto
    .createHmac("sha512", secretBuffer)
    .update(path + hash, "binary")
    .digest("base64");

  return {
    "API-Key": API_KEY,
    "API-Sign": hmac,
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

// Fetch historical market data
async function fetchHistoricalData() {
  const response = await axios.get(
    `${KRAKEN_API_URL}${KRAKEN_API_VERSION}/public/OHLC?pair=${TRADE_PAIR}&interval=5`
  );
  return response.data.result[TRADE_PAIR];
}

// Calculate Simple Moving Average (SMA)
function calculateSMA(data, period) {
  const prices = data.slice(-period).map(entry => parseFloat(entry[4])); // Closing prices
  const sum = prices.reduce((acc, price) => acc + price, 0);
  return sum / period;
}

// Analyze trend based on price changes
function analyzeTrend(historicalData) {
  const prices = historicalData.map(entry => parseFloat(entry[4])); // Closing prices
  const latestPrice = prices[prices.length - 1];
  const previousPrice = prices[prices.length - 2];
  const percentageChange = ((latestPrice - previousPrice) / previousPrice) * 100;

  if (percentageChange >= SHARP_UPWARD_THRESHOLD) {
    return "sharp_up";
  } else if (percentageChange <= -SHARP_DOWNWARD_THRESHOLD) {
    return "sharp_down";
  }
  return "stabilized";
}

// Adjust trading strategy based on trend
function adjustStrategy(trend) {
  if (trend === "sharp_up") {
    BUY_PERCENTAGE_DROP = 0.5;
    SELL_PERCENTAGE_RISE = 4;
    console.log("Trend detected: Sharp Up. Adjusting strategy to 0.5:4.");
  } else if (trend === "sharp_down") {
    BUY_PERCENTAGE_DROP = 3;
    SELL_PERCENTAGE_RISE = 2;
    console.log("Trend detected: Sharp Down. Adjusting strategy to 3:2.");
  } else {
    BUY_PERCENTAGE_DROP = 0.75;
    SELL_PERCENTAGE_RISE = 2;
    console.log("Trend detected: Stabilized. Using default 0.75:2 strategy.");
  }
}

let lastNonce = 0;

function getNonce() {
  const newNonce = Date.now() * 1000;
  if (newNonce <= lastNonce) {
    return lastNonce + 1;
  }
  lastNonce = newNonce;
  return newNonce;
}

// Place buy/sell order
async function placeOrder(orderType, volume, price = null) {
  const nonce = getNonce();

  const orderDetails = {
    nonce: nonce.toString(),
    ordertype: price ? "limit" : "market",
    type: orderType,
    volume: volume.toString(),
    pair: TRADE_PAIR,
  };

  if (price) orderDetails.price = price;

  const body = Object.entries(orderDetails)
    .map(([key, val]) => `${key}=${encodeURIComponent(val)}`)
    .join("&");

  const headers = createKrakenHeaders("/0/private/AddOrder", body, nonce);

  try {
    const response = await axios.post(
      `${KRAKEN_API_URL}${KRAKEN_API_VERSION}/private/AddOrder`,
      body,
      { headers }
    );
    console.log(`${orderType.toUpperCase()} order placed:`, response.data);
  } catch (error) {
    console.error(
      `${orderType.toUpperCase()} order failed:`,
      error.response?.data?.error || error.message
    );
  }
}

// Main trading bot logic
async function main() {
  try {
    console.log("Fetching current market price...");
    const marketPrice = await fetchMarketPrice();
    console.log(`Market Price: $${marketPrice}`);

    const historicalData = await fetchHistoricalData();

    // Calculate SMAs
    const shortSMA = calculateSMA(historicalData, SMA_PERIOD_SHORT);
    const longSMA = calculateSMA(historicalData, SMA_PERIOD_LONG);
    console.log(`Short SMA: ${shortSMA}, Long SMA: ${longSMA}`);

    // Determine market trend and adjust strategy
    const trend = analyzeTrend(historicalData);
    adjustStrategy(trend);

    // Trading logic
    const buyThreshold = lastBuyPrice
      ? lastBuyPrice * (1 - BUY_PERCENTAGE_DROP / 100)
      : marketPrice * (1 - BUY_PERCENTAGE_DROP / 100);
    const sellThreshold = lastBuyPrice
      ? lastBuyPrice * (1 + SELL_PERCENTAGE_RISE / 100)
      : marketPrice * (1 + SELL_PERCENTAGE_RISE / 100);

    if (!lastBuyPrice) {
      console.log("First buy since no last price. Placing buy order...");
      await placeOrder("buy", TRADE_AMOUNT);
      lastBuyPrice = marketPrice;
    } else if (marketPrice <= buyThreshold && shortSMA < longSMA) {
      console.log(`Price dropped ${BUY_PERCENTAGE_DROP}%. Buying ${TRADE_AMOUNT} XRP...`);
      await placeOrder("buy", TRADE_AMOUNT);
      lastBuyPrice = marketPrice;
    } else if (marketPrice >= sellThreshold && shortSMA > longSMA) {
      console.log(`Price increased ${SELL_PERCENTAGE_RISE}%. Selling ${TRADE_AMOUNT} XRP...`);
      await placeOrder("sell", TRADE_AMOUNT);
      lastBuyPrice = null;
    } else {
      console.log("No trade action required.");
    }
  } catch (err) {
    console.error("Error in trading bot:", err);
  }
}

// Run the bot in intervals (e.g., every 30 seconds)
setInterval(main, 30000);
