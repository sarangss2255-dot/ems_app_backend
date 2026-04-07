const User = require("../models/user");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET || "change_this";
const TOKEN_EXPIRES = process.env.TOKEN_EXPIRES_IN || "24h";

async function register(req, res) {
  const { username, password, fullName, role, rollNumber, className } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username/password required" });
  try {
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: "username exists" });
    const allowedRole = ["admin", "teacher", "student"].includes(role) ? role : "student";
    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hash, fullName, role: allowedRole, rollNumber, className });
    await user.save();
    res.json({ ok: true, id: user._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function login(req, res) {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });
    const payload = { sub: user._id, username: user.username, role: user.role };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES });
    res.json({ accessToken: token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { register, login };
