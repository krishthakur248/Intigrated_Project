const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

// JWT Secret - should be in environment variables in production
const JWT_SECRET = "secret_key";

// Create HTTP server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active connections
const activeConnections = new Map();

// Connect to MongoDB
mongoose.connect("mongodb+srv://ananabababa05:krish@cluster0.gmel6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const messageSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['chat', 'system'],
    default: 'chat'
  }
});

const Message = mongoose.model('Message', messageSchema);

// User Schema
const UserSchema = new mongoose.Schema({
  username: String,
  email: { type: String, unique: true, required: true },
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
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("Token error:", error.message);
    res.status(400).json({ message: "Invalid token." });
  }
};

// WebSocket connection handler
wss.on('connection', function connection(ws, req) {
  // Extract courseId and token from URL
  const url = new URL(req.url, 'http://localhost');
  const urlParts = url.pathname.split('/');
  const courseId = urlParts[urlParts.length - 1];
  const token = url.searchParams.get('token');

  // Verify token
  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      ws.close();
      return;
    }

    const userId = decoded.userId;

    try {
      // Get user info
      const user = await User.findById(userId).select("username");

      if (!user) {
        ws.close();
        return;
      }

      // Store connection with user and course info
      if (!activeConnections.has(courseId)) {
        activeConnections.set(courseId, new Map());
      }
      activeConnections.get(courseId).set(userId, ws);

      // Send initial presence message
      broadcastToCourse(courseId, {
        type: 'presence',
        userId: userId,
        action: 'join'
      });

      // System message for user joining
      const joinMessage = new Message({
        courseId: courseId,
        sender: userId,
        content: `${user.username} has joined the chat`,
        timestamp: new Date(),
        type: 'system'
      });

      await joinMessage.save();

      broadcastToCourse(courseId, {
        type: 'system',
        content: `${user.username} has joined the chat`,
        timestamp: new Date().toISOString()
      });

      // Handle incoming messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);

          // Handle message based on type
          switch (message.type) {
            case 'chat':
              // Save message to database
              const newMessage = new Message({
                courseId: message.courseId,
                sender: userId,
                content: message.content,
                timestamp: new Date(),
                type: 'chat'
              });

              const savedMessage = await newMessage.save();

              // Broadcast to all users in course
              broadcastToCourse(courseId, {
                type: 'chat',
                _id: savedMessage._id.toString(),
                courseId: savedMessage.courseId.toString(),
                content: savedMessage.content,
                timestamp: savedMessage.timestamp.toISOString(),
                sender: {
                  _id: userId,
                  username: message.sender.username
                }
              });
              break;

            case 'presence':
              // Broadcast presence update
              broadcastToCourse(courseId, {
                type: 'presence',
                userId: userId,
                action: message.action
              });
              break;
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      });

      // Handle disconnection
      ws.on('close', async () => {
        // Remove from active connections
        if (activeConnections.has(courseId)) {
          activeConnections.get(courseId).delete(userId);

          // If no users left in course, delete course entry
          if (activeConnections.get(courseId).size === 0) {
            activeConnections.delete(courseId);
          }
        }

        // Broadcast leave message
        broadcastToCourse(courseId, {
          type: 'presence',
          userId: userId,
          action: 'leave'
        });

        // Add system message for user leaving
        try {
          const leaveMessage = new Message({
            courseId: courseId,
            sender: userId,
            content: `${user.username} has left the chat`,
            timestamp: new Date(),
            type: 'system'
          });

          await leaveMessage.save();

          broadcastToCourse(courseId, {
            type: 'system',
            content: `${user.username} has left the chat`,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error('Error saving leave message:', error);
        }
      });

    } catch (error) {
      console.error('WebSocket error:', error);
      ws.close();
    }
  });
});

// Function to broadcast messages to all users in a course
function broadcastToCourse(courseId, message) {
  if (!activeConnections.has(courseId)) return;

  const connections = activeConnections.get(courseId);
  connections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

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

  try {
    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    // Generate token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "1d" });

    res.json({ message: "Login successful", token });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
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
    console.error("Error fetching my courses:", error);
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

// Get course messages
app.get('/courses/:courseId/messages', verifyToken, async (req, res) => {
  try {
    const messages = await Message.find({ courseId: req.params.courseId })
      .sort({ timestamp: 1 })
      .populate('sender', 'username')
      .lean();

    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get course members
app.get('/courses/:courseId/members', verifyToken, async (req, res) => {
  try {
    // Find all enrollments for this course
    const enrollments = await Enrollment.find({ course: req.params.courseId })
      .populate('student', 'username email')
      .lean();

    // Get the course to find the creator
    const course = await Course.findById(req.params.courseId)
      .populate('creator', 'username email')
      .lean();

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Extract students from enrollments
    const students = enrollments.map(enrollment => enrollment.student);

    // Combine students as members and add online status
    const members = students.map(student => ({
      ...student,
      online: activeConnections.get(req.params.courseId)?.has(student._id.toString()) || false
    }));

    res.json(members);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get specific course by ID
app.get('/courses/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('creator', 'username email');

    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    res.json(course);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch course', error: error.message });
  }
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

// Start the server with WebSocket support
server.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});