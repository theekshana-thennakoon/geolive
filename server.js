const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const db = require('./database');
const mailer = require('./mailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Page Routes (Clean URLs without .html)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/user', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));

// ==========================================
// REST API ROUTES
// ==========================================

// Step 1: Send OTP to User's Email
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email address, and password are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address (e.g. user@gmail.com)' });
    }

    // Check if email already registered
    if (db.findUserByEmail(email)) {
      return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please login instead.' });
    }

    // Check if phone already registered
    if (phone && db.findUserByPhone(phone)) {
      return res.status(400).json({ success: false, error: 'An account with this phone or username already exists' });
    }

    // Generate 6-digit OTP and store temporary registration data
    const otp = mailer.generateOTP(email, { name, email, phone, password });
    const sendResult = await mailer.sendOTPEmail(email, otp, name);

    res.json({
      success: true,
      message: `A 6-digit verification code was sent to ${email}`,
      devOtp: sendResult.otp // Available in development/console fallback
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Step 2: Verify OTP and Create Account
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and 6-digit verification code are required' });
    }

    const verification = mailer.verifyOTP(email, otp);
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    const { name, phone, password } = verification.userData;
    const newUser = db.createUser({ name, email, phone, password, role: 'user' });

    // Broadcast new user to admin room
    io.to('admin').emit('user:registered', {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      createdAt: newUser.createdAt,
      lastSeen: newUser.lastSeen,
      isOnline: false,
      location: null
    });

    res.json({
      success: true,
      message: 'Email successfully verified! Your account is active.',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Direct register fallback (if needed)
app.post('/api/auth/register', (req, res) => {
  res.status(400).json({ success: false, error: 'Please use /api/auth/send-otp to verify your email first' });
});

// Login (Supports Email OR Phone / Username)
app.post('/api/auth/login', (req, res) => {
  try {
    const loginId = req.body.login || req.body.phone || req.body.email;
    const { password } = req.body;
    
    if (!loginId || !password) {
      return res.status(400).json({ success: false, error: 'Email/username and password are required' });
    }

    const user = db.findUserByLogin(loginId);
    if (!user || !db.verifyPassword(user, password)) {
      return res.status(401).json({ success: false, error: 'Invalid email/username or password' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Location Update (Called by Web browser or Kodular mobile app)
app.post('/api/location/update', (req, res) => {
  try {
    const { userId, latitude, longitude, accuracy, speed, heading } = req.body;
    if (!userId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'userId, latitude, and longitude are required' });
    }

    const result = db.updateLocation(userId, { latitude, longitude, accuracy, speed, heading });

    // Real-time broadcast to Admin and User tracking rooms
    io.to('admin').emit('location:updated', result.user);
    io.to(`track_${userId}`).emit('location:updated', result.user);

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: result.user
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get All Users (Admin)
app.get('/api/users', (req, res) => {
  try {
    const users = db.getAllUsers();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Single User Info & Location
app.get('/api/user/:id', (req, res) => {
  try {
    const user = db.findUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const now = Date.now();
    const lastSeenMs = user.lastSeen ? new Date(user.lastSeen).getTime() : 0;
    const isOnline = (now - lastSeenMs) < 60000;

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        lastSeen: user.lastSeen,
        isOnline,
        location: user.location
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get User History
app.get('/api/user/:id/history', (req, res) => {
  try {
    const history = db.getUserHistory(req.params.id, 50);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete User (Admin)
app.delete('/api/users/:id', (req, res) => {
  try {
    db.deleteUser(req.params.id);
    io.to('admin').emit('user:deleted', { id: req.params.id });
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// SOCKET.IO REALTIME EVENTS
// ==========================================
io.on('connection', (socket) => {
  // Join admin room
  socket.on('join:admin', () => {
    socket.join('admin');
  });

  // Join specific user room for tracking
  socket.on('join:track', (userId) => {
    if (userId) {
      socket.join(`track_${userId}`);
    }
  });

  // Direct socket location update from user
  socket.on('location:send', (data) => {
    try {
      const { userId, latitude, longitude, accuracy, speed, heading } = data;
      if (!userId || latitude === undefined || longitude === undefined) return;

      const result = db.updateLocation(userId, { latitude, longitude, accuracy, speed, heading });
      io.to('admin').emit('location:updated', result.user);
      io.to(`track_${userId}`).emit('location:updated', result.user);
    } catch (e) {
      console.error('Socket location error:', e.message);
    }
  });
});

// Global Error Handling Middleware (Handles invalid JSON, etc.)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON payload sent in request body' });
  }
  console.error('Unhandled server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Live Location Tracking Server Started!`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`👤 User Panel: http://localhost:${PORT}/user`);
  console.log(`🛡️ Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`🔑 Default Admin: user="admin" / pass="admin123"`);
  console.log(`===============================================`);
});
