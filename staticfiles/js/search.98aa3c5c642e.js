// static/js/search.js
// Search functionality for finding and opening chats with users

/**
 * Initialize search functionality
 */
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('user-search');
    
    if (searchInput) {
        searchInput.addEventListener('input', debounce(handleSearch, 300));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                clearSearch();
            }
        });
    }
});

/**
 * Debounce function to prevent too many API calls
 */
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
}

/**
 * Handle search input
 */
async function handleSearch(e) {
    const query = e.target.value.trim();
    const searchResultsContainer = document.getElementById('search-results');
    
    if (!searchResultsContainer) {
        console.error('search-results container not found');
        return;
    }

    // Clear results if query is empty
    if (!query || query.length < 1) {
        searchResultsContainer.innerHTML = '';
        searchResultsContainer.classList.add('hidden');
        return;
    }

    try {
        console.log('Searching for:', query);
        
        // Use correct API base URL
        const url = `${API_BASE}/users/search/?q=${encodeURIComponent(query)}`;
        console.log('Search URL:', url);
        
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken(),
            }
        });

        console.log('Search response status:', response.status);

        if (!response.ok) {
            if (response.status === 400) {
                // Query too short or empty
                searchResultsContainer.innerHTML = '<div class="no-results">Type at least 1 character</div>';
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            searchResultsContainer.classList.remove('hidden');
            return;
        }

        const users = await response.json();
        console.log('Search results:', users);
        
        renderSearchResults(users, searchResultsContainer);
        
    } catch (error) {
        console.error('Error searching users:', error);
        searchResultsContainer.innerHTML = '<div class="no-results">Error searching users</div>';
        searchResultsContainer.classList.remove('hidden');
    }
}

/**
 * Render search results
 */
function renderSearchResults(users, container) {
    if (!users || users.length === 0) {
        container.innerHTML = '<div class="no-results">No users found</div>';
        container.classList.remove('hidden');
        return;
    }

    let html = '';
    users.forEach(user => {
        const firstName = user.first_name || '';
        const lastName = user.last_name || '';
        const initials = (firstName[0] || '') + (lastName[0] || '');
        const fullName = (firstName && lastName) ? `${firstName} ${lastName}` : user.username;

        html += `
            <div class="search-result-item" onclick="openSearchResult(${user.id}, '${fullName}')">
                <div class="avatar">${initials || user.username[0]}</div>
                <div class="user-details">
                    <div class="username">${fullName}</div>
                    <div class="email">${user.email || 'No email'}</div>
                </div>
                <div class="status ${user.profile && user.profile.is_online ? 'online' : 'offline'}">
                    ${user.profile && user.profile.is_online ? '🟢 Online' : '⚫ Offline'}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    container.classList.remove('hidden');
}

/**
 * Handle click on search result
 * This opens the chat with the selected user
 */
function openSearchResult(userId, userName) {
    console.log('Opening search result:', { userId, userName });
    
    // Clear search
    clearSearch();
    
    // Open the chat
    openChat('user', userId);
}

/**
 * Clear search results
 */
function clearSearch() {
    const searchInput = document.getElementById('user-search');
    const searchResultsContainer = document.getElementById('search-results');
    
    if (searchInput) {
        searchInput.value = '';
    }
    
    if (searchResultsContainer) {
        searchResultsContainer.innerHTML = '';
        searchResultsContainer.classList.add('hidden');
    }
}

/**
 * Close search results when clicking outside
 */
document.addEventListener('click', function(e) {
    const searchContainer = document.querySelector('.search-container');
    const searchResults = document.getElementById('search-results');
    
    if (searchContainer && searchResults && !searchContainer.contains(e.target)) {
        searchResults.classList.add('hidden');
    }
});
