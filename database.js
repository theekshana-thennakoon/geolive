const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const firebase = require('./firebase');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial DB state
const initialData = {
  users: [
    {
      id: 'admin-1',
      name: 'System Administrator',
      phone: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      location: null
    }
  ],
  locations: []
};

// Load or initialize DB
function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      saveDB(initialData);
      return initialData;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.users) parsed.users = [];
    if (!parsed.locations) parsed.locations = [];
    
    // Ensure default admin exists
    const hasAdmin = parsed.users.some(u => u.phone === 'admin');
    if (!hasAdmin) {
      parsed.users.unshift(initialData.users[0]);
      saveDB(parsed);
    }
    return parsed;
  } catch (err) {
    console.error('Error reading database, resetting:', err);
    saveDB(initialData);
    return initialData;
  }
}

// Save DB atomically
function saveDB(data) {
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempFile, DB_FILE);
}

const db = {
  // User operations
  findUserByLogin(identifier) {
    if (!identifier) return null;
    const term = identifier.trim().toLowerCase();
    const data = loadDB();
    return data.users.find(u => 
      (u.email && u.email.toLowerCase() === term) || 
      (u.phone && u.phone.toLowerCase() === term)
    );
  },

  findUserByPhone(phone) {
    if (!phone) return null;
    const data = loadDB();
    return data.users.find(u => u.phone && u.phone.toLowerCase() === phone.trim().toLowerCase());
  },

  findUserByEmail(email) {
    if (!email) return null;
    const data = loadDB();
    return data.users.find(u => u.email && u.email.toLowerCase() === email.trim().toLowerCase());
  },

  findUserById(id) {
    const data = loadDB();
    return data.users.find(u => u.id === id);
  },

  createUser({ name, email, phone, password, role = 'user' }) {
    const data = loadDB();
    
    // Check if email already taken
    if (email) {
      const existingEmail = data.users.find(u => u.email && u.email.toLowerCase() === email.trim().toLowerCase());
      if (existingEmail) {
        throw new Error('An account with this email address already exists');
      }
    }

    // Check if phone/username already taken
    if (phone) {
      const existingPhone = data.users.find(u => u.phone && u.phone.toLowerCase() === phone.trim().toLowerCase());
      if (existingPhone) {
        throw new Error('An account with this phone or username already exists');
      }
    }

    const newUser = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: email ? email.trim().toLowerCase() : null,
      phone: phone ? phone.trim() : (email ? email.trim().toLowerCase() : ''),
      passwordHash: bcrypt.hashSync(password, 10),
      role,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      location: null
    };

    data.users.push(newUser);
    saveDB(data);

    // Sync to Firebase if connected
    firebase.saveUser(newUser).catch(err => console.error('Firebase sync error:', err));

    return newUser;
  },

  createOrLoginGoogleUser({ name, email, googleId = null, photoUrl = null }) {
    if (!email) throw new Error('Google account email is required');
    const data = loadDB();
    const normalizedEmail = email.trim().toLowerCase();
    const userIndex = data.users.findIndex(u => u.email && u.email.toLowerCase() === normalizedEmail);

    if (userIndex !== -1) {
      const existing = data.users[userIndex];
      existing.lastSeen = new Date().toISOString();
      if (googleId) existing.googleId = googleId;
      if (photoUrl) existing.photoUrl = photoUrl;
      saveDB(data);
      firebase.saveUser(existing).catch(err => console.error('Firebase sync error:', err));
      return { user: existing, isNew: false };
    }

    const newUser = {
      id: crypto.randomUUID(),
      name: (name || normalizedEmail.split('@')[0]).trim(),
      email: normalizedEmail,
      phone: normalizedEmail.split('@')[0],
      passwordHash: null,
      googleId,
      photoUrl,
      role: 'user',
      authProvider: 'google',
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      location: null
    };

    data.users.push(newUser);
    saveDB(data);
    firebase.saveUser(newUser).catch(err => console.error('Firebase sync error:', err));
    return { user: newUser, isNew: true };
  },

  verifyPassword(user, password) {
    if (!user.passwordHash) return false;
    return bcrypt.compareSync(password, user.passwordHash);
  },

  getAllUsers() {
    const data = loadDB();
    const now = Date.now();
    return data.users
      .filter(u => u.role !== 'admin')
      .map(u => {
        const lastSeenMs = u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
        // Considered online if updated within last 60 seconds
        const isOnline = (now - lastSeenMs) < 60000;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          createdAt: u.createdAt,
          lastSeen: u.lastSeen,
          isOnline,
          location: u.location
        };
      });
  },

  // Location update
  updateLocation(userId, { latitude, longitude, accuracy = null, speed = null, heading = null }) {
    const data = loadDB();
    const userIndex = data.users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
      throw new Error('User not found');
    }

    const nowIso = new Date().toISOString();
    const locRecord = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: accuracy !== null ? parseFloat(accuracy) : null,
      speed: speed !== null ? parseFloat(speed) : null,
      heading: heading !== null ? parseFloat(heading) : null,
      updatedAt: nowIso
    };

    data.users[userIndex].location = locRecord;
    data.users[userIndex].lastSeen = nowIso;

    // Also store in history (limit history to 100 entries per user to conserve disk space)
    if (!data.locations) data.locations = [];
    data.locations.push({
      userId,
      ...locRecord
    });

    // Prune history older than 5000 entries total
    if (data.locations.length > 5000) {
      data.locations = data.locations.slice(-3000);
    }

    saveDB(data);

    // Sync to Firebase if connected
    firebase.updateLocation(userId, locRecord).catch(err => console.error('Firebase location sync error:', err));

    return {
      user: {
        id: data.users[userIndex].id,
        name: data.users[userIndex].name,
        phone: data.users[userIndex].phone,
        lastSeen: nowIso,
        isOnline: true,
        location: locRecord
      }
    };
  },

  getUserHistory(userId, limit = 200) {
    const data = loadDB();
    const list = (data.locations || []).filter(l => l.userId === userId);
    if (list.length === 0) {
      const user = data.users.find(u => u.id === userId);
      if (user && user.location && user.location.latitude) {
        return [{
          userId,
          ...user.location
        }];
      }
      return [];
    }
    return list.slice(-limit);
  },

  deleteUser(userId) {
    const data = loadDB();
    data.users = data.users.filter(u => u.id !== userId);
    data.locations = (data.locations || []).filter(l => l.userId !== userId);
    saveDB(data);
    return true;
  }
};

module.exports = db;
