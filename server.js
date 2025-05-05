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

// Course Schema
const CourseSchema = new mongoose.Schema({
  courseTitle: { type: String, required: true },
  instructorName: { type: String, required: true },
  skillCategory: { type: String, required: true },
  skillLevel: { type: String, required: true },
  courseDescription: { type: String, required: true },
  maxStudents: { type: Number, required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

// Enrollment Schema
const EnrollmentSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  enrollmentDate: { type: Date, default: Date.now }
});

// Define indexes to prevent duplicate enrollments
EnrollmentSchema.index({ course: 1, student: 1 }, { unique: true });

// Create models
const User = mongoose.model("User", UserSchema);
const Course = mongoose.model("Course", CourseSchema);
const Enrollment = mongoose.model("Enrollment", EnrollmentSchema);

// Delete related data when user is deleted
UserSchema.pre('findOneAndDelete', async function (next) {
  const user = await this.model.findOne(this.getFilter());

  if (user) {
    // Delete user's courses
    await Course.deleteMany({ creator: user._id });

    // Delete user's enrollments
    await Enrollment.deleteMany({ student: user._id });
  }

  next();
});

// Middleware to verify token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided." });
  }

  try {
    const decoded = jwt.verify(token, "secret_key");
    req.user = decoded;
    next();
  } catch (error) {
    console.error("Token error:", error.message);
    res.status(400).json({ message: "Invalid token." });
  }
};

// Signup Route
app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;

  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    const existingUser = await User.findOne({ email });

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

// Get User Profile
app.get("/user/profile", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error in /user/profile:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// COURSE ROUTES

// Create a new course
app.post("/courses", verifyToken, async (req, res) => {
  try {
    const { courseTitle, instructorName, skillCategory, skillLevel, courseDescription, maxStudents } = req.body;

    const newCourse = new Course({
      courseTitle,
      instructorName,
      skillCategory,
      skillLevel,
      courseDescription,
      maxStudents: parseInt(maxStudents),
      creator: req.user.userId
    });

    await newCourse.save();
    res.status(201).json({ message: "Course created successfully", course: newCourse });
  } catch (error) {
    res.status(500).json({ message: "Failed to create course", error: error.message });
  }
});

// Get all courses
app.get("/courses", async (req, res) => {
  try {
    const courses = await Course.find().populate('creator', 'username email');
    res.json(courses);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch courses", error: error.message });
  }
});

// Get courses created by logged-in user
app.get("/courses/my-courses", verifyToken, async (req, res) => {
  try {
    const courses = await Course.find({ creator: req.user.userId });
    res.json(courses);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch your courses", error: error.message });
  }
});

// Delete a course (only by creator)
app.delete("/courses/:id", verifyToken, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Check if user is the creator of the course
    if (course.creator.toString() !== req.user.userId) {
      return res.status(403).json({ message: "Not authorized to delete this course" });
    }

    // Delete the course
    await Course.findByIdAndDelete(req.params.id);

    // Delete all enrollments for this course
    await Enrollment.deleteMany({ course: req.params.id });

    res.json({ message: "Course deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete course", error: error.message });
  }
});

// ENROLLMENT ROUTES

// Enroll in a course
app.post("/enrollments", verifyToken, async (req, res) => {
  try {
    const { courseId } = req.body;

    // Check if course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Check if user is trying to enroll in their own course
    if (course.creator.toString() === req.user.userId) {
      return res.status(400).json({ message: "You cannot enroll in your own course" });
    }

    // Check if enrollment limit is reached
    const enrollmentCount = await Enrollment.countDocuments({ course: courseId });
    if (enrollmentCount >= course.maxStudents) {
      return res.status(400).json({ message: "Course is already full" });
    }

    // Check if user is already enrolled
    const existingEnrollment = await Enrollment.findOne({
      course: courseId,
      student: req.user.userId
    });

    if (existingEnrollment) {
      return res.status(400).json({ message: "You are already enrolled in this course" });
    }

    // Create new enrollment
    const newEnrollment = new Enrollment({
      course: courseId,
      student: req.user.userId
    });

    await newEnrollment.save();

    res.status(201).json({ message: "Enrolled successfully", enrollment: newEnrollment });
  } catch (error) {
    res.status(500).json({ message: "Failed to enroll in course", error: error.message });
  }
});

// Get enrollments for logged-in user
app.get("/enrollments/my-enrollments", verifyToken, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ student: req.user.userId })
      .populate('course');

    res.json(enrollments);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch enrollments", error: error.message });
  }
});

// Get enrollment count for a course
app.get("/courses/:id/enrollment-count", async (req, res) => {
  try {
    const count = await Enrollment.countDocuments({ course: req.params.id });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Failed to get enrollment count", error: error.message });
  }
});

// Unenroll from a course
app.delete("/enrollments/:courseId", verifyToken, async (req, res) => {
  try {
    const result = await Enrollment.findOneAndDelete({
      course: req.params.courseId,
      student: req.user.userId
    });

    if (!result) {
      return res.status(404).json({ message: "Enrollment not found" });
    }

    res.json({ message: "Unenrolled successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to unenroll from course", error: error.message });
  }
});

app.delete("/cleanup-orphaned-sessions", async (req, res) => {
  try {
    const sessions = await Session.find().populate('creator');
    const orphaned = sessions.filter(s => !s.creator);

    const idsToDelete = orphaned.map(s => s._id);
    await Session.deleteMany({ _id: { $in: idsToDelete } });

    res.json({ message: `Deleted ${idsToDelete.length} orphaned sessions` });
  } catch (error) {
    res.status(500).json({ message: "Cleanup failed", error: error.message });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

app.get("/ping", (req, res) => {
  res.send("pong");
});