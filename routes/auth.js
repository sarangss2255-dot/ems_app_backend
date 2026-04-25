const express = require("express");
const router = express.Router();
const { register, login } = require("../controllers/authController");

// Simple in-memory rate limiter
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits) {
    if (now > record.resetAt) {
      rateLimits.delete(key);
    }
  }
}, 5 * 60 * 1000);

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const key = `${ip}:${req.path}`;

  const record = rateLimits.get(key);
  if (!record) {
    rateLimits.set(key, { attempts: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (now > record.resetAt) {
    rateLimits.set(key, { attempts: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Too many attempts. Try again later." });
  }

  record.attempts++;
  next();
}

router.post("/register", rateLimit, register);
router.post("/login", rateLimit, login);

module.exports = router;