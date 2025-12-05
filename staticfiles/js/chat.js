/* ============================================================
   CHAT.JS - WITH FILES DISPLAY IN RIGHT SIDEBAR
   ============================================================
   Displays on RIGHT sidebar:
   - Chat avatar with initials (1-to-1)
   - Chat name (1-to-1)
   - Files shared count (1-to-1)
   - Total messages count (1-to-1)
   - ALL shared files list (1-to-1) ✨ NEW!
   - Project members (projects)
   ============================================================ */

const API_BASE = '/chat/api';
let currentChatType = null;
let currentChatId = null;
let ws = null;
let currentUserId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 8;
let intersectionObserver = null;
let isUserNearBottomThreshold = 150;
let newMessageBadge = null;

// Presence control
let pendingOfflineTimer = null;
const OFFLINE_STABLE_MS = 2000;
let lastAppliedPresence = null;

// Message tracking
let addedMessageIds = new Set();
const localMessageMap = new Map();
const messageTextCache = new Map();

// Member sidebar tracking
let currentProjectMembers = new Map();
let currentProjectId = null;

// Chat metadata cache
let chatMetadata = new Map();

/* ============================================================
   INITIALIZE APP
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Chat app initializing...');

  currentUserId = window.currentUserId ||
    parseInt(document.querySelector('[data-user-id]')?.getAttribute('data-user-id') || '0') ||
    parseInt(document.body.parentElement.getAttribute('data-user-id') || '0');

  console.log('✅ Current user ID:', currentUserId);

  if (!currentUserId || currentUserId === 0) {
    console.error('❌ User ID not found in page!');
  }

  loadRecentChats();
  loadProjects();
  setupEventListeners();
});

/* ============================================================
   RECENT CHATS (LEFT SIDEBAR) - CLEAN, NO METADATA
   ============================================================ */

async function loadRecentChats() {
  try {
    const url = `${API_BASE}/messages/recent_chats/`;
    const res = await fetch(url, { headers: defaultHeaders() });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const chats = await res.json();

    // Load chat metadata (for right sidebar display later)
    for (const chat of chats) {
      await loadChatMetadata('user', chat.user.id);
    }

    renderRecentChats(chats);
  } catch (err) {
    console.error('❌ Error loading recent chats:', err);
  }
}

async function loadChatMetadata(type, id) {
  try {
    if (type !== 'user') return;

    const key = `user_${id}`;
    if (chatMetadata.has(key)) return; // Already loaded

    // Fetch all messages to get files count and metadata
    const url = `${API_BASE}/messages/user/${id}/`;
    const res = await fetch(url, { headers: defaultHeaders() });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const messages = await res.json();

    let filesCount = 0;
    let lastActivityTime = null;
    const files = []; // ✅ NEW: Store all files

    if (Array.isArray(messages)) {
      messages.forEach(msg => {
        if (msg.file_url) {
          filesCount++;
          // ✅ NEW: Add file details
          files.push({
            name: msg.file_name || extractFileNameFromUrl(msg.file_url),
            url: msg.file_url,
            size: msg.file_size || 0,
            type: msg.file_type || '',
            timestamp: msg.timestamp
          });
        }
        if (msg.timestamp && (!lastActivityTime || new Date(msg.timestamp) > new Date(lastActivityTime))) {
          lastActivityTime = msg.timestamp;
        }
      });
    }

    chatMetadata.set(key, {
      filesCount,
      lastActivity: lastActivityTime,
      messageCount: messages.length,
      files: files // ✅ NEW: Store files array
    });

    console.log(`✅ Chat metadata loaded for user ${id}:`, chatMetadata.get(key));
  } catch (err) {
    console.error('❌ Error loading chat metadata:', err);
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
  chats.forEach(chat => container.appendChild(createChatItem(chat)));
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

/* ============================================================
   PROJECTS (LEFT SIDEBAR)
   ============================================================ */

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

/* ============================================================
   OPEN CHAT - Main entry point
   ============================================================ */

function openChat(type, id) {
  console.log(`🔓 Opening ${type} chat with id ${id}`);
  currentChatType = type;
  currentChatId = Number(id);

  try {
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    if (window.event?.target) {
      const el = window.event.target.closest('.chat-item');
      if (el) el.classList.add('active');
    }
  } catch (e) {
    console.warn('Could not update active state:', e);
  }

  addedMessageIds.clear();
  localMessageMap.clear();

  if (type === 'project') {
    currentProjectId = id;
    loadProjectMembers(id);
  } else {
    currentProjectId = null;
  }

  loadChatWindow(type, id);
  connectWebSocket(type, id);
}

/* ============================================================
   LOAD CHAT WINDOW
   ============================================================ */

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
          <button id="message-search-btn" style="margin-left:8px;border:none;background:#e5e7eb;color:#111827;border-radius:6px;padding:6px 8px;cursor:pointer">🔎</button>
        </div>
      </div>
      <div class="messages-container" id="messages-container" tabindex="0" style="user-select: none"></div>
      <div id="reply-preview" class="reply-preview" style="display:none; padding:6px 10px; border-top:2px solid #d1d5db; border-bottom:2px solid #d1d5db; background:#f9fafb"></div>
      <div class="message-input-area">
        <div class="input-wrapper">
          <textarea id="message-input" class="message-input" placeholder="Type a message..." rows="1"></textarea>
          <button id="file-upload-btn" class="file-upload-btn" title="Upload file">📎</button>
          <button id="send-btn" class="send-btn">Send</button>
        </div>
      </div>
    `;

    const messagesContainer = document.getElementById('messages-container');

    if (Array.isArray(messages) && messages.length > 0) {
      try { messages.forEach(m => { if (m && m.id != null) messageTextCache.set(Number(m.id), m.text || ''); }); } catch (e) { }
      messages.forEach(msg => {
        addedMessageIds.add(msg.id);
        messagesContainer.appendChild(createMessageElement(msg));
      });
    }

    setupMessageInputHandlers(type, id);
    setupMessageSearchPanel();
    setupReadReceiptObservers(messagesContainer);
    scrollToBottom();

    setTimeout(() => sendReadReceipts(true), 150);

    // ✅ NEW: Display chat info & files on right sidebar
    displayChatInfoOnSidebar(type, id, headerName);

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

/* ============================================================
   DISPLAY CHAT INFO & FILES ON RIGHT SIDEBAR
   ============================================================ */

function displayChatInfoOnSidebar(type, id, chatName) {
  const chatInfoSection = document.querySelector('.chat-info-section');
  const filesSection = document.getElementById('files-section');
  const filesList = document.getElementById('files-list');

  if (!chatInfoSection) return;

  // Show/hide sections based on chat type
  if (type === 'project') {
    chatInfoSection.style.display = 'none';
    if (filesSection) filesSection.style.display = 'none';
    const membersHeader = document.getElementById('members-header');
    if (membersHeader) membersHeader.style.display = 'flex';
  } else {
    chatInfoSection.style.display = 'block';
    if (filesSection) filesSection.style.display = 'flex';
    const membersHeader = document.getElementById('members-header');
    if (membersHeader) membersHeader.style.display = 'none';
  }

  const avatar = document.getElementById('chat-info-avatar');
  const name = document.getElementById('chat-info-name');
  const filesCount = document.getElementById('chat-files-count');
  const messagesCount = document.getElementById('chat-messages-count');

  if (avatar && name && filesCount && messagesCount) {
    const initials = (chatName?.[0] || 'U').toUpperCase();
    avatar.textContent = initials;
    name.textContent = chatName;

    const metadataKey = `user_${id}`;
    const meta = chatMetadata.get(metadataKey) || {
      filesCount: 0,
      messageCount: 0,
      files: []
    };

    filesCount.textContent = `${meta.filesCount} file${meta.filesCount !== 1 ? 's' : ''}`;
    messagesCount.textContent = `${meta.messageCount} message${meta.messageCount !== 1 ? 's' : ''}`;

    // ✅ NEW: Display all shared files in right sidebar
    if (filesList) {
      displaySharedFiles(meta.files || []);
    }

    console.log(`✅ Chat info displayed for ${chatName}:`, meta);
  }
}

/* ============================================================
   DISPLAY SHARED FILES IN RIGHT SIDEBAR
   ============================================================ */

function displaySharedFiles(files) {
  const filesList = document.getElementById('files-list');
  if (!filesList) return;

  filesList.innerHTML = '';

  if (!Array.isArray(files) || files.length === 0) {
    filesList.innerHTML = '<div class="files-empty">📭 No files shared</div>';
    return;
  }

  files.forEach(file => {
    const fileItem = createFileItem(file);
    filesList.appendChild(fileItem);
  });

  console.log(`✅ ${files.length} files displayed in sidebar`);
}

/* ============================================================
   CREATE FILE ITEM ELEMENT
   ============================================================ */

function createFileItem(file) {
  const div = document.createElement('div');
  div.className = 'file-item';
  div.title = file.name || file.file_name || 'File';

  const fileName = file.name || file.file_name || 'file.bin';
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const icon = getFileIcon(ext, fileName);
  const sizeText = formatFileSize(file.size || 0);

  const iconDiv = document.createElement('div');
  iconDiv.className = 'file-icon';
  iconDiv.textContent = icon;

  const infoDiv = document.createElement('div');
  infoDiv.className = 'file-info';

  const nameDiv = document.createElement('div');
  nameDiv.className = 'file-name';
  nameDiv.textContent = truncateFileName(fileName, 20);

  const sizeDiv = document.createElement('div');
  sizeDiv.className = 'file-size';
  sizeDiv.textContent = sizeText;

  infoDiv.appendChild(nameDiv);
  infoDiv.appendChild(sizeDiv);

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'file-download';
  downloadBtn.textContent = '⬇️';
  downloadBtn.title = 'Download file';
  downloadBtn.onclick = (e) => {
    e.stopPropagation();
    if (file.url || file.file_url) {
      window.open(file.url || file.file_url, '_blank');
    }
  };

  div.onclick = () => {
    if (file.url || file.file_url) {
      window.open(file.url || file.file_url, '_blank');
    }
  };

  div.appendChild(iconDiv);
  div.appendChild(infoDiv);
  div.appendChild(downloadBtn);

  return div;
}

/* ============================================================
   GET FILE ICON BASED ON TYPE
   ============================================================ */

function getFileIcon(ext, fileName) {
  const iconMap = {
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'bmp': '🖼️', 'svg': '🖼️',
    'pdf': '📄', 'doc': '📝', 'docx': '📝', 'txt': '📄', 'rtf': '📝',
    'xls': '📊', 'xlsx': '📊', 'csv': '📊',
    'ppt': '🎯', 'pptx': '🎯',
    'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦',
    'mp3': '🎵', 'wav': '🎵', 'm4a': '🎵', 'aac': '🎵', 'flac': '🎵',
    'mp4': '🎬', 'webm': '🎬', 'avi': '🎬', 'mov': '🎬', 'mkv': '🎬', 'flv': '🎬',
    'js': '</>', 'py': '🐍', 'java': '☕', 'cpp': 'C++', 'c': 'C', 'html': '🌐', 'css': '🎨', 'json': '{}',
    'default': '📁'
  };

  return iconMap[ext] || iconMap['default'];
}

/* ============================================================
   FORMAT FILE SIZE
   ============================================================ */

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/* ============================================================
   TRUNCATE LONG FILE NAMES
   ============================================================ */

function truncateFileName(name, maxLength) {
  if (name.length <= maxLength) return name;
  const ext = name.split('.').pop();
  const nameWithoutExt = name.substring(0, name.length - ext.length - 1);
  const availableLength = maxLength - ext.length - 4;
  return nameWithoutExt.substring(0, availableLength) + '...' + '.' + ext;
}

/* ============================================================
   EXTRACT FILE NAME FROM URL
   ============================================================ */

function extractFileNameFromUrl(url) {
  if (!url) return 'file.bin';
  const parts = url.split('/');
  const fileName = parts[parts.length - 1];
  return fileName.split('?')[0] || 'file.bin';
}

function scrollToBottom() {
  const messagesContainer = document.getElementById('messages-container');
  if (messagesContainer) {
    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 50);
  }
}

/* ============================================================
   MESSAGE ELEMENT CREATION
   ============================================================ */

function createMessageElement(msg) {
  const div = document.createElement('div');
  div.className = 'message';
  if (msg.id !== undefined) div.dataset.messageId = msg.id;
  if (msg.id !== undefined && isDeletedForMe(msg.id)) { div.style.display = 'none'; }
  if (msg.reply_to_id !== undefined) div.dataset.replyToId = msg.reply_to_id;

  const isOwn = (Number(msg.sender) === Number(currentUserId) ||
    Number(msg.sender_id) === Number(currentUserId) ||
    Number(msg.user_id) === Number(currentUserId) ||
    Number(msg.author) === Number(currentUserId));

  if (isOwn) div.classList.add('own-message');
  else div.classList.add('other-message');

  if (!msg.is_read) div.classList.add('not-read');

  if (!isOwn && msg.sender_username) {
    const senderEl = document.createElement('div');
    senderEl.className = 'message-sender';
    senderEl.textContent = msg.sender_username;
    div.appendChild(senderEl);
  }

  const content = document.createElement('div');
  content.className = 'message-body';

  const textEl = document.createElement('div');
  textEl.className = 'message-content';
  textEl.textContent = msg.text || '';
  content.appendChild(textEl);

  const persistedReply = msg.id !== undefined ? getReplyForMessage(msg.id) : null;
  const effectiveReplyId = msg.reply_to_id ?? persistedReply?.reply_to_id;
  if (effectiveReplyId) {
    const refEl = document.querySelector(`.message[data-message-id="${effectiveReplyId}"] .message-content`);
    const quote = document.createElement('div');
    quote.className = 'message-quote';
    quote.style.borderLeft = '3px solid #bfdbfe';
    quote.style.background = '#538dff';
    quote.style.padding = '6px 8px';
    quote.style.margin = '6px 0 8px 0';
    quote.style.borderRadius = '6px';
    const fallbackText = persistedReply?.reply_text || messageTextCache.get(Number(effectiveReplyId)) || 'Quoted message';
    quote.textContent = refEl ? refEl.textContent : fallbackText;
    content.insertBefore(quote, textEl);
  }

  if (msg.file_url) {
    const fileAttachment = document.createElement('div');
    fileAttachment.className = 'file-attachment';
    const ext = (msg.file_url.split('.').pop() || '').toLowerCase();

    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
      const img = document.createElement('img');
      img.src = msg.file_url;
      img.alt = 'attachment';
      img.loading = 'lazy';
      img.style.maxWidth = '100%';
      img.style.borderRadius = '6px';
      img.onclick = () => window.open(msg.file_url, '_blank');
      fileAttachment.appendChild(img);
    } else if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) {
      const video = document.createElement('video');
      video.src = msg.file_url;
      video.controls = true;
      video.style.maxWidth = '100%';
      fileAttachment.appendChild(video);
    } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
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

  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.appendChild(time);

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

  setupMessageInteractions(div, msg);
  renderPersistedReactions(div, msg.id);

  return div;
}
function getList(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function setList(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }
function toggleStar(id, el) { const key = 'starred_messages'; const list = getList(key); const idx = list.indexOf(id); if (idx >= 0) { list.splice(idx, 1); } else { list.push(id); addBadge(el, '★'); } setList(key, list); }
function togglePin(id, el) { const key = 'pinned_messages'; const list = getList(key); const idx = list.indexOf(id); if (idx >= 0) { list.splice(idx, 1); } else { list.push(id); addBadge(el, '📌'); } setList(key, list); }
function deleteForMe(id, el) { const key = 'deleted_for_me'; const list = getList(key); if (!list.includes(id)) list.push(id); setList(key, list); el.style.display = 'none'; }
function isDeletedForMe(id) { return getList('deleted_for_me').includes(id); }
function addBadge(el, sym) { const meta = el.querySelector('.message-meta'); if (!meta) return; const badge = document.createElement('span'); badge.textContent = sym; badge.style.marginLeft = '8px'; badge.style.fontSize = '12px'; meta.appendChild(badge); }
function toggleSelect(el) { const on = el.classList.toggle('selected'); el.style.outline = on ? '2px solid #2563eb' : 'none'; }
async function shareMessage(msg) { const text = msg.text || ''; const url = msg.file_url || ''; try { if (navigator.share) { await navigator.share({ text, url }); } else { await navigator.clipboard.writeText(text + (url ? `\n${url}` : '')); } } catch (e) { } }
let searchMatches = []; let searchIndex = -1; function setupMessageSearchPanel() { const btn = document.getElementById('message-search-btn'); if (!btn) return; btn.onclick = () => { openMessageSearchPanel(); }; }
function openMessageSearchPanel() { let panel = document.getElementById('message-search-panel'); if (panel) { panel.style.display = 'flex'; const inp = panel.querySelector('input'); if (inp) inp.focus(); return; } panel = document.createElement('div'); panel.id = 'message-search-panel'; panel.style.position = 'fixed'; panel.style.left = '12px'; panel.style.top = '12px'; panel.style.zIndex = '1001'; panel.style.background = '#111827'; panel.style.color = '#ffffff'; panel.style.border = '1px solid #374151'; panel.style.borderRadius = '8px'; panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)'; panel.style.padding = '8px'; panel.style.display = 'flex'; panel.style.gap = '6px'; const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Search messages'; inp.style.padding = '6px 8px'; inp.style.border = '1px solid #374151'; inp.style.borderRadius = '6px'; inp.style.background = '#111827'; inp.style.color = '#ffffff'; inp.style.minWidth = '200px'; const prev = document.createElement('button'); prev.textContent = '◀'; prev.style.border = '1px solid #374151'; prev.style.borderRadius = '6px'; prev.style.background = '#1f2937'; prev.style.color = '#ffffff'; prev.style.padding = '6px 8px'; prev.style.cursor = 'pointer'; const next = document.createElement('button'); next.textContent = '▶'; next.style.border = '1px solid #374151'; next.style.borderRadius = '6px'; next.style.background = '#1f2937'; next.style.color = '#ffffff'; next.style.padding = '6px 8px'; next.style.cursor = 'pointer'; const close = document.createElement('button'); close.textContent = '✕'; close.style.border = '1px solid #374151'; close.style.borderRadius = '6px'; close.style.background = '#1f2937'; close.style.color = '#ffffff'; close.style.padding = '6px 8px'; close.style.cursor = 'pointer'; const clear = document.createElement('button'); clear.textContent = 'Clear'; clear.style.border = '1px solid #374151'; clear.style.borderRadius = '6px'; clear.style.background = '#1f2937'; clear.style.color = '#ffffff'; clear.style.padding = '6px 8px'; clear.style.cursor = 'pointer'; panel.appendChild(inp); panel.appendChild(prev); panel.appendChild(next); panel.appendChild(clear); panel.appendChild(close); document.body.appendChild(panel); const run = () => { const term = (inp.value || '').trim().toLowerCase(); const container = document.getElementById('messages-container'); if (!container) { return; } const items = container.querySelectorAll('.message'); searchMatches = []; searchIndex = -1; items.forEach(el => { el.classList.remove('search-match'); const body = el.querySelector('.message-content'); const quote = el.querySelector('.message-quote'); const txt = ((body?.textContent) || '') + ' ' + ((quote?.textContent) || ''); if (term && txt.toLowerCase().includes(term)) { el.classList.add('search-match'); searchMatches.push(el); } }); if (searchMatches.length) { searchIndex = 0; focusSearchMatch(searchIndex); } }; inp.oninput = run; prev.onclick = () => { if (!searchMatches.length) return; searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length; focusSearchMatch(searchIndex); }; next.onclick = () => { if (!searchMatches.length) return; searchIndex = (searchIndex + 1) % searchMatches.length; focusSearchMatch(searchIndex); }; clear.onclick = () => { inp.value = ''; run(); }; close.onclick = () => { panel.style.display = 'none'; }; inp.focus(); }
function focusSearchMatch(i) { const el = searchMatches[i]; if (!el) return; const container = document.getElementById('messages-container'); if (container) { const rect = el.getBoundingClientRect(); const cRect = container.getBoundingClientRect(); const offset = rect.top - cRect.top + container.scrollTop - 40; container.scrollTop = offset; } try { searchMatches.forEach(e => { e.style.outline = 'none'; e.style.background = ''; }); el.style.outline = '2px solid #f59e0b'; el.style.background = 'rgba(245,158,11,0.08)'; } catch (e) { } }
// Reactions persistence
function getReactionStore() { try { return JSON.parse(localStorage.getItem('reactions_store') || '{}'); } catch (e) { return {}; } }
function setReactionStore(store) { localStorage.setItem('reactions_store', JSON.stringify(store)); }
function renderPersistedReactions(el, id) { if (!id) return; const store = getReactionStore(); const arr = store[id] || []; let container = el.querySelector('.message-reactions'); if (!arr.length) { if (container) { try { container.remove(); } catch (e) { } } return; } if (!container) { container = document.createElement('div'); container.className = 'message-reactions'; container.style.marginTop = '6px'; container.style.display = 'inline-flex'; container.style.gap = '6px'; container.style.alignItems = 'center'; el.querySelector('.message-body').appendChild(container); } container.innerHTML = ''; arr.forEach(emoji => { const badge = document.createElement('button'); badge.type = 'button'; badge.textContent = emoji; badge.style.padding = '2px 6px'; badge.style.border = '1px solid #d1d5db'; badge.style.borderRadius = '12px'; badge.style.background = '#ffffff'; badge.style.cursor = 'pointer'; badge.onclick = () => { toggleReaction(id, emoji, el); }; container.appendChild(badge); }); }
function toggleReaction(id, emoji, el) { const store = getReactionStore(); const arr = store[id] || []; const idx = arr.indexOf(emoji); if (idx >= 0) arr.splice(idx, 1); else arr.push(emoji); store[id] = arr; setReactionStore(store); renderPersistedReactions(el, id); }
// Replies persistence
function getRepliesStore() { try { return JSON.parse(localStorage.getItem('replies_store') || '{}'); } catch (e) { return {}; } }
function setRepliesStore(store) { localStorage.setItem('replies_store', JSON.stringify(store)); }
function setReplyForMessage(id, reply_to_id, reply_text) { const store = getRepliesStore(); store[id] = { reply_to_id, reply_text }; setRepliesStore(store); }
function getReplyForMessage(id) { const store = getRepliesStore(); return store[id] || null; }

/* ============================================================
   MESSAGE INPUT HANDLERS
   ============================================================ */

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

let pendingReplyTo = null;
const REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

function setupMessageInteractions(el, msg) {
  let pressTimer = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let swiped = false;
  let swipeDir = null;
  let mouseDown = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); });

  const showReactions = () => {
    const bar = document.createElement('div');
    bar.className = 'reaction-bar';
    bar.style.position = 'absolute';
    bar.style.zIndex = '1000';
    bar.style.background = '#ffffff';
    bar.style.border = '1px solid #d1d5db';
    bar.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)';
    bar.style.borderRadius = '20px';
    bar.style.padding = '6px 8px';
    bar.style.display = 'flex';
    bar.style.gap = '6px';
    const rect = el.getBoundingClientRect();
    bar.style.left = `${rect.left + window.scrollX + 16}px`;
    bar.style.top = `${rect.top + window.scrollY - 40}px`;

    REACTIONS.forEach(r => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = r;
      b.style.fontSize = '16px';
      b.style.lineHeight = '16px';
      b.style.background = 'transparent';
      b.style.border = 'none';
      b.style.cursor = 'pointer';
      try {
        const store = getReactionStore();
        const arr = store[msg.id] || store[String(msg.id)] || [];
        if (arr.includes(r)) {
          b.style.background = '#fde68a';
          b.style.borderRadius = '50%';
        }
      } catch (e) { }
      b.onclick = () => {
        applyReaction(msg.id, r, el);
        bar.remove();
      };
      bar.appendChild(b);
    });

    document.body.appendChild(bar);
    const remove = () => { try { bar.remove(); } catch (e) { } };
    setTimeout(() => {
      document.addEventListener('click', remove, { once: true });
    }, 0);
  };

  const showActions = () => {
    const menu = document.createElement('div');
    menu.style.position = 'absolute';
    menu.style.background = '#111827';
    menu.style.color = '#ffffff';
    menu.style.border = '1px solid #374151';
    menu.style.borderRadius = '10px';
    menu.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
    menu.style.padding = '8px';
    menu.style.minWidth = '180px';
    menu.style.position = 'fixed';
    menu.style.zIndex = '1000';
    menu.style.visibility = 'hidden';

    const mkItem = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.display = 'block';
      b.style.width = '100%';
      b.style.textAlign = 'left';
      b.style.padding = '8px 10px';
      b.style.margin = '2px 0';
      b.style.border = 'none';
      b.style.background = 'transparent';
      b.style.color = '#ffffff';
      b.style.cursor = 'pointer';
      b.onmouseenter = () => { b.style.background = '#1f2937'; };
      b.onmouseleave = () => { b.style.background = 'transparent'; };
      return b;
    };

    const replyItem = mkItem('Reply');
    replyItem.onclick = () => { startReplyTo(msg.id); close(); };
    const copyItem = mkItem('Copy');
    copyItem.onclick = async () => {
      try {
        const text = el.querySelector('.message-content')?.textContent || msg.text || '';
        await navigator.clipboard.writeText(text);
      } catch { }
      close();
    };
    const forwardItem = mkItem('Forward');
    forwardItem.onclick = () => { openForwardPicker(msg); close(); };
    const starItem = mkItem('Star');
    starItem.onclick = () => { toggleStar(msg.id, el); close(); };
    const pinItem = mkItem('Pin');
    pinItem.onclick = () => { togglePin(msg.id, el); close(); };
    const deleteItem = mkItem('Delete for me');
    deleteItem.onclick = () => { deleteForMe(msg.id, el); close(); };
    const selectItem = mkItem('Select');
    selectItem.onclick = () => { toggleSelect(el); };
    const shareItem = mkItem('Share');
    shareItem.onclick = async () => { await shareMessage(msg); close(); };

    menu.appendChild(replyItem);
    menu.appendChild(copyItem);
    menu.appendChild(forwardItem);
    menu.appendChild(starItem);
    menu.appendChild(pinItem);
    menu.appendChild(deleteItem);
    menu.appendChild(selectItem);
    menu.appendChild(shareItem);

    const reactionsRow = document.createElement('div');
    reactionsRow.style.display = 'flex';
    reactionsRow.style.gap = '8px';
    reactionsRow.style.borderTop = '1px solid #374151';
    reactionsRow.style.marginTop = '6px';
    reactionsRow.style.paddingTop = '6px';
    REACTIONS.forEach(r => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = r;
      b.style.fontSize = '16px';
      b.style.background = 'transparent';
      b.style.border = 'none';
      b.style.cursor = 'pointer';
      b.onclick = () => { applyReaction(msg.id, r, el); close(); };
      reactionsRow.appendChild(b);
    });
    menu.appendChild(reactionsRow);

    const close = () => { try { menu.remove(); overlay.remove(); } catch (e) { } };
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.background = 'transparent';
    overlay.onclick = close;
    document.body.appendChild(overlay);
    document.body.appendChild(menu);

    try {
      const rect = el.getBoundingClientRect();
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const isOwn = el.classList.contains('own-message');
      let left = isOwn ? (rect.right - mw - 8) : (rect.left + 8);
      let top = rect.top - mh - 8;
      if (top < 8) top = rect.bottom + 8;
      const maxLeft = window.innerWidth - mw - 8;
      if (left < 8) left = 8;
      if (left > maxLeft) left = maxLeft;
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    } catch (e) { }
    menu.style.visibility = 'visible';
  };

  const onLongPress = () => { showReactions(); };

  const startPress = () => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(onLongPress, 500);
  };
  const cancelPress = () => { clearTimeout(pressTimer); };

  // Mouse long-press, swipe and click
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    mouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    startPress();
  });
  el.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 25) {
      swiped = true;
      swipeDir = dx > 0 ? 'right' : 'left';
      cancelPress();
    }
  });
  el.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    mouseDown = false;
    const wasSwiped = swiped; swiped = false;
    cancelPress();
    if (wasSwiped) {
      if (swipeDir === 'right') startReplyTo(msg.id);
      else showActions();
    }
  });
  el.addEventListener('mouseleave', () => { mouseDown = false; cancelPress(); });
  el.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    showActions();
  });

  el.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      swiped = false;
    }
    startPress();
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!e.touches || !e.touches[0]) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 25) {
      swiped = true;
      swipeDir = dx > 0 ? 'right' : 'left';
      cancelPress();
    }
  }, { passive: true });
  el.addEventListener('touchend', () => {
    cancelPress();
    if (swiped) {
      if (swipeDir === 'right') startReplyTo(msg.id);
      else showActions();
    }
  });
}

function applyReaction(messageId, emoji, el) { toggleReaction(messageId, emoji, el); }

function startReplyTo(messageId) {
  pendingReplyTo = messageId;
  const preview = document.getElementById('reply-preview');
  const refEl = document.querySelector(`.message[data-message-id="${messageId}"] .message-content`);
  if (preview) {
    preview.style.display = 'flex';
    preview.style.alignItems = 'center';
    preview.style.gap = '8px';
    preview.innerHTML = '';
    const label = document.createElement('div');
    label.textContent = 'Replying to:';
    label.style.fontSize = '12px';
    label.style.color = '#6b7280';
    const text = document.createElement('div');
    text.textContent = refEl ? refEl.textContent : 'Quoted message';
    text.style.fontSize = '12px';
    text.style.color = '#374151';
    text.style.flex = '1';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.fontSize = '12px';
    cancel.style.border = '1px solid #d1d5db';
    cancel.style.borderRadius = '6px';
    cancel.style.padding = '4px 8px';
    cancel.onclick = () => { pendingReplyTo = null; preview.style.display = 'none'; };
    preview.appendChild(label);
    preview.appendChild(text);
    preview.appendChild(cancel);
  }
  const input = document.getElementById('message-input');
  if (input) input.focus();
}

function openForwardPicker(msg) {
  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.left = '50%';
  modal.style.top = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  modal.style.background = '#ffffff';
  modal.style.border = '2px solid #d1d5db';
  modal.style.boxShadow = '0 20px 40px rgba(0,0,0,0.2)';
  modal.style.borderRadius = '12px';
  modal.style.width = '360px';
  modal.style.maxWidth = '90vw';
  modal.style.maxHeight = '70vh';
  modal.style.overflow = 'auto';
  modal.style.padding = '12px';

  const title = document.createElement('h4');
  title.textContent = 'Forward to';
  title.style.margin = '0 0 8px 0';
  modal.appendChild(title);

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '6px';
  modal.appendChild(list);

  const close = () => { try { overlay.remove(); modal.remove(); } catch (e) { } };
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.right = '0';
  overlay.style.bottom = '0';
  overlay.style.background = 'rgba(0,0,0,0.2)';
  overlay.onclick = close;
  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  const addItem = (label, type, id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.textAlign = 'left';
    b.style.padding = '8px 10px';
    b.style.border = '1px solid #d1d5db';
    b.style.borderRadius = '8px';
    b.style.background = '#f9fafb';
    b.onclick = async () => { await forwardMessageToTarget(type, id, msg); close(); };
    list.appendChild(b);
  };

  fetch(`${API_BASE}/messages/recent_chats/`, { headers: defaultHeaders() })
    .then(res => res.ok ? res.json() : [])
    .then(chats => {
      if (Array.isArray(chats)) chats.forEach(c => addItem(`User: ${c.user?.username || c.user?.email || c.user?.id}`, 'user', c.user?.id));
    })
    .catch(() => { });

  fetch(`${API_BASE}/projects/`, { headers: defaultHeaders() })
    .then(res => res.ok ? res.json() : [])
    .then(projects => {
      if (Array.isArray(projects)) projects.forEach(p => addItem(`Project: ${p.name}`, 'project', p.id));
    })
    .catch(() => { });
}

async function forwardMessageToTarget(type, id, msg) {
  const payload = {
    type: 'message',
    text: `Forwarded: ${msg.text || ''}`,
  };
  if (msg.file_url) payload.file_url = msg.file_url;
  if (type === 'user') payload.receiver_id = id; else payload.project_id = id;

  await sendMessageToTargetViaWebSocket(type, id, payload);
}

function sendMessageToTargetViaWebSocket(type, id, payload) {
  return new Promise((resolve) => {
    try {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${location.host}/ws/chat/${type}/${id}/`;
      const sok = new WebSocket(url);
      sok.onopen = () => { try { sok.send(JSON.stringify(payload)); } catch (e) { } setTimeout(() => { try { sok.close(); } catch (e) { } resolve(); }, 150); };
      sok.onerror = () => { try { sok.close(); } catch (e) { } resolve(); };
      sok.onclose = () => resolve();
    } catch (e) { resolve(); }
  });
}

function getBlockedList() {
  try { return JSON.parse(localStorage.getItem('blocked_users') || '[]'); } catch (e) { return []; }
}
function isUserBlocked(userId) {
  return getBlockedList().includes(Number(userId));
}
function blockUser(userId) {
  const list = getBlockedList();
  if (!list.includes(Number(userId))) list.push(Number(userId));
  localStorage.setItem('blocked_users', JSON.stringify(list));
  alert('User blocked');
}

function sendMessageViaWebSocket(type, id) {
  const inputEl = document.getElementById('message-input');
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (!text) return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('❌ WebSocket not connected');
    connectWebSocket(type, id);
    return;
  }

  const temp_id = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const localMsg = {
    id: temp_id,
    temp_id: temp_id,
    sender_id: currentUserId,
    sender_username: 'You',
    text: text,
    reply_to_id: pendingReplyTo || undefined,
    timestamp: new Date().toISOString(),
    is_read: false,
    is_delivered: false
  };

  const messagesContainer = document.getElementById('messages-container');
  const el = createMessageElement(localMsg);
  messagesContainer.appendChild(el);

  localMessageMap.set(temp_id, el);
  console.log('✅ Message appended locally with temp_id:', temp_id);

  if (pendingReplyTo) {
    try {
      const refEl = document.querySelector(`.message[data-message-id="${pendingReplyTo}"] .message-content`);
      setReplyForMessage(temp_id, pendingReplyTo, refEl ? refEl.textContent : 'Quoted message');
    } catch (e) { }
  }

  scrollToBottom();

  const payload = {
    type: 'message',
    text,
    temp_id: temp_id
  };
  if (pendingReplyTo) payload.reply_to_id = pendingReplyTo;

  if (type === 'user') payload.receiver_id = id;
  else payload.project_id = id;

  try {
    ws.send(JSON.stringify(payload));
    console.log('✅ Message sent via WebSocket');
  } catch (err) {
    console.error('❌ Failed to send message', err);
    localMessageMap.delete(temp_id);
  }

  inputEl.value = '';
  inputEl.style.height = 'auto';
  const preview = document.getElementById('reply-preview');
  if (preview) preview.style.display = 'none';
  pendingReplyTo = null;
}

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
      alert('Network disconnected');
      connectWebSocket(type, id);
    }
  };
  reader.onerror = () => alert('Failed to read file');
  reader.readAsDataURL(file);
}

/* ============================================================
   PROJECT MEMBERS SIDEBAR (RIGHT SIDEBAR)
   ============================================================ */

async function loadProjectMembers(projectId) {
  try {
    const url = `${API_BASE}/projects/${projectId}/`;
    const res = await fetch(url, { headers: defaultHeaders() });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const project = await res.json();

    currentProjectMembers.clear();
    if (Array.isArray(project.members)) {
      project.members.forEach(member => {
        currentProjectMembers.set(member.id, {
          id: member.id,
          username: member.username,
          first_name: member.first_name,
          last_name: member.last_name,
          is_online: member.profile?.is_online || false
        });
      });
    }

    renderProjectMembers();
    showRightSidebar();

  } catch (err) {
    console.error('❌ Error loading project members:', err);
    hideRightSidebar();
  }
}

function renderProjectMembers() {
  const membersList = document.getElementById('members-list');
  const membersCount = document.getElementById('members-count');

  if (!membersList) return;

  const members = Array.from(currentProjectMembers.values());

  members.sort((a, b) => {
    if (a.is_online !== b.is_online) {
      return a.is_online ? -1 : 1;
    }
    const nameA = a.first_name || a.username;
    const nameB = b.first_name || b.username;
    return nameA.localeCompare(nameB);
  });

  membersList.innerHTML = '';

  if (members.length === 0) {
    membersList.innerHTML = `
      <div class="members-empty">
        <div class="members-empty-icon">👥</div>
        <div class="members-empty-text">No members</div>
      </div>
    `;
    if (membersCount) membersCount.textContent = '0';
    return;
  }

  members.forEach(member => {
    const item = createMemberItem(member);
    membersList.appendChild(item);
  });

  if (membersCount) {
    membersCount.textContent = members.length;
  }
}

function createMemberItem(member) {
  const div = document.createElement('div');
  div.className = 'member-item';
  div.id = `member-${member.id}`;

  const avatar = document.createElement('div');
  avatar.className = 'member-avatar';
  const initials = member.first_name
    ? member.first_name[0].toUpperCase() + (member.last_name?.[0]?.toUpperCase() || '')
    : member.username[0].toUpperCase();
  avatar.textContent = initials;

  const badge = document.createElement('div');
  badge.className = `status-badge ${member.is_online ? 'online' : ''}`;
  avatar.appendChild(badge);

  const info = document.createElement('div');
  info.className = 'member-info';

  const name = document.createElement('div');
  name.className = 'member-name';
  name.textContent = member.first_name
    ? `${member.first_name} ${member.last_name || ''}`.trim()
    : member.username;

  const status = document.createElement('div');
  status.className = `member-status ${member.is_online ? 'online' : 'offline'}`;
  status.textContent = member.is_online ? '● Online' : '● Offline';

  info.appendChild(name);
  info.appendChild(status);
  div.appendChild(avatar);
  div.appendChild(info);

  return div;
}

function showRightSidebar() {
  const sidebar = document.getElementById('right-sidebar');
  if (sidebar) sidebar.classList.remove('hidden');
}

function hideRightSidebar() {
  const sidebar = document.getElementById('right-sidebar');
  if (sidebar) sidebar.classList.add('hidden');
}

function updateMemberPresence(userId, status) {
  if (!userId || !currentProjectId) return;

  const member = currentProjectMembers.get(userId);
  if (!member) return;

  const isOnline = ('' + status).toLowerCase() === 'online';
  member.is_online = isOnline;

  const memberEl = document.getElementById(`member-${userId}`);
  if (memberEl) {
    const statusEl = memberEl.querySelector('.member-status');
    const badgeEl = memberEl.querySelector('.status-badge');

    if (statusEl) {
      statusEl.className = `member-status ${isOnline ? 'online' : 'offline'}`;
      statusEl.textContent = isOnline ? '● Online' : '● Offline';
    }

    if (badgeEl) {
      if (isOnline) {
        badgeEl.classList.add('online');
      } else {
        badgeEl.classList.remove('online');
      }
    }
  }

  renderProjectMembers();
}

/* ============================================================
   WEBSOCKET CONNECTION
   ============================================================ */

function connectWebSocket(type, id) {
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

/* ============================================================
   HANDLE WEBSOCKET MESSAGES
   ============================================================ */

function normalizeIncomingMessage(data) {
  if (!data) return data;

  return {
    id: data.id ?? data.message_id ?? data.pk ?? undefined,
    temp_id: data.temp_id ?? undefined,
    sender_id: data.sender_id ?? data.sender ?? data.from_id ?? undefined,
    sender: data.sender ?? data.sender_id ?? data.from_id ?? undefined,
    sender_username: data.sender_username ?? data.sender_name ?? data.username ?? undefined,
    receiver_id: data.receiver_id ?? data.to_id ?? undefined,
    project_id: data.project_id ?? data.project ?? undefined,
    text: data.text ?? data.message ?? '',
    file_url: data.file_url ?? data.file ?? undefined,
    reply_to_id: data.reply_to_id ?? data.reply_to ?? undefined,
    timestamp: data.timestamp ?? data.created_at ?? new Date().toISOString(),
    is_read: Boolean(data.is_read),
    is_delivered: Boolean(data.is_delivered)
  };
}

function handleWebSocketMessage(data) {
  if (!data || !data.type) return;
  const messagesContainer = document.getElementById('messages-container');

  if (data.type === 'message') {
    const msg = normalizeIncomingMessage(data);

    if (currentChatType !== 'user' || !currentChatId) {
      console.log('❌ Ignored DM message (no user chat open)', msg);
      return;
    }

    const senderId = Number(msg.sender_id);
    const receiverId = Number(msg.receiver_id);

    if (isUserBlocked(senderId)) {
      console.log('❌ Ignored message from blocked user', senderId);
      return;
    }

    if (!(senderId === Number(currentChatId) || receiverId === Number(currentChatId))) {
      console.log('❌ Ignored DM message (not for current chat)', { currentChatType, currentChatId, msg });
      return;
    }

    if (!messagesContainer) return;

    if (msg.temp_id && localMessageMap.has(msg.temp_id)) {
      const el = localMessageMap.get(msg.temp_id);
      el.dataset.messageId = msg.id;
      const contentDiv = el.querySelector('.message-content');
      if (contentDiv) contentDiv.textContent = msg.text;
      const refIdStr = el.dataset.replyToId;
      if (refIdStr) {
        const refId = Number(refIdStr);
        const quoteEl = el.querySelector('.message-quote');
        setReplyForMessage(msg.id, refId, quoteEl ? quoteEl.textContent : '');
      }
      // migrate reactions from temp id to real id
      try {
        const store = getReactionStore();
        const tempArr = store[msg.temp_id] || store[String(msg.temp_id)] || null;
        if (tempArr && tempArr.length) {
          store[msg.id] = (store[msg.id] || []).concat(tempArr.filter((e) => !(store[msg.id] || []).includes(e)));
          delete store[msg.temp_id]; delete store[String(msg.temp_id)];
          setReactionStore(store);
          renderPersistedReactions(el, msg.id);
        }
      } catch (e) { }
      localMessageMap.delete(msg.temp_id);
      addedMessageIds.add(msg.id);
      console.log('✅ Message reconciled: temp_id', msg.temp_id, '→ real_id', msg.id);
      return;
    }

    if (addedMessageIds.has(msg.id)) {
      console.log('⚠️ Duplicate message prevented:', msg.id);
      return;
    }

    addedMessageIds.add(msg.id);

    const el = createMessageElement(msg);
    messagesContainer.appendChild(el);

    if (msg.reply_to_id) {
      try {
        const refEl = document.querySelector(`.message[data-message-id="${msg.reply_to_id}"] .message-content`);
        const quoteEl = el.querySelector('.message-quote');
        setReplyForMessage(msg.id, msg.reply_to_id, quoteEl ? quoteEl.textContent : (refEl ? refEl.textContent : 'Quoted message'));
      } catch (e) { }
    }

    if (isUserNearBottom(messagesContainer)) {
      scrollToBottom();
    } else {
      showNewMessageIndicator();
    }

    observeElementForRead(el);

    if (msg.file_url) {
      loadChatMetadata(currentChatType, currentChatId).then(() => {
        displayChatInfoOnSidebar(currentChatType, currentChatId,
          document.querySelector('.chat-header-title h3')?.textContent || 'Chat');
      });
    }

    loadRecentChats();
    return;
  }

  if (data.type === 'project_message') {
    const msg = normalizeIncomingMessage(data);
    const projId = Number(msg.project_id);

    if (currentChatType !== 'project' || Number(currentChatId) !== projId) {
      console.log('❌ Ignored project message (not current project)', { currentChatType, currentChatId, projId });
      return;
    }

    if (!messagesContainer) return;

    if (isUserBlocked(Number(msg.sender_id))) {
      console.log('❌ Ignored project message from blocked user', msg.sender_id);
      return;
    }

    if (msg.temp_id && localMessageMap.has(msg.temp_id)) {
      const el = localMessageMap.get(msg.temp_id);
      el.dataset.messageId = msg.id;
      const contentDiv = el.querySelector('.message-content');
      if (contentDiv) contentDiv.textContent = msg.text;
      localMessageMap.delete(msg.temp_id);
      addedMessageIds.add(msg.id);
      console.log('✅ Project message reconciled: temp_id', msg.temp_id, '→ real_id', msg.id);
      return;
    }

    if (addedMessageIds.has(msg.id)) {
      console.log('⚠️ Duplicate project message prevented:', msg.id);
      return;
    }

    addedMessageIds.add(msg.id);

    const pel = createMessageElement(msg);
    messagesContainer.appendChild(pel);
    if (isUserNearBottom(messagesContainer)) scrollToBottom();
    observeElementForRead(pel);
    return;
  }

  if (data.type === 'status' || data.type === 'user_status') {
    if (data.status) updatePresenceFromServer(data.status);
    updateMemberPresence(data.user_id, data.status);
    return;
  }

  if (data.type === 'read_receipt') {
    const ids = Array.isArray(data.message_ids) ? data.message_ids : (data.message_ids ? [data.message_ids] : []);
    markMessagesReadInUI(ids, data.reader_id);
    updateSidebarUnreadCounts(ids);
    return;
  }

  console.warn('Unhandled WS event type:', data.type);
}

/* ============================================================
   PRESENCE UPDATES
   ============================================================ */

function updatePresenceFromServer(status) {
  const normalized = ('' + status).toLowerCase() === 'online' ? 'online' : 'offline';
  const statusEl = document.querySelector('.connection-status');
  if (!statusEl) return;

  if (normalized === 'online') {
    if (pendingOfflineTimer) {
      clearTimeout(pendingOfflineTimer);
      pendingOfflineTimer = null;
    }
    if (lastAppliedPresence !== 'online') {
      statusEl.className = `connection-status online`;
      statusEl.textContent = `● Online`;
      lastAppliedPresence = 'online';
    }
    return;
  }

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

/* ============================================================
   READ RECEIPTS
   ============================================================ */

function setupReadReceiptObservers(messagesContainer) {
  if (intersectionObserver) {
    try { intersectionObserver.disconnect(); } catch (e) { }
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
      visibleUnreadIds.forEach(id => {
        const m = document.querySelector(`.message[data-message-id="${id}"]`);
        if (m) m.classList.remove('not-read');
      });
    }
  }, {
    root: messagesContainer,
    rootMargin: '0px',
    threshold: 0.6
  });

  const unreadEls = messagesContainer?.querySelectorAll('.message.not-read') || [];
  unreadEls.forEach(el => intersectionObserver.observe(el));
}

function observeElementForRead(el) {
  if (!intersectionObserver || !el) return;
  if (el.classList.contains('not-read')) {
    try { intersectionObserver.observe(el); } catch (e) { }
  }
}

function sendReadReceipts(forceSendAll = false) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const container = document.getElementById('messages-container');
  if (!container) return;

  const notReadEls = Array.from(container.querySelectorAll('.message.not-read'));
  if (!notReadEls.length) return;

  if (!forceSendAll) {
    if (!isUserNearBottom(container)) return;
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

/* ============================================================
   UI HELPERS
   ============================================================ */

function markMessagesReadInUI(messageIds = [], readerId = null) {
  messageIds.forEach(id => {
    const el = document.querySelector(`.message[data-message-id="${id}"]`);
    if (el) {
      el.classList.remove('not-read');
      const isOwn = el.classList.contains('own-message');
      if (isOwn) {
        const ticks = el.querySelectorAll('.tick');
        ticks.forEach(t => t.classList.add('read'));
      }
    }
  });
}

function updateSidebarUnreadCounts(messageIds = []) {
  loadRecentChats();
}

function isUserNearBottom(container) {
  if (!container) return true;
  const distanceFromBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
  return distanceFromBottom <= isUserNearBottomThreshold;
}

function showNewMessageIndicator() {
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
      sendReadReceipts(true);
    };
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow) chatWindow.appendChild(newMessageBadge);
  }
}

function updateConnectionStatus(isOnline) {
  const statusEl = document.querySelector('.connection-status');
  if (statusEl) {
    statusEl.className = `connection-status ${isOnline ? 'online' : 'offline'}`;
    statusEl.textContent = `● ${isOnline ? 'Online' : 'Offline'}`;
  }
}

/* ============================================================
   UTILITIES
   ============================================================ */

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

function setupEventListeners() {
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
      const input = document.getElementById('message-input');
      if (input) input.focus();
    }
  });

  window.addEventListener('focus', () => {
    sendReadReceipts(true);
  });

  document.addEventListener('contextmenu', (e) => {
    const container = document.getElementById('messages-container');
    if (container && container.contains(e.target)) e.preventDefault();
  }, true);

  document.addEventListener('selectstart', (e) => {
    const container = document.getElementById('messages-container');
    if (container && container.contains(e.target)) e.preventDefault();
  }, true);

  console.log('✅ Event listeners setup complete');
}
