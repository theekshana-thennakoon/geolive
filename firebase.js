const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'serviceAccountKey.json');
let db = null;
let isFirebaseConnected = false;

// Check if serviceAccountKey.json exists
if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));

    // Initialize Firebase Admin
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: serviceAccount.databaseURL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });

    // Firestore instance
    db = admin.firestore();
    isFirebaseConnected = true;
    console.log(`🔥 Firebase Firestore successfully connected! Project: ${serviceAccount.project_id}`);
  } catch (err) {
    console.error('⚠️ Error initializing Firebase:', err.message);
  }
} else {
  console.log('ℹ️ serviceAccountKey.json not found. Set it up to store data directly in Firebase Cloud.');
}

const firebaseService = {
  isConnected() {
    return isFirebaseConnected;
  },

  // Save/Update user in Firestore
  async saveUser(user) {
    if (!isFirebaseConnected) return null;
    try {
      await db.collection('users').doc(user.id).set({
        id: user.id,
        name: user.name,
        email: user.email || null,
        phone: user.phone,
        role: user.role || 'user',
        createdAt: user.createdAt || new Date().toISOString(),
        lastSeen: user.lastSeen || new Date().toISOString(),
        location: user.location || null
      }, { merge: true });
      return true;
    } catch (e) {
      console.error('Firebase saveUser error:', e.message);
      return false;
    }
  },

  // Update live GPS location
  async updateLocation(userId, locationData) {
    if (!isFirebaseConnected) return null;
    try {
      const nowIso = new Date().toISOString();
      const batch = db.batch();

      // Update current location in users collection
      const userRef = db.collection('users').doc(userId);
      batch.update(userRef, {
        location: {
          ...locationData,
          updatedAt: nowIso
        },
        lastSeen: nowIso
      });

      // Add to location_history collection
      const historyRef = db.collection('location_history').doc();
      batch.set(historyRef, {
        userId,
        ...locationData,
        timestamp: nowIso
      });

      await batch.commit();
      return true;
    } catch (e) {
      console.error('Firebase updateLocation error:', e.message);
      return false;
    }
  },

  // Get all users from Firestore
  async getAllUsers() {
    if (!isFirebaseConnected) return null;
    try {
      const snapshot = await db.collection('users').get();
      const users = [];
      const now = Date.now();
      snapshot.forEach(doc => {
        const u = doc.data();
        if (u.role !== 'admin') {
          const lastSeenMs = u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
          const isOnline = (now - lastSeenMs) < 60000;
          users.push({
            id: u.id,
            name: u.name,
            phone: u.phone,
            createdAt: u.createdAt,
            lastSeen: u.lastSeen,
            isOnline,
            location: u.location
          });
        }
      });
      return users;
    } catch (e) {
      console.error('Firebase getAllUsers error:', e.message);
      return null;
    }
  },

  // Get single user
  async getUserById(userId) {
    if (!isFirebaseConnected) return null;
    try {
      const doc = await db.collection('users').doc(userId).get();
      if (!doc.exists) return null;
      return doc.data();
    } catch (e) {
      console.error('Firebase getUserById error:', e.message);
      return null;
    }
  }
};

module.exports = firebaseService;
