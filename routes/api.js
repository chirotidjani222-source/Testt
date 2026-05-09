'use strict';

const fetch = require('node-fetch'); // or use https module
const crypto = require('crypto');
const mongoose = require('mongoose')

// --- DB Schema ---
const stockSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  likes: { type: [String], default: [] } // stores anonymized IPs
});
const Stock = mongoose.model('Stock', stockSchema);

// --- Helper: anonymize IP ---
function anonymizeIP(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// --- Helper: fetch stock price from proxy ---
async function getStockPrice(symbol) {
  const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${symbol}/quote`;
  const res = await fetch(url);
  const data = await res.json();
  return {
    stock: symbol.toUpperCase(),
    price: data.latestPrice ?? data.close ?? 0
  };
}


module.exports = function (app) {

  app.route('/api/stock-prices')
    .get(async function (req, res) {
      let { stock, like } = req.query;
      const shouldLike = like === 'true';

      // Anonymize the user's IP
      const rawIP = req.ip || req.headers['x-forwarded-for'] || '0.0.0.0';
      const anonIP = anonymizeIP(rawIP);

      try {
        // ---- SINGLE STOCK ----
        if (!Array.isArray(stock)) {
          const symbol = stock.toUpperCase();
          const { price } = await getStockPrice(symbol);

          let stockDoc = await Stock.findOne({ symbol });
          if (!stockDoc) stockDoc = new Stock({ symbol, likes: [] });

          if (shouldLike && !stockDoc.likes.includes(anonIP)) {
            stockDoc.likes.push(anonIP);
          }
          await stockDoc.save();

          return res.json({
            stockData: {
              stock: symbol,
              price,
              likes: stockDoc.likes.length
            }
          });
        }

        // ---- TWO STOCKS ----
        if (stock.length === 2) {
          const [sym1, sym2] = stock.map(s => s.toUpperCase());

          const [data1, data2] = await Promise.all([
            getStockPrice(sym1),
            getStockPrice(sym2)
          ]);

          let [doc1, doc2] = await Promise.all([
            Stock.findOne({ symbol: sym1 }),
            Stock.findOne({ symbol: sym2 })
          ]);

          if (!doc1) doc1 = new Stock({ symbol: sym1, likes: [] });
          if (!doc2) doc2 = new Stock({ symbol: sym2, likes: [] });

          if (shouldLike) {
            if (!doc1.likes.includes(anonIP)) doc1.likes.push(anonIP);
            if (!doc2.likes.includes(anonIP)) doc2.likes.push(anonIP);
          }

          await Promise.all([doc1.save(), doc2.save()]);

          const rel_likes1 = doc1.likes.length - doc2.likes.length;
          const rel_likes2 = doc2.likes.length - doc1.likes.length;

          return res.json({
            stockData: [
              { stock: sym1, price: data1.price, rel_likes: rel_likes1 },
              { stock: sym2, price: data2.price, rel_likes: rel_likes2 }
            ]
          });
        }

      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error fetching stock data' });
      }
    });
};