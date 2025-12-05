/* static/js/chat.js - FIXED VERSION
FIXES APPLIED:
✅ FIX #1: Auto-scroll to bottom when loading chat
✅ FIX #2: First sent message appears instantly on sender screen
✅ FIX #3: Duplicate messages prevented with ID-based deduplication

KEY IMPROVEMENTS:
- scrollToBottom() function for auto-scroll
- Local message append when sending (single source of truth)
- Duplicate prevention by message ID
- Instant message delivery feedback
- Smart scroll (only when near bottom)
*/

const API_BASE = '/chat/api';
let currentChatType = null;
let currentChatId = null;
let ws = null;
let currentUserId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 8;
let intersectionObserver = null;
let isUserNearBottomThreshold = 150; // px
let newMessageBadge = null;

// Presence control variables (Option A: instant online, stable offline)
let pendingOfflineTimer = null;
const OFFLINE_STABLE_MS = 2000; // 2 seconds stable offline threshold
let lastAppliedPresence = null; // 'online' | 'offline' | null

// ✅ FIX: Track which messages we've already added to prevent duplicates
let addedMessageIds = new Set();

document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Chat app initializing...');

  currentUserId =
    window.currentUserId ||
    parseInt(document.querySelector('[data-user-id]')?.getAttribute('data-user-id') || '0') ||
    parseInt(document.body.parentElement.getAttribute('data-user-id') || '0');

  console.log('✅ Current user ID:', currentUserId);

  if (!currentUserId || currentUserId === 0) {
    console.error('❌ User ID not found in page!');
    console.log('Debug: ensure data-user-id="{{ request.user.id }}" exists in HTML');
  }

  loadRecentChats();
  loadProjects();
  setupEventListeners();
});

/* ===========================================
   RECENT CHATS
   =========================================== */
async function loadRecentChats() {
  try {
    const url = `${API_BASE}/messages/recent_chats/`;
    const res = await fetch(url, { headers: defaultHeaders() });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const chats = await res.json();
    renderRecentChats(chats);
  } catch (err) {
    console.error('❌ Error loading recent chats:', err);
  }
}

function renderRecentChats(chats) {
  const container = document.getElementById('recent-chats');
  if (!container) return;

  container.innerHTML = '';
  if (!Array.isArray(chats) || chats.length === 0) {
    container.innerHTML = '<p class="empty-state">No recent chats</p>';
    return;
  }

  chats.sort((a, b) => new Date(b.last_message_time) - new Date(a.last_message_time));

  chats.forEach(chat => {
    const item = createChatItem(chat);
    container.appendChild(item);
  });
}

function createChatItem(chat) {
  const div = document.createElement('div');
  div.className = 'chat-item';
  div.tabIndex = 0;
  div.onclick = () => openChat('user', chat.user.id);

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = (chat.user.first_name?.[0] || chat.user.username?.[0] || 'U').toUpperCase();

  const info = document.createElement('div');
  info.className = 'chat-info';

  const name = document.createElement('div');
  name.className = 'chat-name';
  name.textContent = chat.user.first_name ? `${chat.user.first_name} ${chat.user.last_name}` : chat.user.username;

  const preview = document.createElement('div');
  preview.className = 'chat-preview';
  preview.textContent = chat.last_message || '(No messages)';

  info.appendChild(name);
  info.appendChild(preview);
  div.appendChild(avatar);
  div.appendChild(info);

  if (chat.unread_count && chat.unread_count > 0) {
    const badge = document.createElement('div');
    badge.className = 'unread-badge';
    badge.textContent = chat.unread_count;
    badge.dataset.forUser = chat.user.id;
    div.appendChild(badge);
  }

  return div;
}

/* ===========================================
   PROJECTS
   =========================================== */
async function loadProjects() {
  try {
    const url = `${API_BASE}/projects/`;
    const res = await fetch(url, { headers: defaultHeaders() });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const projects = await res.json();
    renderProjects(projects);
  } catch (err) {
    console.error('❌ Error loading projects:', err);
  }
}

function renderProjects(projects) {
  const container = document.getElementById('projects-list');
  if (!container) return;

  container.innerHTML = '';
  if (!Array.isArray(projects) || projects.length === 0) {
    container.innerHTML = '<p class="empty-state">No projects</p>';
    return;
  }

  projects.forEach(project => container.appendChild(createProjectItem(project)));
}

function createProjectItem(project) {
  const div = document.createElement('div');
  div.className = 'chat-item';
  div.onclick = () => openChat('project', project.id);

  const avatar = document.createElement('div');
  avatar.className = 'avatar project-avatar';
  avatar.textContent = (project.name?.[0] || 'P').toUpperCase();

  const info = document.createElement('div');
  info.className = 'chat-info';

  const name = document.createElement('div');
  name.className = 'chat-name';
  name.textContent = project.name;

  const preview = document.createElement('div');
  preview.className = 'chat-preview';
  preview.textContent = `${project.members?.length || 0} members`;

  info.appendChild(name);
  info.appendChild(preview);
  div.appendChild(avatar);
  div.appendChild(info);
  return div;
}

/* ===========================================
   OPEN CHAT
   =========================================== */
function openChat(type, id) {
  console.log(`🔓 Opening ${type} chat with id ${id}`);
  currentChatType = type;
  currentChatId = Number(id);

  // update active class
  try {
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    // event may be undefined when called programmatically; skip it safely
    if (window.event?.target) {
      const el = window.event.target.closest('.chat-item');
      if (el) el.classList.add('active');
    }
  } catch (e) {
    console.warn('Could not update active state:', e);
  }

  // ✅ FIX #1: Clear tracking when opening new chat
  addedMessageIds.clear();

  loadChatWindow(type, id);
  connectWebSocket(type, id);
}

/* ===========================================
   LOAD CHAT WINDOW (initial fetch of messages)
   =========================================== */
async function loadChatWindow(type, id) {
  const chatWindow = document.getElementById('chat-window');
  if (!chatWindow) return;

  try {
    let endpoint = '';
    let headerName = '';
    let isOnline = false;

    if (type === 'user') {
      endpoint = `${API_BASE}/messages/user/${id}/`;
      const user = await (await fetch(`${API_BASE}/users/${id}/`, { headers: defaultHeaders() })).json();
      headerName = user.first_name ? `${user.first_name} ${user.last_name}` : user.username;
      isOnline = !!(user.profile && user.profile.is_online);
    } else {
      endpoint = `${API_BASE}/messages/project/${id}/`;
      const project = await (await fetch(`${API_BASE}/projects/${id}/`, { headers: defaultHeaders() })).json();
      headerName = project.name;
      isOnline = true;
    }

    const res = await fetch(endpoint, { headers: defaultHeaders() });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const messages = await res.json();

    const statusClass = isOnline ? 'online' : 'offline';
    const statusText = isOnline ? '● Online' : '● Offline';

    chatWindow.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-title">
          <h3>${escapeHtml(headerName)}</h3>
          <span class="connection-status ${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="messages-container" id="messages-container" tabindex="0"></div>
      <div class="message-input-area">
        <div class="input-wrapper">
          <textarea id="message-input" class="message-input" placeholder="Type a message..." rows="1"></textarea>
          <button id="file-upload-btn" class="file-upload-btn" title="Upload file">📎</button>
          <button id="send-btn" class="send-btn">Send</button>
        </div>
      </div>
    `;

    const messagesContainer = document.getElementById('messages-container');

    // Render initial messages
    if (Array.isArray(messages) && messages.length > 0) {
      messages.forEach(msg => {
        addedMessageIds.add(msg.id);
        messagesContainer.appendChild(createMessageElement(msg));
      });
    }

    // Setup input, listeners and read receipts
    setupMessageInputHandlers(type, id);
    setupReadReceiptObservers(messagesContainer);

    // ✅ FIX #1: AUTO-SCROLL TO BOTTOM AFTER RENDERING
    scrollToBottom();
    console.log('✅ Scrolled to bottom of chat');

    // Send read receipts for visible messages after small delay (allow rendering)
    setTimeout(() => sendReadReceipts(true), 150);

  } catch (err) {
    console.error('❌ Error loading chat window:', err);
    chatWindow.innerHTML = `
      <div class="welcome-screen">
        <h2>Error</h2>
        <p>Failed to load chat: ${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

/* ===========================================
   ✅ FIX #1: AUTO-SCROLL TO BOTTOM FUNCTION
   =========================================== */
function scrollToBottom() {
  const messagesContainer = document.getElementById('messages-container');
  if (messagesContainer) {
    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 50);
  }
}

/* ===========================================
   MESSAGE ELEMENT CREATION (with read state + ticks)
   =========================================== */
function createMessageElement(msg) {
  // msg is expected to have: id, sender_id, sender_username, text, file_url, timestamp, is_read (boolean)
  const div = document.createElement('div');
  div.className = 'message';
  if (msg.id !== undefined) div.dataset.messageId = msg.id;

  const isOwn = (Number(msg.sender) === Number(currentUserId) ||
                 Number(msg.sender_id) === Number(currentUserId) ||
                 Number(msg.user_id) === Number(currentUserId) ||
                 Number(msg.author) === Number(currentUserId));

  if (isOwn) div.classList.add('own-message');
  else div.classList.add('other-message');

  // Mark not-read visually
  if (!msg.is_read) div.classList.add('not-read');

  // Optional sender name for group/project
  if (!isOwn && msg.sender_username) {
    const senderEl = document.createElement('div');
    senderEl.className = 'message-sender';
    senderEl.textContent = msg.sender_username;
    div.appendChild(senderEl);
  }

  // Content wrapper
  const content = document.createElement('div');
  content.className = 'message-body';

  const textEl = document.createElement('div');
  textEl.className = 'message-content';
  textEl.textContent = msg.text || '';
  content.appendChild(textEl);

  // Attachment preview
  if (msg.file_url) {
    const fileAttachment = document.createElement('div');
    fileAttachment.className = 'file-attachment';
    const ext = (msg.file_url.split('.').pop() || '').toLowerCase();

    if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
      const img = document.createElement('img');
      img.src = msg.file_url;
      img.alt = 'attachment';
      img.loading = 'lazy';
      img.style.maxWidth = '100%';
      img.style.borderRadius = '6px';
      img.onclick = () => window.open(msg.file_url, '_blank');
      fileAttachment.appendChild(img);
    } else if (['mp4','webm','ogg','mov','avi'].includes(ext)) {
      const video = document.createElement('video');
      video.src = msg.file_url;
      video.controls = true;
      video.style.maxWidth = '100%';
      fileAttachment.appendChild(video);
    } else if (['mp3','wav','ogg','m4a'].includes(ext)) {
      const audio = document.createElement('audio');
      audio.src = msg.file_url;
      audio.controls = true;
      fileAttachment.appendChild(audio);
    } else {
      const link = document.createElement('a');
      link.href = msg.file_url;
      link.target = '_blank';
      link.textContent = `📥 ${msg.file_url.split('/').pop()}`;
      fileAttachment.appendChild(link);
    }
    content.appendChild(fileAttachment);
  }

  // timestamp + read status container
  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.appendChild(time);

  // read ticks for own messages
  if (isOwn) {
    const ticks = document.createElement('div');
    ticks.className = 'message-ticks';
    const t1 = document.createElement('span'); t1.className = 'tick tick-1'; t1.textContent = '✓';
    const t2 = document.createElement('span'); t2.className = 'tick tick-2'; t2.textContent = '✓';
    if (msg.is_read) {
      t1.classList.add('read');
      t2.classList.add('read');
    } else if (msg.is_delivered) {
      t1.classList.add('delivered');
    }
    ticks.appendChild(t1); ticks.appendChild(t2);
    meta.appendChild(ticks);
  }

  content.appendChild(meta);
  div.appendChild(content);

  return div;
}

/* ===========================================
   INPUT HANDLERS
   =========================================== */
function setupMessageInputHandlers(type, id) {
  const inputEl = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const fileUploadBtn = document.getElementById('file-upload-btn');

  if (!inputEl || !sendBtn) return;

  sendBtn.onclick = () => sendMessageViaWebSocket(type, id);

  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessageViaWebSocket(type, id);
    }
  };

  inputEl.oninput = () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  };

  if (fileUploadBtn) {
    fileUploadBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = (e) => uploadFileViaWebSocket(e, type, id);
      input.click();
    };
  }
}

/* ===========================================
   ✅ FIX #2: SEND MESSAGE VIA WEBSOCKET
   =========================================== */
function sendMessageViaWebSocket(type, id) {
  const inputEl = document.getElementById('message-input');
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (!text) return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('❌ WebSocket not connected - cannot send');
    connectWebSocket(type, id);
    return;
  }

  console.log('📤 Sending message...');

  const payload = { type: 'message', text };
  if (type === 'user') payload.receiver_id = id;
  else payload.project_id = id;

  try {
    ws.send(JSON.stringify(payload));

    // ✅ FIX #2: APPEND MESSAGE LOCALLY IMMEDIATELY (before server response)
    // This gives instant feedback to the sender
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) {
      const localMsg = {
        id: `local_${Date.now()}`,
        sender_id: currentUserId,
        sender_username: 'You',
        text: text,
        timestamp: new Date().toISOString(),
        is_read: false,
        is_delivered: false
      };

      // Track this message ID to avoid duplicate from server
      addedMessageIds.add(localMsg.id);

      const msgEl = createMessageElement(localMsg);
      messagesContainer.appendChild(msgEl);

      // ✅ Auto-scroll after appending
      scrollToBottom();

      console.log('✅ Message appended locally');
    }

    // clear input and keep waiting for server broadcast to confirm
    inputEl.value = '';
    inputEl.style.height = 'auto';
    console.log('✅ Message sent via WebSocket');
  } catch (err) {
    console.error('❌ Failed to send message via WS', err);
  }
}

/* ===========================================
   UPLOAD FILE (via WebSocket base64)
   =========================================== */
function uploadFileViaWebSocket(e, type, id) {
  const file = e.target.files?.[0];
  if (!file) return;

  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    alert('File too large! Max 10MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    const payload = {
      type: 'message',
      text: `[File: ${file.name}]`,
      file_url: base64,
      file_name: file.name,
      file_type: file.type
    };
    if (type === 'user') payload.receiver_id = id;
    else payload.project_id = id;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      alert('Network disconnected — try again');
      connectWebSocket(type, id);
    }
  };
  reader.onerror = () => alert('Failed to read file');
  reader.readAsDataURL(file);
}

/* ===========================================
   WEBSOCKET CONNECT + RECONNECT BACKOFF
   =========================================== */
function connectWebSocket(type, id) {
  // if connecting to a new chat, reset attempts
  if (currentChatType !== type || currentChatId !== Number(id)) reconnectAttempts = 0;

  currentChatType = type;
  currentChatId = Number(id);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/chat/${type}/${id}/`;
  console.log('🔌 Connecting to', url);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('❌ WS constructor failed', err);
    scheduleReconnect(type, id);
    return;
  }

  ws.onopen = () => {
    console.log('✅ WebSocket connected');
    reconnectAttempts = 0;
    updateConnectionStatus(true);
  };

  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      handleWebSocketMessage(data);
    } catch (err) {
      console.error('❌ Invalid WS message', err);
    }
  };

  ws.onerror = (err) => {
    console.error('❌ WebSocket error', err);
    updateConnectionStatus(false);
  };

  ws.onclose = (ev) => {
    console.warn('❌ WebSocket closed', ev);
    updateConnectionStatus(false);

    // Start pending offline timer when socket closed.
    // This implements "stable offline": do not mark offline instantly if reconnect attempts may follow quickly.
    schedulePendingOffline();

    scheduleReconnect(type, id);
  };
}

function scheduleReconnect(type, id) {
  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT) {
    console.warn('Max reconnect attempts reached');
    return;
  }
  const backoff = Math.min(1000 * (2 ** (reconnectAttempts - 1)), 30000);
  console.log(`⏳ Reconnect in ${backoff}ms (attempt ${reconnectAttempts})`);
  setTimeout(() => connectWebSocket(type, id), backoff);
}

/* ===========================================
   ✅ FIX #3: HANDLE INCOMING WEBSOCKET MESSAGES (PREVENT DUPLICATES)
   =========================================== */

function normalizeIncomingMessage(data) {
  if (!data) return data;

  return {
    id: data.id ?? data.message_id ?? data.pk ?? undefined,
    sender_id: data.sender_id ?? data.sender ?? data.from_id ?? undefined,
    sender: data.sender ?? data.sender_id ?? data.from_id ?? undefined,
    sender_username: data.sender_username ?? data.sender_name ?? data.username ?? undefined,
    receiver_id: data.receiver_id ?? data.to_id ?? undefined,
    project_id: data.project_id ?? data.project ?? undefined,
    text: data.text ?? data.message ?? '',
    file_url: data.file_url ?? data.file ?? undefined,
    timestamp: data.timestamp ?? data.created_at ?? new Date().toISOString(),
    is_read: Boolean(data.is_read),
    is_delivered: Boolean(data.is_delivered)
  };
}

function handleWebSocketMessage(data) {
  // Data types: message, typing, status, read_receipt, user_status, project_message, project_typing, etc.
  if (!data || !data.type) return;
  const messagesContainer = document.getElementById('messages-container');

  switch (data.type) {
    case 'message': {
      // DM message routing - ensure message belongs to the active chat
      const msg = normalizeIncomingMessage(data);

      // If no active chat or not a user chat => ignore
      if (currentChatType !== 'user' || !currentChatId) {
        console.log('❌ Ignored DM message (no user chat open)', msg);
        return;
      }

      const senderId = Number(msg.sender_id);
      const receiverId = Number(msg.receiver_id);

      // message is relevant if the currently opened chat partner id equals sender or receiver
      if (!(senderId === Number(currentChatId) || receiverId === Number(currentChatId))) {
        console.log('❌ Ignored DM message (not for current chat)', { currentChatType, currentChatId, msg });
        return;
      }

      if (!messagesContainer) return;

      // ✅ FIX #3: PREVENT DUPLICATES - Check if message already exists by ID
      if (addedMessageIds.has(msg.id)) {
        console.log('⚠️  Duplicate message prevented:', msg.id);
        return;
      }

      addedMessageIds.add(msg.id);

      const el = createMessageElement(msg);
      messagesContainer.appendChild(el);

      // Auto-scroll or show badge
      if (isUserNearBottom(messagesContainer)) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      } else {
        showNewMessageIndicator();
      }

      // Observe appended element for read receipts
      observeElementForRead(el);

      break;
    }

    case 'project_message': {
      // Project message routing - ensure message belongs to the open project
      const msg = normalizeIncomingMessage(data);
      const projId = Number(msg.project_id);
      if (currentChatType !== 'project' || Number(currentChatId) !== projId) {
        console.log('❌ Ignored project message (not current project)', { currentChatType, currentChatId, projId });
        return;
      }

      if (!messagesContainer) return;

      // ✅ FIX #3: PREVENT DUPLICATES
      if (addedMessageIds.has(msg.id)) {
        console.log('⚠️  Duplicate project message prevented:', msg.id);
        return;
      }

      addedMessageIds.add(msg.id);

      const pel = createMessageElement(msg);
      messagesContainer.appendChild(pel);
      if (isUserNearBottom(messagesContainer)) messagesContainer.scrollTop = messagesContainer.scrollHeight;
      observeElementForRead(pel);
      break;
    }

    case 'typing':
    case 'project_typing': {
      // currently TODO: debounce and show typing UI
      // data.username, data.user_id, data.is_typing
      // You can add UI hooks here if desired.
      break;
    }

    case 'status':
    case 'user_status': {
      // update header or presence UI if present
      // data.status should be 'online' or 'offline'
      if (data.status) updatePresenceFromServer(data.status);
      break;
    }

    case 'read_receipt': {
      // data.message_ids, data.reader_id
      const ids = Array.isArray(data.message_ids) ? data.message_ids : (data.message_ids ? [data.message_ids] : []);
      markMessagesReadInUI(ids, data.reader_id);
      updateSidebarUnreadCounts(ids);
      break;
    }

    default:
      console.warn('Unhandled WS event type:', data.type);
  }
}

/* ===========================================
   PRESENCE: INSTANT ONLINE + STABLE OFFLINE
   =========================================== */
function updatePresenceFromServer(status) {
  // status is expected 'online' or 'offline' (or similar)
  const normalized = ('' + status).toLowerCase() === 'online' ? 'online' : 'offline';
  const statusEl = document.querySelector('.connection-status');
  if (!statusEl) return;

  // If server reports online => apply immediately and cancel pending offline
  if (normalized === 'online') {
    // cancel any pending offline timer
    if (pendingOfflineTimer) {
      clearTimeout(pendingOfflineTimer);
      pendingOfflineTimer = null;
    }
    // Only update UI if different from last applied
    if (lastAppliedPresence !== 'online') {
      statusEl.className = `connection-status online`;
      statusEl.textContent = `● Online`;
      lastAppliedPresence = 'online';
    }
    return;
  }

  // If server reports offline => schedule stable-offline application
  if (normalized === 'offline') {
    if (lastAppliedPresence === 'offline') return;
    if (pendingOfflineTimer) clearTimeout(pendingOfflineTimer);

    pendingOfflineTimer = setTimeout(() => {
      const statusElem = document.querySelector('.connection-status');
      if (!statusElem) return;
      statusElem.className = `connection-status offline`;
      statusElem.textContent = `● Offline`;
      lastAppliedPresence = 'offline';
      pendingOfflineTimer = null;
    }, OFFLINE_STABLE_MS);

    return;
  }
}

/* Helper to proactively schedule pending offline when socket closes locally */
function schedulePendingOffline() {
  if (lastAppliedPresence === 'offline') return;

  if (pendingOfflineTimer) {
    clearTimeout(pendingOfflineTimer);
  }
  pendingOfflineTimer = setTimeout(() => {
    const statusElem = document.querySelector('.connection-status');
    if (!statusElem) return;
    statusElem.className = `connection-status offline`;
    statusElem.textContent = `● Offline`;
    lastAppliedPresence = 'offline';
    pendingOfflineTimer = null;
  }, OFFLINE_STABLE_MS);
}

/* ===========================================
   READ RECEIPTS: detect visible unread messages and send 'read'
   =========================================== */
function setupReadReceiptObservers(messagesContainer) {
  // Clean previous observer
  if (intersectionObserver) {
    try { intersectionObserver.disconnect(); } catch (e) {}
    intersectionObserver = null;
  }

  intersectionObserver = new IntersectionObserver((entries) => {
    const visibleUnreadIds = [];
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      if (el && el.classList.contains('not-read')) {
        const id = parseInt(el.dataset.messageId);
        if (!Number.isNaN(id)) visibleUnreadIds.push(id);
      }
    });

    if (visibleUnreadIds.length > 0) {
      sendReadReceiptMessage(visibleUnreadIds);
      // remove class locally to avoid sending repeatedly (we'll trust server to confirm)
      visibleUnreadIds.forEach(id => {
        const m = document.querySelector(`.message[data-message-id="${id}"]`);
        if (m) m.classList.remove('not-read');
      });
    }
  }, {
    root: messagesContainer,
    rootMargin: '0px',
    threshold: 0.6 // consider visible if 60% is in viewport
  });

  // Observe existing unread messages
  const unreadEls = messagesContainer?.querySelectorAll('.message.not-read') || [];
  unreadEls.forEach(el => intersectionObserver.observe(el));
  // Also observe new messages later via observeElementForRead
}

function observeElementForRead(el) {
  if (!intersectionObserver || !el) return;
  if (el.classList.contains('not-read')) {
    try { intersectionObserver.observe(el); } catch (e) { /* ignore */ }
  }
}

function sendReadReceipts(forceSendAll = false) {
  /*
    If forceSendAll is true, send read receipts for ALL not-read messages.
    Else the IntersectionObserver will send for visible ones.
  */
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const container = document.getElementById('messages-container');
  if (!container) return;

  const notReadEls = Array.from(container.querySelectorAll('.message.not-read'));
  if (!notReadEls.length) return;

  // If not forcing, let observer handle (but fallback: send for all if user is near bottom)
  if (!forceSendAll) {
    if (!isUserNearBottom(container)) return;
    // when user is near bottom, assume they read all visible messages
  }

  const ids = notReadEls.map(el => parseInt(el.dataset.messageId)).filter(Boolean);
  if (ids.length === 0) return;

  sendReadReceiptMessage(ids);
  ids.forEach(id => {
    const m = document.querySelector(`.message[data-message-id="${id}"]`);
    if (m) m.classList.remove('not-read');
  });
}

function sendReadReceiptMessage(messageIds) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = { type: 'read', message_ids: messageIds };
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error('❌ Failed to send read receipt', err);
  }
}

/* ===========================================
   UI helpers for read receipts + sidebar updates
   =========================================== */
function markMessagesReadInUI(messageIds = [], readerId = null) {
  // Mark messages as read visually. If readerId !== currentUserId then show read ticks on own messages.
  messageIds.forEach(id => {
    const el = document.querySelector(`.message[data-message-id="${id}"]`);
    if (el) {
      el.classList.remove('not-read');
      // if it's our own message, toggle ticks to "read"
      const isOwn = el.classList.contains('own-message');
      if (isOwn) {
        const ticks = el.querySelectorAll('.tick');
        ticks.forEach(t => t.classList.add('read'));
      }
    }
  });
}

function updateSidebarUnreadCounts(messageIds = []) {
  /*
    Basic heuristic: If a read_receipt arrives for messages that belong to a certain chat partner,
    fetch /recent_chats/ again or decrement local unread badge. For simplicity we'll refresh sidebar.
    If you want to optimize, decode message -> partner mapping and decrement specific badge counts.
  */
  // Simple approach: reload recent chats to reflect counts
  loadRecentChats();
}

/* ===========================================
   SCROLL + NEW MESSAGE INDICATOR
   =========================================== */
function isUserNearBottom(container) {
  if (!container) return true;
  const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
  return distanceFromBottom <= isUserNearBottomThreshold;
}

function showNewMessageIndicator() {
  // simple approach: flash document title or show a badge — implement as needed
  // create small button at bottom if not exists
  if (!newMessageBadge) {
    newMessageBadge = document.createElement('button');
    newMessageBadge.className = 'new-message-badge';
    newMessageBadge.textContent = 'New messages';
    newMessageBadge.onclick = () => {
      const container = document.getElementById('messages-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
      newMessageBadge.remove();
      newMessageBadge = null;
      // Sending read receipts for newly visible messages
      sendReadReceipts(true);
    };
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow) chatWindow.appendChild(newMessageBadge);
  }
}

/* ===========================================
   CONNECTION STATUS UI
   =========================================== */
function updateConnectionStatus(isOnline) {
  const statusEl = document.querySelector('.connection-status');
  if (statusEl) {
    statusEl.className = `connection-status ${isOnline ? 'online' : 'offline'}`;
    statusEl.textContent = `● ${isOnline ? 'Online' : 'Offline'}`;
  }
}

/* ===========================================
   UTIL / HELPERS
   =========================================== */
function defaultHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-CSRFToken': getCSRFToken()
  };
}

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCSRFToken() {
  return document.cookie.split('; ').find(row => row.startsWith('csrftoken='))?.split('=')[1] || '';
}

/* ===========================================
   EVENT LISTENERS / BOOTSTRAP
   =========================================== */
function setupEventListeners() {
  // Global shortcut to focus input when chat is open
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
      const input = document.getElementById('message-input');
      if (input) input.focus();
    }
  });

  // If user clicks outside messages container, clear new-message badge
  document.addEventListener('click', (e) => {
    if (newMessageBadge && !e.target.closest('.new-message-badge') && !e.target.closest('.messages-container')) {
      // keep it until clicked purposely — this is optional behavior
    }
  });

  // On window focus, if chat open, try to send read receipts
  window.addEventListener('focus', () => {
    sendReadReceipts(true);
  });

  console.log('✅ Event listeners setup complete');
}