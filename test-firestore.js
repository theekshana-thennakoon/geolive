const firebase = require('./firebase');

async function test() {
  console.log('Firebase connected:', firebase.isConnected());
  const testUser = {
    id: 'test-firebase-user-1',
    name: 'Test Firebase User',
    email: 'test@example.com',
    phone: '0770000000',
    role: 'user',
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    location: {
      latitude: 6.9271,
      longitude: 79.8612,
      accuracy: 10,
      updatedAt: new Date().toISOString()
    }
  };

  console.log('Attempting to save user to Firestore...');
  const result = await firebase.saveUser(testUser);
  console.log('Save result:', result);

  if (result) {
    console.log('Fetching user back from Firestore...');
    const fetched = await firebase.getUserById(testUser.id);
    console.log('Fetched user:', fetched);
  }
}

test().catch(err => console.error('Test crashed:', err));
