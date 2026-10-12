let map;
let socket = null;
let allUsers = [];
const markers = {}; // userId -> Leaflet Marker
let selectedUserId = null;

document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
});

function checkAdminAuth() {
  const cached = localStorage.getItem('geolive_user');
  if (cached) {
    try {
      const user = JSON.parse(cached);
      if (user && user.role === 'admin') {
        document.getElementById('adminLoginModal').style.display = 'none';
        initAdminDashboard();
        return;
      }
    } catch (e) {}
  }
  // Show modal if not authorized
  document.getElementById('adminLoginModal').style.display = 'flex';
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const phone = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    const data = await res.json();
    if (data.success && data.user.role === 'admin') {
      localStorage.setItem('geolive_user', JSON.stringify(data.user));
      document.getElementById('adminLoginModal').style.display = 'none';
      initAdminDashboard();
      showToast('Admin authorized successfully', 'success');
    } else {
      showToast('Invalid admin credentials', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server', 'error');
  }
}

function initAdminDashboard() {
  initMap();
  initSocket();
  loadUsers();

  // Periodically re-check online status every 30 seconds
  setInterval(() => {
    updateOnlineBadges();
  }, 30000);
}

function initMap() {
  map = L.map('adminMap').setView([6.9271, 79.8612], 12);

  // 100% Free OpenStreetMap tile layer (No API key required)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);
}

function initSocket() {
  socket = io();

  socket.on('connect', () => {
    document.getElementById('socketStatusDot').className = 'pulse-dot online';
    document.getElementById('socketStatusText').innerText = 'Live Socket Connected';
    socket.emit('join:admin');
  });

  socket.on('disconnect', () => {
    document.getElementById('socketStatusDot').className = 'pulse-dot offline';
    document.getElementById('socketStatusText').innerText = 'Socket Reconnecting...';
  });

  // REALTIME LOCATION UPDATE FROM ANY USER
  socket.on('location:updated', (user) => {
    handleRealtimeLocation(user);
  });

  // NEW USER REGISTERED
  socket.on('user:registered', (newUser) => {
    allUsers.unshift(newUser);
    renderUsersList();
    updateMetrics();
    showToast(`New user registered: ${newUser.name}`, 'info');
  });

  // USER DELETED
  socket.on('user:deleted', ({ id }) => {
    removeUserMarker(id);
    allUsers = allUsers.filter(u => u.id !== id);
    renderUsersList();
    updateMetrics();
  });
}

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const data = await res.json();
    if (data.success) {
      allUsers = data.users;
      renderUsersList();
      updateMetrics();
      renderAllMarkers();
    }
  } catch (err) {
    console.error('Failed to load users:', err);
    showToast('Failed to load user fleet data', 'error');
  }
}

function updateMetrics() {
  const total = allUsers.length;
  const online = allUsers.filter(u => isUserOnline(u)).length;
  const offline = total - online;
  const withLocation = allUsers.filter(u => u.location && u.location.latitude).length;

  document.getElementById('metricTotal').innerText = total;
  document.getElementById('metricOnline').innerText = online;
  document.getElementById('metricOffline').innerText = offline;
  document.getElementById('metricWithLocation').innerText = withLocation;
}

function isUserOnline(user) {
  if (!user.lastSeen) return false;
  const diff = Date.now() - new Date(user.lastSeen).getTime();
  return diff < 60000; // active in last 60 seconds
}

function renderUsersList() {
  const container = document.getElementById('usersListContainer');
  const search = document.getElementById('userSearch').value.toLowerCase();

  const filtered = allUsers.filter(u => 
    u.name.toLowerCase().includes(search) || 
    (u.email && u.email.toLowerCase().includes(search)) ||
    (u.phone && u.phone.toLowerCase().includes(search))
  );

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem 0; color: var(--text-dim); font-size: 0.875rem;">
        No registered users found
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(u => {
    const online = isUserOnline(u);
    const hasLoc = u.location && u.location.latitude;
    const lastSeenStr = u.lastSeen ? formatTimeAgo(u.lastSeen) : 'Never';

    return `
      <div class="user-card ${selectedUserId === u.id ? 'active' : ''}" onclick="selectUser('${u.id}')">
        <div class="user-card-header">
          <span class="user-card-name">${escapeHtml(u.name)}</span>
          <span class="badge ${online ? 'badge-online' : 'badge-offline'}">
            <span class="pulse-dot ${online ? 'online' : 'offline'}"></span>
            ${online ? 'Live' : 'Offline'}
          </span>
        </div>
        <div class="user-card-meta">
          ${u.email ? `<div><i class="fa-solid fa-envelope"></i> ${escapeHtml(u.email)}</div>` : ''}
          <div><i class="fa-solid fa-phone"></i> ${escapeHtml(u.phone)}</div>
          <div><i class="fa-solid fa-clock"></i> Last Active: ${lastSeenStr}</div>
          <div style="display:flex; justify-content: space-between; align-items: center; margin-top: 0.35rem;">
            <span style="color: ${hasLoc ? '#38bdf8' : '#6b7280'}; font-size: 0.775rem;">
              <i class="fa-solid fa-location-crosshairs"></i> ${hasLoc ? `${u.location.latitude.toFixed(4)}, ${u.location.longitude.toFixed(4)}` : 'No GPS signal yet'}
            </span>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteUser('${u.id}', '${escapeHtml(u.name)}')" title="Delete user" style="padding: 2px 7px; font-size: 0.7rem;">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function filterUsers() {
  renderUsersList();
}

function renderAllMarkers() {
  allUsers.forEach(user => {
    if (user.location && user.location.latitude) {
      updateUserMarker(user);
    }
  });

  if (allUsers.some(u => u.location && u.location.latitude)) {
    fitAllMarkers();
  }
}

function updateUserMarker(user) {
  if (!user.location || !user.location.latitude) return;

  const lat = parseFloat(user.location.latitude);
  const lng = parseFloat(user.location.longitude);
  const latLng = [lat, lng];
  const online = isUserOnline(user);

  const customIcon = L.divIcon({
    className: 'custom-user-marker',
    html: `
      <div class="marker-pin ${online ? 'online' : 'offline'}"></div>
      <div style="font-weight:700; background:rgba(0,0,0,0.85); color:#fff; border:1px solid ${online ? '#10b981' : '#64748b'}; padding:2px 7px; border-radius:4px; font-size:11px; white-space:nowrap; position:absolute; top:20px;">
        ${escapeHtml(user.name)}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32]
  });

  const lastSeenStr = user.lastSeen ? new Date(user.lastSeen).toLocaleString() : 'N/A';
  const speedStr = user.location.speed ? `${(user.location.speed * 3.6).toFixed(1)} km/h` : '0 km/h';
  const accuracyStr = user.location.accuracy ? `±${Math.round(user.location.accuracy)} m` : 'N/A';

  const popupContent = `
    <div style="font-family: inherit; font-size: 13px; line-height: 1.6; min-width: 200px;">
      <div style="font-weight: 800; font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
        <span>${escapeHtml(user.name)}</span>
        <span style="font-size: 10px; padding: 2px 6px; border-radius: 99px; background: ${online ? 'rgba(16,185,129,0.2)' : 'rgba(156,163,175,0.2)'}; color: ${online ? '#34d399' : '#9ca3af'};">
          ${online ? '● LIVE' : '○ OFFLINE'}
        </span>
      </div>
      <div style="color: #9ca3af; font-size: 11px; margin-bottom: 8px;">Phone: ${escapeHtml(user.phone)}</div>
      <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
        <div><b>Coordinates:</b> ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <div><b>GPS Accuracy:</b> ${accuracyStr}</div>
        <div><b>Speed:</b> ${speedStr}</div>
        <div><b>Last Updated:</b> ${lastSeenStr}</div>
      </div>
      <div style="margin-top: 10px; display: flex; gap: 6px;">
        <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" style="flex:1; text-align:center; padding: 5px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-size: 11px; font-weight: 600;">
          Google Maps
        </a>
        <a href="/track?id=${user.id}" target="_blank" style="flex:1; text-align:center; padding: 5px; background: #374151; color: #fff; text-decoration: none; border-radius: 6px; font-size: 11px; font-weight: 600;">
          Live URL
        </a>
      </div>
    </div>
  `;

  if (!markers[user.id]) {
    markers[user.id] = L.marker(latLng, { icon: customIcon }).addTo(map);
    markers[user.id].bindPopup(popupContent);
  } else {
    markers[user.id].setLatLng(latLng);
    markers[user.id].setIcon(customIcon);
    markers[user.id].setPopupContent(popupContent);
  }
}

function removeUserMarker(userId) {
  if (markers[userId]) {
    map.removeLayer(markers[userId]);
    delete markers[userId];
  }
}

function handleRealtimeLocation(user) {
  const index = allUsers.findIndex(u => u.id === user.id);
  if (index !== -1) {
    allUsers[index] = { ...allUsers[index], ...user, lastSeen: user.lastSeen, location: user.location };
  } else {
    allUsers.push(user);
  }

  updateUserMarker(user);
  renderUsersList();
  updateMetrics();
}

function selectUser(userId) {
  selectedUserId = userId;
  renderUsersList();

  const user = allUsers.find(u => u.id === userId);
  if (user && user.location && user.location.latitude) {
    const latLng = [user.location.latitude, user.location.longitude];
    map.flyTo(latLng, 16, { animate: true, duration: 1 });
    if (markers[userId]) {
      markers[userId].openPopup();
    }
  } else {
    showToast(`${user ? user.name : 'User'} has not transmitted GPS location yet`, 'info');
  }
}

function fitAllMarkers() {
  const activeMarkers = Object.values(markers);
  if (activeMarkers.length === 0) {
    showToast('No active user locations to display on map yet', 'info');
    return;
  }
  const group = L.featureGroup(activeMarkers);
  map.fitBounds(group.getBounds().pad(0.15));
}

function updateOnlineBadges() {
  renderUsersList();
  updateMetrics();
  // Refresh marker pins if status flipped
  allUsers.forEach(u => {
    if (markers[u.id]) {
      updateUserMarker(u);
    }
  });
}

async function deleteUser(id, name) {
  if (!confirm(`Are you sure you want to delete user "${name}"?`)) return;

  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`User ${name} deleted`, 'success');
      removeUserMarker(id);
      allUsers = allUsers.filter(u => u.id !== id);
      renderUsersList();
      updateMetrics();
    }
  } catch (err) {
    showToast('Failed to delete user', 'error');
  }
}

function formatTimeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function logoutAdmin() {
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
