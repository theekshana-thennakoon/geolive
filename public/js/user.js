let map, userMarker, accuracyCircle, pathPolyline;
let watchId = null;
let isTracking = false;
let socket = null;
let currentUser = null;
const pathCoordinates = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const cached = localStorage.getItem('geolive_user');
  if (!cached) {
    window.location.href = '/';
    return;
  }

  currentUser = JSON.parse(cached);
  document.getElementById('userNameBadge').innerHTML = `<i class="fa-solid fa-circle-user"></i> ${currentUser.name} (${currentUser.phone})`;
  const userIdEl = document.getElementById('userIdCode');
  if (userIdEl) userIdEl.innerText = currentUser.id;

  initSocket();
  initMap();

  // If user already has a saved location, display it
  fetchInitialLocation();
});

function initSocket() {
  socket = io();
  socket.on('connect', () => {
    socket.emit('join:track', currentUser.id);
  });
}

function initMap() {
  // Default to Colombo / world center if no coords yet
  map = L.map('userMap').setView([6.9271, 79.8612], 13);

  // 100% Free OpenStreetMap tile layer (No API key required)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  // Polyline for breadcrumb trail
  pathPolyline = L.polyline([], {
    color: '#3b82f6',
    weight: 4,
    opacity: 0.8,
    dashArray: '8, 8'
  }).addTo(map);
}

// Fetch any previous location stored in backend
async function fetchInitialLocation() {
  try {
    const res = await fetch(`/api/user/${currentUser.id}`);
    const data = await res.json();
    if (data.success && data.user.location) {
      updateDisplay(data.user.location, false);
      centerOn(data.user.location.latitude, data.user.location.longitude);
    }
  } catch (e) {
    console.error('Error fetching initial location:', e);
  }
}

// "View My Live Location" button handler
function startTrackingAndCenter() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser', 'error');
    return;
  }

  const btn = document.getElementById('viewLocationBtn');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Getting GPS Location...';

  // Request single fast fix first to immediately center
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> View My Live Location';
      handleLocationSuccess(pos, true);
      
      // Start continuous watching if not already active
      if (!isTracking) {
        startWatching();
      }
    },
    (err) => {
      btn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> View My Live Location';
      handleLocationError(err);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function startWatching() {
  if (!navigator.geolocation) return;

  isTracking = true;
  updateStatusUI(true);

  watchId = navigator.geolocation.watchPosition(
    (pos) => handleLocationSuccess(pos, false),
    (err) => handleLocationError(err),
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 1000
    }
  );
}

function handleLocationSuccess(position, forceCenter = false) {
  const { latitude, longitude, accuracy, speed, heading } = position.coords;

  // Update UI values
  updateDisplay({ latitude, longitude, accuracy, speed, heading, updatedAt: new Date().toISOString() }, forceCenter);

  // Send update to server via Socket.IO
  if (socket && socket.connected) {
    socket.emit('location:send', {
      userId: currentUser.id,
      latitude,
      longitude,
      accuracy,
      speed,
      heading
    });
  }

  // Also send via REST API for fallback & database persistence
  fetch('/api/location/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: currentUser.id,
      latitude,
      longitude,
      accuracy,
      speed,
      heading
    })
  }).catch(err => console.error('REST update failed:', err));
}

function updateDisplay(loc, forceCenter = false) {
  const lat = parseFloat(loc.latitude);
  const lng = parseFloat(loc.longitude);

  document.getElementById('valLat').innerText = lat.toFixed(6);
  document.getElementById('valLng').innerText = lng.toFixed(6);
  document.getElementById('valAcc').innerText = loc.accuracy ? `±${Math.round(loc.accuracy)} m` : 'N/A';
  document.getElementById('valSpeed').innerText = loc.speed ? `${(loc.speed * 3.6).toFixed(1)} km/h` : '0.0 km/h';
  document.getElementById('valTime').innerText = new Date(loc.updatedAt || Date.now()).toLocaleTimeString();

  // Show live URL share box
  const urlBox = document.getElementById('urlContainer');
  urlBox.style.display = 'block';

  // Google Maps Live Location URL
  const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const gmapsInput = document.getElementById('gmapsUrlInput');
  if (gmapsInput) gmapsInput.value = gmapsUrl;
  const gmapsLink = document.getElementById('gmapsLink');
  if (gmapsLink) gmapsLink.href = gmapsUrl;

  // Update Leaflet marker
  const latLng = [lat, lng];
  pathCoordinates.push(latLng);
  pathPolyline.setLatLngs(pathCoordinates);

  const customIcon = L.divIcon({
    className: 'custom-user-marker',
    html: `<div class="marker-pin online"></div><div style="font-weight:700; background:rgba(0,0,0,0.8); color:#fff; padding:2px 6px; border-radius:4px; font-size:11px; white-space:nowrap; position:absolute; top:18px;">${currentUser.name}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });

  if (!userMarker) {
    userMarker = L.marker(latLng, { icon: customIcon }).addTo(map);
    userMarker.bindPopup(`<b>${currentUser.name}</b><br>Live GPS Active<br>Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}`);
  } else {
    userMarker.setLatLng(latLng);
    userMarker.setIcon(customIcon);
  }

  // Update accuracy circle
  if (loc.accuracy) {
    if (!accuracyCircle) {
      accuracyCircle = L.circle(latLng, {
        radius: loc.accuracy,
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.15,
        weight: 1
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(latLng);
      accuracyCircle.setRadius(loc.accuracy);
    }
  }

  if (forceCenter) {
    map.setView(latLng, 16);
  }
}

function centerOn(lat, lng) {
  if (map && lat && lng) {
    map.setView([lat, lng], 16);
  }
}

function centerOnUser() {
  if (userMarker) {
    map.setView(userMarker.getLatLng(), 16);
  } else {
    startTrackingAndCenter();
  }
}

function updateStatusUI(tracking) {
  const badge = document.getElementById('liveBadge');
  const dot = document.getElementById('liveDot');
  const text = document.getElementById('liveStatusText');

  if (tracking) {
    badge.className = 'badge badge-online';
    dot.className = 'pulse-dot online';
    text.innerText = 'Live Streaming Active';
  } else {
    badge.className = 'badge badge-offline';
    dot.className = 'pulse-dot offline';
    text.innerText = 'Tracking Stopped';
  }
}

function handleLocationError(err) {
  let msg = 'Failed to obtain GPS location.';
  if (err.code === 1) {
    msg = 'Location permission denied. Please allow location access in your browser.';
  } else if (err.code === 2) {
    msg = 'GPS signal unavailable. Please ensure your device GPS is turned on.';
  } else if (err.code === 3) {
    msg = 'Location request timed out. Retrying...';
  }
  showToast(msg, 'error');
}

function copyGmapsUrl() {
  const input = document.getElementById('gmapsUrlInput');
  if (!input || !input.value) {
    showToast('GPS coordinates not ready yet. Please click "View My Live Location".', 'error');
    return;
  }
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('Google Maps live location URL copied to clipboard!', 'success');
  }).catch(() => {
    document.execCommand('copy');
    showToast('Google Maps live location URL copied!', 'success');
  });
}

function handleLogout() {
  localStorage.removeItem('geolive_user');
  window.location.href = '/';
}

function showToast(message, type = 'info') {
  const toasts = document.getElementById('toasts');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-triangle-exclamation' : 'fa-info-circle'}"></i> <span>${message}</span>`;
  toasts.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
