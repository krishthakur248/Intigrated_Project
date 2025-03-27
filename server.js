const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect("mongodb+srv://ananabababa05:krish@cluster0.gmel6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// User Schema
const UserSchema = new mongoose.Schema({
  username: String,
  email: { type: String, unique: true, required: true },  // Email must be unique and required
  password: String,
});

const User = mongoose.model("User", UserSchema);

// Signup Route
app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;

  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
      const existingUser = await User.findOne({ email }); // Check if user exists

      if (existingUser) {
          return res.status(400).json({ message: "User already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = new User({ username, email, password: hashedPassword });
      await newUser.save();

      res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Login Route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  // Check if user exists
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: "User not found" });

  // Compare passwords
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

  // Generate token
  const token = jwt.sign({ userId: user._id }, "secret_key", { expiresIn: "1h" });

  res.json({ message: "Login successful", token });
});

// Start Server
app.listen(5000, () => console.log("Server running on port 5000"));
