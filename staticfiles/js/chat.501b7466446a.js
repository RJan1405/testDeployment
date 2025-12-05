// Static files/js/chat.js
// Chat application JavaScript - COMPLETE WITH ALL FIXES
// FIXED: Messages aligned left/right + Media preview + Online status

const API_BASE = '/chat/api';
let currentChatType = null;
let currentChatId = null;
let ws = null;
let currentUserId = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Chat app initializing...');
    
    currentUserId = window.currentUserId || document.querySelector('[data-user-id]')?.dataset.userId;
    console.log('Current user ID:', currentUserId);
    
    if (!currentUserId) {
        console.error('User ID not found in page!');
        return;
    }
    
    loadRecentChats();
    loadProjects();
    setupEventListeners();
});

/**
 * Load recent conversations
 */
async function loadRecentChats() {
    try {
        const url = `${API_BASE}/messages/recent_chats/`;
        console.log('Fetching from:', url);
        
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken(),
            }
        });

        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const chats = await response.json();
        console.log('Recent chats loaded:', chats);
        renderRecentChats(chats);
    } catch (error) {
        console.error('Error loading recent chats:', error);
    }
}

/**
 * Render recent chats in sidebar
 */
function renderRecentChats(chats) {
    const recentChatsContainer = document.getElementById('recent-chats');
    
    if (!recentChatsContainer) {
        console.error('recent-chats container not found');
        return;
    }

    recentChatsContainer.innerHTML = '';

    if (!chats || chats.length === 0) {
        recentChatsContainer.innerHTML = '<p class="empty-state">No recent chats</p>';
        return;
    }

    chats.sort((a, b) => {
        const timeA = new Date(a.last_message_time);
        const timeB = new Date(b.last_message_time);
        return timeB - timeA;
    });

    chats.forEach(chat => {
        const chatItem = createChatItem(chat);
        recentChatsContainer.appendChild(chatItem);
    });
}

/**
 * Create individual chat item
 */
function createChatItem(chat) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.onclick = () => openChat('user', chat.user.id);

    const firstName = chat.user.first_name || '';
    const lastName = chat.user.last_name || '';
    const initials = (firstName[0] || '') + (lastName[0] || '');
    
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials || chat.user.username[0];

    const info = document.createElement('div');
    info.className = 'chat-info';

    const name = document.createElement('div');
    name.className = 'chat-name';
    name.textContent = (firstName && lastName) 
        ? `${firstName} ${lastName}`
        : chat.user.username;

    const preview = document.createElement('div');
    preview.className = 'chat-preview';
    preview.textContent = chat.last_message || '(No messages)';

    info.appendChild(name);
    info.appendChild(preview);

    if (chat.unread_count > 0) {
        const badge = document.createElement('div');
        badge.className = 'unread-badge';
        badge.textContent = chat.unread_count;
        div.appendChild(badge);
    }

    div.appendChild(avatar);
    div.appendChild(info);

    return div;
}

/**
 * Load projects list
 */
async function loadProjects() {
    try {
        const url = `${API_BASE}/projects/`;
        console.log('Fetching projects from:', url);
        
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken(),
            }
        });

        console.log('Projects response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const projects = await response.json();
        console.log('Projects loaded:', projects);
        renderProjects(projects);
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

/**
 * Render projects in sidebar
 */
function renderProjects(projects) {
    const projectsContainer = document.getElementById('projects-list');
    
    if (!projectsContainer) {
        console.error('projects-list container not found');
        return;
    }

    projectsContainer.innerHTML = '';

    if (!projects || projects.length === 0) {
        projectsContainer.innerHTML = '<p class="empty-state">No projects</p>';
        return;
    }

    projects.forEach(project => {
        const projectItem = createProjectItem(project);
        projectsContainer.appendChild(projectItem);
    });
}

/**
 * Create individual project item
 */
function createProjectItem(project) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.onclick = () => openChat('project', project.id);

    const avatar = document.createElement('div');
    avatar.className = 'avatar project-avatar';
    avatar.textContent = (project.name[0] || 'P').toUpperCase();

    const info = document.createElement('div');
    info.className = 'chat-info';

    const name = document.createElement('div');
    name.className = 'chat-name';
    name.textContent = project.name;

    const preview = document.createElement('div');
    preview.className = 'chat-preview';
    preview.textContent = `${project.members ? project.members.length : 0} members`;

    info.appendChild(name);
    info.appendChild(preview);

    div.appendChild(avatar);
    div.appendChild(info);

    return div;
}

/**
 * Open chat conversation - FIXED VERSION
 * Works with both sidebar chats and search results (safe event handling)
 */
function openChat(type, id) {
    console.log(`Opening ${type} chat with id ${id}`);
    
    currentChatType = type;
    currentChatId = id;

    try {
        let chatItem = null;
        
        if (event && event.target) {
            chatItem = event.target.closest('.chat-item');
        }
        
        if (chatItem) {
            document.querySelectorAll('.chat-item').forEach(item => {
                item.classList.remove('active');
            });
            chatItem.classList.add('active');
        } else {
            document.querySelectorAll('.chat-item').forEach(item => {
                item.classList.remove('active');
            });
        }
    } catch (e) {
        console.warn('Could not update active state:', e);
    }

    loadChatWindow(type, id);
    connectWebSocket(type, id);
}

/**
 * Load chat window - FIXED VERSION
 * Now shows correct online/offline status dynamically
 */
async function loadChatWindow(type, id) {
    const chatWindow = document.getElementById('chat-window');
    
    if (!chatWindow) {
        console.error('chat-window container not found');
        return;
    }

    try {
        let endpoint = '';
        let headerName = '';
        let isOnline = false;
        
        if (type === 'user') {
            endpoint = `${API_BASE}/messages/user/${id}/`;
            const userResponse = await fetch(`${API_BASE}/users/${id}/`);
            const user = await userResponse.json();
            headerName = (user.first_name && user.last_name)
                ? `${user.first_name} ${user.last_name}`
                : user.username;
            isOnline = user.profile && user.profile.is_online ? true : false;
            console.log(`User ${headerName} is online:`, isOnline);
        } else if (type === 'project') {
            endpoint = `${API_BASE}/messages/project/${id}/`;
            const projectResponse = await fetch(`${API_BASE}/projects/${id}/`);
            const project = await projectResponse.json();
            headerName = project.name;
            isOnline = true;
        }

        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const messages = await response.json();
        console.log('Messages loaded:', messages);

        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? '● Online' : '● Offline';
        
        chatWindow.innerHTML = `
            <div class="chat-header">
                <div class="chat-header-title">
                    <h3>${headerName}</h3>
                    <span class="connection-status ${statusClass}">${statusText}</span>
                </div>
            </div>
            <div class="messages-container" id="messages-container">
                <!-- Messages will be populated here -->
            </div>
            <div class="message-input-area">
                <div class="input-wrapper">
                    <textarea class="message-input" id="message-input" placeholder="Type a message..." rows="1"></textarea>
                    <button class="file-upload-btn" id="file-upload-btn" title="Upload file">📎</button>
                    <button class="send-btn" id="send-btn">Send</button>
                </div>
            </div>
        `;

        const messagesContainer = document.getElementById('messages-container');
        if (messages && messages.length > 0) {
            messages.forEach(msg => {
                const messageEl = createMessageElement(msg);
                messagesContainer.appendChild(messageEl);
            });
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        setupMessageInputHandlers(type, id);

    } catch (error) {
        console.error('Error loading chat window:', error);
        chatWindow.innerHTML = `
            <div class="welcome-screen">
                <h2>Error</h2>
                <p>Failed to load chat: ${error.message}</p>
            </div>
        `;
    }
}

/**
 * Create message element - FIXED WITH MEDIA PREVIEW
 */
function createMessageElement(msg) {
    const div = document.createElement('div');
    
    const isOwnMessage = msg.sender === currentUserId;
    div.className = `message ${isOwnMessage ? 'own-message' : 'other-message'}`;

    if (!isOwnMessage && msg.sender_username) {
        const senderName = document.createElement('div');
        senderName.className = 'message-sender';
        senderName.textContent = msg.sender_username;
        div.appendChild(senderName);
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = msg.text || '(No text)';
    div.appendChild(content);

    // ← FIXED: File attachment with media preview
    if (msg.file_url) {
        const fileAttachment = document.createElement('div');
        fileAttachment.className = 'file-attachment';
        
        const fileExt = msg.file_url.split('.').pop().toLowerCase();
        
        // Images
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(fileExt)) {
            const img = document.createElement('img');
            img.src = msg.file_url;
            img.alt = 'Attachment';
            img.loading = 'lazy';
            img.style.maxWidth = '100%';
            img.style.maxHeight = '300px';
            img.style.borderRadius = '4px';
            img.style.cursor = 'pointer';
            img.onclick = () => window.open(msg.file_url, '_blank');
            fileAttachment.appendChild(img);
        }
        // Videos
        else if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(fileExt)) {
            const video = document.createElement('video');
            video.src = msg.file_url;
            video.controls = true;
            video.style.maxWidth = '100%';
            video.style.maxHeight = '300px';
            video.style.borderRadius = '4px';
            fileAttachment.appendChild(video);
        }
        // Audio
        else if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(fileExt)) {
            const audio = document.createElement('audio');
            audio.src = msg.file_url;
            audio.controls = true;
            audio.style.maxWidth = '100%';
            fileAttachment.appendChild(audio);
        }
        
        // Download link
        const downloadLink = document.createElement('a');
        downloadLink.href = msg.file_url;
        downloadLink.target = '_blank';
        downloadLink.className = 'download-link';
        downloadLink.textContent = '📥 ' + (msg.file_url.split('/').pop() || 'Download');
        fileAttachment.appendChild(downloadLink);
        
        div.appendChild(fileAttachment);
    }

    const time = document.createElement('div');
    time.className = 'message-time';
    const msgTime = new Date(msg.timestamp);
    time.textContent = msgTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.appendChild(time);

    return div;
}

/**
 * Setup message input event handlers
 */
function setupMessageInputHandlers(type, id) {
    const inputEl = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const fileUploadBtn = document.getElementById('file-upload-btn');

    if (!inputEl || !sendBtn) return;

    sendBtn.onclick = () => sendMessage(type, id);

    inputEl.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(type, id);
        }
    };

    inputEl.oninput = () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
    };

    if (fileUploadBtn) {
        fileUploadBtn.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.onchange = (e) => uploadFile(e, type, id);
            input.click();
        };
    }
}

/**
 * Send message - FIXED VERSION
 * Uses FormData instead of JSON to avoid 415 error
 */
async function sendMessage(type, id) {
    const inputEl = document.getElementById('message-input');
    const text = inputEl.value.trim();

    if (!text) return;

    try {
        const formData = new FormData();
        formData.append('text', text);

        if (type === 'user') {
            formData.append('receiver_id', id);
        } else if (type === 'project') {
            formData.append('project_id', id);
        }

        console.log('Sending message:', { text, type, id });

        const response = await fetch(`${API_BASE}/messages/send/`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCSRFToken(),
            },
            body: formData
        });

        console.log('Send response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const message = await response.json();
        console.log('Message sent:', message);

        inputEl.value = '';
        inputEl.style.height = 'auto';

        const messagesContainer = document.getElementById('messages-container');
        const messageEl = createMessageElement(message);
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        loadRecentChats();

    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message: ' + error.message);
    }
}

/**
 * Upload file - FIXED VERSION
 * Properly uses FormData for file uploads
 */
async function uploadFile(e, type, id) {
    const file = e.target.files[0];
    if (!file) return;

    console.log('Uploading file:', { filename: file.name, size: file.size, type: file.type });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('text', `[File: ${file.name}]`);

    if (type === 'user') {
        formData.append('receiver_id', id);
    } else if (type === 'project') {
        formData.append('project_id', id);
    }

    try {
        const response = await fetch(`${API_BASE}/messages/send/`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCSRFToken(),
            },
            body: formData
        });

        console.log('Upload response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const message = await response.json();
        console.log('File uploaded:', message);

        const messagesContainer = document.getElementById('messages-container');
        const messageEl = createMessageElement(message);
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        loadRecentChats();

    } catch (error) {
        console.error('Error uploading file:', error);
        alert('Failed to upload file: ' + error.message);
    }
}

/**
 * Connect WebSocket
 */
function connectWebSocket(type, id) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat/${type}/${id}/`;

    console.log('Connecting to WebSocket:', wsUrl);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected');
        updateConnectionStatus(true);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message:', data);
        handleWebSocketMessage(data);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateConnectionStatus(false);
    };
}

/**
 * Handle WebSocket messages
 */
function handleWebSocketMessage(data) {
    if (data.type === 'message') {
        const messagesContainer = document.getElementById('messages-container');
        const messageEl = createMessageElement(data);
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        loadRecentChats();
    } else if (data.type === 'typing') {
        console.log(`${data.username} is typing...`);
    } else if (data.type === 'status') {
        updateConnectionStatus(data.status === 'online');
    }
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(isOnline) {
    const statusEl = document.querySelector('.connection-status');
    if (statusEl) {
        statusEl.className = `connection-status ${isOnline ? 'online' : 'offline'}`;
        statusEl.textContent = `● ${isOnline ? 'Online' : 'Offline'}`;
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    console.log('Event listeners setup complete');
}

/**
 * Get CSRF token from cookie
 */
function getCSRFToken() {
    const name = 'csrftoken';
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue || '';
}
