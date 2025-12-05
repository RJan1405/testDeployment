// static/js/websocket.js - light WebSocket manager matched to your routing

class WebSocketManager {
    constructor(userId) {
        this.userId = userId;
        this.socket = null;
        this.listeners = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
    }

    connect(chatType, chatId) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws/chat/${chatType}/${chatId}/`;

        console.log('WebSocketManager connecting to', url);

        // Close existing socket if present
        if (this.socket) {
            try { this.socket.close(); } catch (e) {}
            this.socket = null;
        }

        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
            console.log(`WebSocket connected for ${chatType}:${chatId}`);
            this.reconnectAttempts = 0;
            this.emit('connected');
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket received:', data);
                this.emit('message', data);
            } catch (e) {
                console.error('Invalid JSON from websocket:', e, event.data);
            }
        };

        this.socket.onerror = (event) => {
            console.error('WebSocket error:', event);
            this.emit('error', event);
        };

        this.socket.onclose = (ev) => {
            console.warn('WebSocket closed', ev);
            this.emit('disconnected');
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                setTimeout(() => {
                    console.log('Attempting websocket reconnect', this.reconnectAttempts);
                    this.connect(chatType, chatId);
                }, this.reconnectDelay);
            } else {
                console.error('Max websocket reconnect attempts reached');
            }
        };
    }

    send(obj) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not open. cannot send', obj);
            return;
        }
        this.socket.send(JSON.stringify(obj));
    }

    on(event, cb) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(cb);
    }

    emit(event, data) {
        const list = this.listeners.get(event) || [];
        list.forEach(fn => {
            try { fn(data); } catch (e) { console.error(e); }
        });
    }
}

// expose globally
window.WebSocketManager = WebSocketManager;
