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

    if (Array.isArray(messages) && messages.length > 0) {
      messages.forEach(msg => {
        addedMessageIds.add(msg.id);
        messagesContainer.appendChild(createMessageElement(msg));
      });
    }

    setupMessageInputHandlers(type, id);
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

  return div;
}

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
    timestamp: new Date().toISOString(),
    is_read: false,
    is_delivered: false
  };

  const messagesContainer = document.getElementById('messages-container');
  const el = createMessageElement(localMsg);
  messagesContainer.appendChild(el);

  localMessageMap.set(temp_id, el);
  console.log('✅ Message appended locally with temp_id:', temp_id);

  scrollToBottom();

  const payload = {
    type: 'message',
    text,
    temp_id: temp_id
  };

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
    timestamp: data.timestamp ?? data.created_at ?? new Date().toISOString(),
    is_read: Boolean(data.is_read),
    is_delivered: Boolean(data.is_delivered)
  };
}

function handleWebSocketMessage(data) {
  if (!data || !data.type) return;
  const messagesContainer = document.getElementById('messages-container');

  switch (data.type) {
    case 'message': {
      const msg = normalizeIncomingMessage(data);

      if (currentChatType !== 'user' || !currentChatId) {
        console.log('❌ Ignored DM message (no user chat open)', msg);
        return;
      }

      const senderId = Number(msg.sender_id);
      const receiverId = Number(msg.receiver_id);

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

      if (isUserNearBottom(messagesContainer)) {
        scrollToBottom();
      } else {
        showNewMessageIndicator();
      }

      observeElementForRead(el);
      
      // ✅ NEW: Update files list if message has file
      if (msg.file_url) {
        loadChatMetadata(currentChatType, currentChatId).then(() => {
          displayChatInfoOnSidebar(currentChatType, currentChatId, 
            document.querySelector('.chat-header-title h3')?.textContent || 'Chat');
        });
      }
      
      loadRecentChats();
      break;
    }

    case 'project_message': {
      const msg = normalizeIncomingMessage(data);
      const projId = Number(msg.project_id);

      if (currentChatType !== 'project' || Number(currentChatId) !== projId) {
        console.log('❌ Ignored project message (not current project)', { currentChatType, currentChatId, projId });
        return;
      }

      if (!messagesContainer) return;

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
      break;
    }

    case 'status':
    case 'user_status': {
      if (data.status) updatePresenceFromServer(data.status);
      updateMemberPresence(data.user_id, data.status);
      break;
    }

    case 'read_receipt': {
      const ids = Array.isArray(data.message_ids) ? data.message_ids : (data.message_ids ? [data.message_ids] : []);
      markMessagesReadInUI(ids, data.reader_id);
      updateSidebarUnreadCounts(ids);
      break;
    }

    default:
      console.warn('Unhandled WS event type:', data.type);
  }
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

  console.log('✅ Event listeners setup complete');
}