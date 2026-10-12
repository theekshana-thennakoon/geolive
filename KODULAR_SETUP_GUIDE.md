# Kodular Mobile App Real-Time Background GPS Guide

This guide explains how to convert or connect your real-time tracking website into an Android APK using [Kodular.io](https://www.kodular.io), allowing **continuous background location tracking even when the app is closed or the screen is turned off**.

---

## 1. Why Kodular Background Tasks are Required
When you simply open a website inside a Kodular **WebView**:
* When the app is open: GPS works normally.
* When the user **closes, minimizes, or kills the app**: Android terminates WebViews and pauses JavaScript.

**Solution:** Use Kodular's **LocationSensor** and the free **Itoo (Background Tasks)** extension to transmit GPS coordinates directly to your Node.js API in the background.

---

## 2. Prerequisites in Kodular
1. Download the free **`Itoo` Extension** for Kodular / MIT App Inventor:
   * Community link: [Itoo - Background Tasks Extension](https://community.appinventor.mit.edu/t/itoo-background-tasks-extension/70474)
2. In Kodular Designer:
   * Import the **Itoo** `.aix` extension.
   * Add a **LocationSensor** component (Sensors palette).
     - Set `TimeInterval`: `15000` (15 seconds)
     - Set `DistanceInterval`: `5` (5 meters)
   * Add a **Web** component (Connectivity palette).
   * Add a **TinyDB** component (Storage palette) to store `userId`.

---

## 3. Kodular Blocks Logic

### Step A: On App First Launch / Login
Store the registered user's `userId` in `TinyDB`:
* Tag: `"userId"`
* Value: (User ID obtained from the website or login response)

### Step B: Register Background Service (Itoo)
In `Screen1.Initialize`:
1. Request permissions: `ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION`.
2. Call `Itoo1.RegisterProcess` (or `Itoo1.CreateProcess`):
   * `Event`: `"LocationSensor1.LocationChanged"`
   * `Procedure`: `"SendLocationToServer"`

### Step C: Define the Background Procedure (`SendLocationToServer`)
When `LocationSensor1.LocationChanged(latitude, longitude, altitude, speed)` triggers in background:

1. **Set Web1.Url:**
   ```text
   http://YOUR_SERVER_IP:3000/api/location/update
   ```
   *(Note: Replace `YOUR_SERVER_IP` with your computer's local IP like `192.168.1.50` during testing, or your public domain/VPS URL in production)*

2. **Set Web1.RequestHeaders:**
   * Key: `Content-Type`, Value: `application/json`

3. **Build JSON Payload:**
   Use the `JsonTextDecode` or text join block:
   ```json
   {
     "userId": "<read from TinyDB>",
     "latitude": <latitude>,
     "longitude": <longitude>,
     "speed": <speed>,
     "accuracy": 10
   }
   ```

4. **Execute Post:**
   * Call `Web1.PostText(jsonText)`

---

## 4. API Endpoints Reference

### Update Location (Web / Mobile App)
* **Method:** `POST`
* **URL:** `http://YOUR_DOMAIN_OR_IP:3000/api/location/update`
* **Headers:** `Content-Type: application/json`
* **Body:**
```json
{
  "userId": "your-uuid-here",
  "latitude": 6.9271,
  "longitude": 79.8612,
  "accuracy": 12.5,
  "speed": 0.5,
  "heading": 90
}
```
* **Response:**
```json
{
  "success": true,
  "message": "Location updated successfully"
}
```

### User Login (Mobile App)
* **Method:** `POST`
* **URL:** `http://YOUR_DOMAIN_OR_IP:3000/api/auth/login`
* **Body:**
```json
{
  "phone": "user_phone_or_username",
  "password": "user_password"
}
```

### User Registration (Mobile App)
* **Method:** `POST`
* **URL:** `http://YOUR_DOMAIN_OR_IP:3000/api/auth/register`
* **Body:**
```json
{
  "name": "Full Name",
  "phone": "0771234567",
  "password": "secretpassword"
}
```

---

## 5. Result
* Whenever the user moves with their Android phone (even if the screen is off or the app is closed), the phone sends GPS coordinates to your Node.js server.
* The **Admin Panel** updates in real-time on the map via Socket.IO!
* If the user turns off GPS or loses internet, the Admin panel still shows their **Last Known Location** and timestamp.
