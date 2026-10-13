let map;
let socket = null;
let allUsers = [];
const markers = {}; // userId -> Leaflet Marker
let selectedUserId = null;
let currentHistoryData = [];
let currentHistoryUser = null;
let historyPolyline = null;
let historyGlowPolyline = null;
let historyMarkersLayer = null;
let historyLatestMarker = null;
let historyPollingTimer = null;

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
          <div style="display:flex; justify-content: space-between; align-items: center; margin-top: 0.35rem; gap: 0.5rem;">
            <span style="color: ${hasLoc ? '#38bdf8' : '#6b7280'}; font-size: 0.775rem;">
              <i class="fa-solid fa-location-crosshairs"></i> ${hasLoc ? `${u.location.latitude.toFixed(4)}, ${u.location.longitude.toFixed(4)}` : 'No GPS signal yet'}
            </span>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openUserHistoryModal('${u.id}')" title="View Location History" style="padding: 2px 7px; font-size: 0.72rem; gap: 4px;">
                <i class="fa-solid fa-route" style="color: #818cf8;"></i> History
              </button>
              <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteUser('${u.id}', '${escapeHtml(u.name)}')" title="Delete user" style="padding: 2px 7px; font-size: 0.7rem;">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
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
        <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 8px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-size: 11px; font-weight: 600;">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> Google Maps
        </a>
        <button onclick="openUserHistoryModal('${user.id}')" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 8px; background: #4f46e5; color: #fff; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
          <i class="fa-solid fa-route"></i> History
        </button>
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

  // Live update if Location History modal or Map trail is active for this user
  handleRealtimeHistoryUpdate(user);
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

// ==========================================
// LOCATION HISTORY FEATURES (USER-WISE & REAL-TIME)
// ==========================================

async function openUserHistoryModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) {
    showToast('User not found', 'error');
    return;
  }

  currentHistoryUser = user;
  const modal = document.getElementById('userHistoryModal');
  const title = document.getElementById('historyModalTitle');
  const sub = document.getElementById('historyModalSubtitle');
  const container = document.getElementById('historyListContainer');
  const statPoints = document.getElementById('historyStatPoints');
  const statLatest = document.getElementById('historyStatLatestTime');

  title.innerText = `Location History: ${user.name}`;
  sub.innerText = `Phone: ${user.phone} | User ID: ${user.id}`;
  statPoints.innerText = '...';
  statLatest.innerText = 'Loading...';
  container.innerHTML = `
    <div style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
      <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: var(--primary); margin-bottom: 0.5rem;"></i>
      <div>Loading location history...</div>
    </div>
  `;

  modal.classList.add('active');

  // Start real-time background polling as safety alongside socket events
  startHistoryPolling(userId);

  try {
    const res = await fetch(`/api/user/${userId}/history?limit=300`);
    const data = await res.json();
    
    if (!data.success) {
      container.innerHTML = `<div style="padding: 2rem; text-align: center; color: #f87171;">Failed to load location history</div>`;
      return;
    }

    currentHistoryData = data.history || [];

    // Fallback: if user has current location but no recorded history array yet
    if (currentHistoryData.length === 0 && user.location && user.location.latitude) {
      currentHistoryData = [{
        userId: user.id,
        ...user.location
      }];
    }

    statPoints.innerText = currentHistoryData.length;

    if (currentHistoryData.length === 0) {
      statLatest.innerText = 'No GPS recorded yet';
      renderHistoryTable([]);
      return;
    }

    const latest = currentHistoryData[currentHistoryData.length - 1];
    statLatest.innerText = `Latest: ${latest.updatedAt ? new Date(latest.updatedAt).toLocaleTimeString() : 'N/A'}`;

    renderHistoryTable(currentHistoryData);
  } catch (err) {
    console.error('History fetch error:', err);
    container.innerHTML = `<div style="padding: 2rem; text-align: center; color: #f87171;">Network error loading history</div>`;
  }
}

function renderHistoryTable(points) {
  const container = document.getElementById('historyListContainer');
  if (!container) return;

  if (!points || points.length === 0) {
    container.innerHTML = `
      <div style="padding: 3rem 1.5rem; text-align: center; color: var(--text-muted);">
        <i class="fa-solid fa-route" style="font-size: 2rem; color: var(--text-dim); margin-bottom: 0.75rem;"></i>
        <div style="font-weight: 600; font-size: 1rem; color: var(--text-main); margin-bottom: 0.25rem;">No Location History Available</div>
        <div style="font-size: 0.825rem;">This user has not sent any GPS location updates yet.</div>
      </div>
    `;
    return;
  }

  const reversedHistory = [...points].reverse();
  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th style="width: 65px;">Point</th>
          <th>Recorded Time</th>
          <th>Coordinates</th>
          <th>Accuracy</th>
          <th>Speed</th>
          <th style="text-align: right;">Action</th>
        </tr>
      </thead>
      <tbody>
        ${reversedHistory.map((p, idx) => {
          const pointNumber = points.length - idx;
          const isLatest = idx === 0;
          const isStart = pointNumber === 1;
          const timeStr = p.updatedAt ? new Date(p.updatedAt).toLocaleString() : 'N/A';
          const speedStr = p.speed ? `${(p.speed * 3.6).toFixed(1)} km/h` : '0 km/h';
          const accStr = p.accuracy ? `±${Math.round(p.accuracy)} m` : 'N/A';
          const badgeClass = isLatest ? 'end' : isStart ? 'start' : 'point';
          const badgeText = isLatest ? 'Latest' : isStart ? 'Start' : `#${pointNumber}`;

          return `
            <tr>
              <td>
                <span class="history-marker-badge ${badgeClass}">${badgeText}</span>
              </td>
              <td style="white-space: nowrap;">
                <div>${timeStr}</div>
              </td>
              <td>
                <code style="color: #38bdf8; font-size: 0.8rem;">${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</code>
              </td>
              <td>${accStr}</td>
              <td>${speedStr}</td>
              <td style="text-align: right;">
                <button class="btn btn-outline btn-sm" onclick="locateHistoryPoint(${p.latitude}, ${p.longitude}, '${timeStr}')" style="padding: 2px 8px; font-size: 0.75rem;">
                  <i class="fa-solid fa-crosshairs"></i> Pan Map
                </button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function handleRealtimeHistoryUpdate(user) {
  if (!currentHistoryUser || currentHistoryUser.id !== user.id) return;
  if (!user.location || !user.location.latitude) return;

  const newLoc = {
    userId: user.id,
    latitude: parseFloat(user.location.latitude),
    longitude: parseFloat(user.location.longitude),
    accuracy: user.location.accuracy !== undefined ? parseFloat(user.location.accuracy) : null,
    speed: user.location.speed !== undefined ? parseFloat(user.location.speed) : null,
    heading: user.location.heading !== undefined ? parseFloat(user.location.heading) : null,
    updatedAt: user.location.updatedAt || user.lastSeen || new Date().toISOString()
  };

  // Avoid inserting duplicate if same timestamp
  const lastPoint = currentHistoryData[currentHistoryData.length - 1];
  if (lastPoint && lastPoint.updatedAt === newLoc.updatedAt) {
    return;
  }

  currentHistoryData.push(newLoc);

  // 1. If Modal is active, update modal table and stats live
  const modal = document.getElementById('userHistoryModal');
  if (modal && modal.classList.contains('active')) {
    updateHistoryModalLive(newLoc);
  }

  // 2. If map route is showing on map, update route live
  if (historyPolyline) {
    appendPointToMapRoute(newLoc);
  }
}

function updateHistoryModalLive(newLoc) {
  const statPoints = document.getElementById('historyStatPoints');
  const statLatest = document.getElementById('historyStatLatestTime');
  if (statPoints) statPoints.innerText = currentHistoryData.length;
  if (statLatest) statLatest.innerText = `Latest: ${new Date(newLoc.updatedAt).toLocaleTimeString()}`;

  const tbody = document.querySelector('#historyListContainer table.history-table tbody');
  if (tbody) {
    // Change previous #1 (now #2) badge from 'Latest' to its number
    const firstRowBadge = tbody.querySelector('tr:first-child .history-marker-badge');
    if (firstRowBadge) {
      firstRowBadge.className = 'history-marker-badge point';
      firstRowBadge.innerText = `#${currentHistoryData.length - 1}`;
    }

    const timeStr = new Date(newLoc.updatedAt).toLocaleString();
    const speedStr = newLoc.speed ? `${(newLoc.speed * 3.6).toFixed(1)} km/h` : '0 km/h';
    const accStr = newLoc.accuracy ? `±${Math.round(newLoc.accuracy)} m` : 'N/A';

    const newRow = document.createElement('tr');
    newRow.style.animation = 'highlightRow 2s ease';
    newRow.innerHTML = `
      <td>
        <span class="history-marker-badge end">Latest</span>
      </td>
      <td style="white-space: nowrap;">
        <div>${timeStr}</div>
      </td>
      <td>
        <code style="color: #38bdf8; font-size: 0.8rem;">${newLoc.latitude.toFixed(5)}, ${newLoc.longitude.toFixed(5)}</code>
      </td>
      <td>${accStr}</td>
      <td>${speedStr}</td>
      <td style="text-align: right;">
        <button class="btn btn-outline btn-sm" onclick="locateHistoryPoint(${newLoc.latitude}, ${newLoc.longitude}, '${timeStr}')" style="padding: 2px 8px; font-size: 0.75rem;">
          <i class="fa-solid fa-crosshairs"></i> Pan Map
        </button>
      </td>
    `;
    tbody.prepend(newRow);
  } else {
    renderHistoryTable(currentHistoryData);
  }
}

function appendPointToMapRoute(newLoc) {
  if (historyPolyline) {
    historyPolyline.addLatLng([newLoc.latitude, newLoc.longitude]);
  }
  if (historyGlowPolyline) {
    historyGlowPolyline.addLatLng([newLoc.latitude, newLoc.longitude]);
  }
  if (historyLatestMarker) {
    historyLatestMarker.setLatLng([newLoc.latitude, newLoc.longitude]);
    historyLatestMarker.setPopupContent(`<b>Latest Point</b><br>${new Date(newLoc.updatedAt).toLocaleString()}`);
  }
  const noticeCount = document.getElementById('historyNoticePointCount');
  if (noticeCount) noticeCount.innerText = currentHistoryData.length;
}

function startHistoryPolling(userId) {
  stopHistoryPolling();
  historyPollingTimer = setInterval(() => {
    const modal = document.getElementById('userHistoryModal');
    if (modal && modal.classList.contains('active') && currentHistoryUser && currentHistoryUser.id === userId) {
      silentRefreshHistory(userId);
    } else {
      stopHistoryPolling();
    }
  }, 3500);
}

function stopHistoryPolling() {
  if (historyPollingTimer) {
    clearInterval(historyPollingTimer);
    historyPollingTimer = null;
  }
}

async function silentRefreshHistory(userId) {
  try {
    const res = await fetch(`/api/user/${userId}/history?limit=300`);
    const data = await res.json();
    if (data.success && data.history) {
      const fetched = data.history;
      if (fetched.length !== currentHistoryData.length) {
        currentHistoryData = fetched;
        const statPoints = document.getElementById('historyStatPoints');
        const statLatest = document.getElementById('historyStatLatestTime');
        if (statPoints) statPoints.innerText = currentHistoryData.length;
        if (currentHistoryData.length > 0) {
          const latest = currentHistoryData[currentHistoryData.length - 1];
          if (statLatest) statLatest.innerText = `Latest: ${latest.updatedAt ? new Date(latest.updatedAt).toLocaleTimeString() : 'N/A'}`;
        }
        renderHistoryTable(currentHistoryData);

        if (historyPolyline) {
          drawHistoryRoute(currentHistoryUser, currentHistoryData, true);
        }
      }
    }
  } catch (e) {
    console.error('Silent refresh history error:', e);
  }
}

async function refreshCurrentHistoryModal(manual = false) {
  if (!currentHistoryUser) return;
  const icon = document.getElementById('historyRefreshIcon');
  if (icon) icon.classList.add('fa-spin');

  await silentRefreshHistory(currentHistoryUser.id);

  if (icon) {
    setTimeout(() => icon.classList.remove('fa-spin'), 500);
  }
  if (manual) {
    showToast('Location history refreshed', 'info');
  }
}

function closeUserHistoryModal() {
  stopHistoryPolling();
  document.getElementById('userHistoryModal').classList.remove('active');
}

function reopenCurrentHistoryModal() {
  if (currentHistoryUser) {
    document.getElementById('userHistoryModal').classList.add('active');
    startHistoryPolling(currentHistoryUser.id);
  }
}

function renderHistoryOnMapFromModal() {
  closeUserHistoryModal();
  if (!currentHistoryUser || !currentHistoryData || currentHistoryData.length === 0) {
    showToast('No history points to display on map', 'info');
    return;
  }
  drawHistoryRoute(currentHistoryUser, currentHistoryData);
}

function drawHistoryRoute(user, points, isSilentUpdate = false) {
  if (!isSilentUpdate) {
    clearHistoryRouteLayers();
  }

  if (!historyMarkersLayer) {
    historyMarkersLayer = L.layerGroup().addTo(map);
  }

  const latLngs = points.map(p => [parseFloat(p.latitude), parseFloat(p.longitude)]);

  if (!historyGlowPolyline) {
    historyGlowPolyline = L.polyline(latLngs, {
      color: '#38bdf8',
      weight: 8,
      opacity: 0.35,
      lineJoin: 'round'
    }).addTo(historyMarkersLayer);
  } else {
    historyGlowPolyline.setLatLngs(latLngs);
  }

  if (!historyPolyline) {
    historyPolyline = L.polyline(latLngs, {
      color: '#4f46e5',
      weight: 4,
      opacity: 0.95,
      dashArray: '8, 6',
      lineJoin: 'round'
    }).addTo(historyMarkersLayer);
  } else {
    historyPolyline.setLatLngs(latLngs);
  }

  // Start Pin (Green)
  const startP = points[0];
  const startIcon = L.divIcon({
    className: 'custom-history-marker',
    html: `<div class="history-pin start"><i class="fa-solid fa-flag"></i> Start</div>`,
    iconSize: [60, 26],
    iconAnchor: [30, 13]
  });
  if (!isSilentUpdate) {
    L.marker([startP.latitude, startP.longitude], { icon: startIcon })
      .addTo(historyMarkersLayer)
      .bindPopup(`<b>Start Point</b><br>${startP.updatedAt ? new Date(startP.updatedAt).toLocaleString() : ''}`);
  }

  // End / Current Pin (Blue)
  if (points.length > 1) {
    const endP = points[points.length - 1];
    const endIcon = L.divIcon({
      className: 'custom-history-marker',
      html: `<div class="history-pin end"><i class="fa-solid fa-location-dot"></i> Latest</div>`,
      iconSize: [65, 26],
      iconAnchor: [32, 13]
    });
    if (!historyLatestMarker) {
      historyLatestMarker = L.marker([endP.latitude, endP.longitude], { icon: endIcon })
        .addTo(historyMarkersLayer)
        .bindPopup(`<b>Latest Point</b><br>${endP.updatedAt ? new Date(endP.updatedAt).toLocaleString() : ''}`);
    } else {
      historyLatestMarker.setLatLng([endP.latitude, endP.longitude]);
      historyLatestMarker.setPopupContent(`<b>Latest Point</b><br>${endP.updatedAt ? new Date(endP.updatedAt).toLocaleString() : ''}`);
    }
  }

  if (!isSilentUpdate) {
    // Intermediate subtle waypoints
    if (points.length > 2 && points.length <= 100) {
      for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        const timeStr = p.updatedAt ? new Date(p.updatedAt).toLocaleTimeString() : 'N/A';
        const speedStr = p.speed ? `${(p.speed * 3.6).toFixed(1)} km/h` : '0 km/h';

        L.circleMarker([p.latitude, p.longitude], {
          radius: 4,
          fillColor: '#818cf8',
          color: '#ffffff',
          weight: 1.5,
          fillOpacity: 0.9
        })
        .addTo(historyMarkersLayer)
        .bindPopup(`<b>Waypoint #${i + 1}</b><br>Time: ${timeStr}<br>Speed: ${speedStr}<br>Coords: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`);
      }
    }

    map.fitBounds(historyPolyline.getBounds().pad(0.2));
  }

  // Show notice banner
  const notice = document.getElementById('historyModeNotice');
  if (notice) {
    document.getElementById('historyNoticeUserName').innerText = user.name;
    document.getElementById('historyNoticePointCount').innerText = points.length;
    notice.style.display = 'flex';
  }

  if (!isSilentUpdate) {
    showToast(`Displaying route trail for ${user.name} (${points.length} GPS points)`, 'success');
  }
}

function clearHistoryRouteLayers() {
  if (historyPolyline) {
    map.removeLayer(historyPolyline);
    historyPolyline = null;
  }
  if (historyGlowPolyline) {
    map.removeLayer(historyGlowPolyline);
    historyGlowPolyline = null;
  }
  if (historyMarkersLayer) {
    map.removeLayer(historyMarkersLayer);
    historyMarkersLayer = null;
  }
  historyLatestMarker = null;
}

function exitHistoryMode() {
  clearHistoryRouteLayers();
  const notice = document.getElementById('historyModeNotice');
  if (notice) notice.style.display = 'none';
  fitAllMarkers();
  showToast('Exited history view. Showing live fleet.', 'info');
}

function locateHistoryPoint(lat, lng, label) {
  closeUserHistoryModal();
  map.flyTo([lat, lng], 17, { animate: true, duration: 1 });
  L.popup()
    .setLatLng([lat, lng])
    .setContent(`<div style="font-size:12px; font-weight:600;">📍 Historical GPS Point<br><span style="color:#64748b; font-weight:normal;">${label}</span><br><code>${lat.toFixed(5)}, ${lng.toFixed(5)}</code></div>`)
    .openOn(map);
}

function exportHistoryCsv() {
  if (!currentHistoryData || currentHistoryData.length === 0) {
    showToast('No history data to export', 'info');
    return;
  }

  const userName = currentHistoryUser ? currentHistoryUser.name : 'user';
  const headers = ['Point', 'User_ID', 'User_Name', 'Timestamp', 'Latitude', 'Longitude', 'Accuracy_meters', 'Speed_kmh'];
  const rows = currentHistoryData.map((p, idx) => [
    idx + 1,
    `"${p.userId || ''}"`,
    `"${userName.replace(/"/g, '""')}"`,
    `"${p.updatedAt || ''}"`,
    p.latitude,
    p.longitude,
    p.accuracy || '',
    p.speed ? (p.speed * 3.6).toFixed(2) : 0
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${userName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_location_history.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Location history exported to CSV', 'success');
}
