const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect("mongodb+srv://tkrish552:krish@cluster0.oo5xi.mongodb.net/sample_mflix?retryWrites=true&w=majority&appName=Cluster0", {
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

      const newUser = new User({ username, email, password });
      await newUser.save();

      res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
  }
});
app.delete("/delete-all-users", async (req, res) => {
  try {
      await User.deleteMany({});
      res.json({ message: "All users deleted" });
  } catch (error) {
      res.status(500).json({ message: "Error deleting users", error: error.message });
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
