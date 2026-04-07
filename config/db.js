const mongoose = require("mongoose");
require("dotenv").config();

async function connectDB() {
  const DB_URI = process.env.DB_URI || process.env.MONGO_URI;
  if (!DB_URI) {
    throw new Error("DB_URI (or MONGO_URI) is not set in environment");
  }

  try {
    await mongoose.connect(DB_URI);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error.message);
    process.exit(1);
  }
}

module.exports = connectDB;
