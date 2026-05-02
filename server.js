const express = require('express');
const mongoose = require('mongoose');
const redis = require('redis');

const app = express();
app.use(express.json());

const PORT = 8080;

// Redis client — credentials from Vault
let redisClient;

async function connectRedis() {
  redisClient = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6380'),
      tls: true
    },
    password: process.env.REDIS_PASSWORD
  });
  redisClient.on('error', (err) => console.error('Redis error:', err));
  await redisClient.connect();
  console.log('Connected to Redis');
}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    setTimeout(connectDB, 5000);
  }
}

// Cart schema in MongoDB (persistent cart)
const cartSchema = new mongoose.Schema({
  userId:    String,
  items:     Array,
  updatedAt: { type: Date, default: Date.now }
});
const Cart = mongoose.model('Cart', cartSchema);

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'cart' });
});

app.get('/cart/:userId', async (req, res) => {
  try {
    // Check Redis first (fast)
    const cached = await redisClient.get(`cart:${req.params.userId}`);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    // Fall back to MongoDB
    const cart = await Cart.findOne({ userId: req.params.userId });
    if (!cart) return res.json({ userId: req.params.userId, items: [] });
    // Cache in Redis for 1 hour
    await redisClient.setEx(
      `cart:${req.params.userId}`,
      3600,
      JSON.stringify(cart)
    );
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/cart/:userId', async (req, res) => {
  try {
    const { productId, name, price, qty } = req.body;
    let cart = await Cart.findOne({ userId: req.params.userId });
    if (!cart) {
      cart = new Cart({ userId: req.params.userId, items: [] });
    }
    const existingItem = cart.items.find(i => i.productId === productId);
    if (existingItem) {
      existingItem.qty += qty;
    } else {
      cart.items.push({ productId, name, price, qty });
    }
    cart.updatedAt = new Date();
    await cart.save();
    // Invalidate Redis cache
    await redisClient.del(`cart:${req.params.userId}`);
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/cart/:userId', async (req, res) => {
  try {
    await Cart.deleteOne({ userId: req.params.userId });
    await redisClient.del(`cart:${req.params.userId}`);
    res.json({ message: 'Cart cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  await connectDB();
  await connectRedis();
  app.listen(PORT, () => {
    console.log(`Cart service running on port ${PORT}`);
    console.log(`Environment: ${process.env.APP_ENV || 'dev'}`);
  });
}

start();