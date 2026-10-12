# ☁️ Firebase Cloud Database Setup Guide

## 1. Where Data Is Saved Right Now
Currently, all user registrations and live GPS locations are stored in:
👉 [`d:\user_track\data\store.json`](file:///d:/user_track/data/store.json)

Inside this file, you can already see your recorded coordinates (e.g. `8.355524, 80.502762`), timestamps, and user profiles.

---

## 2. How to Connect Firebase Cloud Database

We have integrated **Firebase Admin SDK** into your Node.js backend. All you need is your Firebase credentials file:

### Step 1: Create a Firebase Project
1. Go to [Google Firebase Console](https://console.firebase.google.com).
2. Click **Add Project** (or select your existing project).
3. Name it (e.g. `geolive-tracking`) and click **Create Project**.

### Step 2: Enable Cloud Firestore
1. In the left menu, go to **Build** → **Firestore Database**.
2. Click **Create Database**.
3. Choose your nearest server location and select **Start in test mode** (allows read/write).
4. Click **Create**.

### Step 3: Download your `serviceAccountKey.json`
1. In the Firebase Console, click the **Gear Icon ⚙️ (Project settings)** in the top left.
2. Select the **Service accounts** tab.
3. Click the blue button: **"Generate new private key"**.
4. Confirm by clicking **"Generate key"**. A `.json` file will download to your computer.

### Step 4: Add the Key to your Project
1. Rename the downloaded `.json` file to:
   ```text
   serviceAccountKey.json
   ```
2. Move/paste it into your project folder:
   ```text
   d:\user_track\serviceAccountKey.json
   ```

### Step 5: Restart the Server
In your terminal, restart the Node.js server:
```powershell
npm start
```
You will see:
```text
🔥 Firebase Firestore successfully connected! Project: your-project-id
```

---

## 3. What Firebase Collections are Created?

Once connected, Firebase will automatically create two collections:
1. **`users`**: Contains each user's ID, Name, Phone/Username, and their latest `location` coordinates.
2. **`location_history`**: Contains a log of every GPS movement with timestamps (used for breadcrumb trails and historical tracking).

---

## 4. Kodular Mobile App Direct Firebase Option
Since you are also using Kodular:
* Kodular has a built-in **`FirebaseDB`** or **`CloudDB`** component.
* You can have your Kodular app send coordinates to your Node.js API (`/api/location/update`), which automatically syncs to Firebase.
* Or, Kodular can write directly to Firebase and your web panels will read from it!
